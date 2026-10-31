// Every learned step must come from something the person did or said. Muse Spark cites the events behind each
// step; code checks the citations, finds the event when one was left out, and takes out a step with nothing
// behind it, keeping it on a question ("I wasn't sure about X. Did you do that?") so a "yes" can bring it back.
// Then a second model reads what the person said against the task and asks about anything left out.
import { askJson, checker, text, type Turn } from "./meta.ts";
import { IGNORED } from "./moments.ts";
import type { Card } from "./notes.ts";
import type { Spec, Step } from "./understand.ts";

export type Question = { id: string; text: string; quote?: string; step?: Step; after?: string }; // after: the step before a removed one
// Steps that repeat something the person did: they must point at it.
export const ACTING = new Set(["click", "fill", "press", "goto", "upload", "open_item", "compare"]);

const same = (a?: string, b?: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
const page = (u?: string) => { try { const x = new URL(u!); return x.origin + x.pathname.replace(/\/+$/, ""); } catch { return null; } };

// The event a step repeats, when Muse Spark didn't say: same target, same page, same key, same text.
function find(st: Step, spec: Spec, events: any[]): number | null {
  const at = (ok: (e: any) => boolean) => { const i = events.findIndex((e) => !IGNORED.has(e.kind) && ok(e)); return i >= 0 ? i : null; };
  if (st.do === "open_item") return spec.inputs.itemEvent != null && events[spec.inputs.itemEvent] ? spec.inputs.itemEvent : null;
  if (st.do === "compare") return st.resultEvent != null && events[st.resultEvent] ? st.resultEvent : null;
  if (st.do === "goto") {
    const fixed = (st.url ?? "").split("{{")[0]; // a page with this item's value in it: the part before it
    const want = st.url?.includes("{{") ? fixed : page(st.url);
    return want ? at((e) => (e.kind === "start" || e.kind === "page") && (st.url?.includes("{{") ? String(e.url).startsWith(want) : page(e.url) === want)) : null;
  }
  const byTarget = st.target?.name ? at((e) => ["click", "input", "key", "upload"].includes(e.kind) && same(e.target?.role, st.target!.role) && same(e.target?.label, st.target!.name)) : null;
  if (byTarget != null) return byTarget;
  if (st.do === "press") return at((e) => e.kind === "key" && same(e.key, st.key));
  if (st.do === "fill") return at((e) => e.kind === "input" && (st.value?.includes("{{") || same(String(e.value ?? ""), st.value)));
  if (st.do === "upload") return at((e) => e.kind === "upload");
  return null;
}

/** Check and fix every step's evidence (indexes into `events`). Changes `spec`. */
export function checkEvidence(spec: Spec, events: any[]): void {
  const real = (i: unknown) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < events.length && !IGNORED.has(events[i as number]?.kind);
  // An outcome that was never demonstrated is Remuse's own guess, said as such: nothing to point at.
  const lists = [spec.steps, ...Object.values(spec.outcomes ?? {}).filter((o) => o.demonstrated !== false).map((o) => o.steps)];
  const unbacked = new Set<Step>();
  for (const list of lists) for (const st of list) {
    const ev = (st.evidence?.events ?? []).filter(real).map(Number);
    if (!ev.length && ACTING.has(st.do)) { const i = find(st, spec, events); if (i != null) ev.push(i); }
    if (ev.length) { st.evidence = { ...st.evidence, events: ev }; if (!real(st.fromEvent)) st.fromEvent = ev[0]; }
    else if (ACTING.has(st.do)) unbacked.add(st);
  }
  if (!unbacked.size) return;
  spec.questions ??= [];
  // If nothing at all could be tied to the recording, the citations failed, not the steps: keep them and say so.
  const main = spec.steps.filter((s) => ACTING.has(s.do));
  if (main.length && main.every((s) => unbacked.has(s))) {
    spec.questions.push({ id: "q-evidence", text: "I couldn't match my steps to what you did. Please check them." });
    return;
  }
  for (const list of lists) {
    const out = list.filter((st, i) => {
      if (!unbacked.has(st)) return true;
      spec.questions!.push({ id: `q-${st.id}`, text: `I wasn't sure about "${st.describe}". Did you do that?`, step: st, ...(list[i - 1] ? { after: list[i - 1].id } : {}) });
      return false;
    });
    list.splice(0, list.length, ...out);
  }
}

/** Things the person asked for that the learned task doesn't do, as at most 3 questions to ask them out loud. */
export async function coverage(spec: Spec, turns: Turn[], cards: Card[]): Promise<{ id: string; text: string; quote?: string }[]> {
  if (!turns.length) return [];
  const steps = [...spec.steps, ...Object.values(spec.outcomes ?? {}).flatMap((o) => o.steps)].map((s) => `- ${s.describe}`);
  const rules = (spec.rules ?? []).map((r) => `- if ${r.if}, then ${r.then}${r.said ? ` (they said "${r.said}")` : ""}`);
  try {
    const r = await askJson<any>([text(`A person taught a browser robot a task by doing it once and explaining it out loud. Below is everything they said, the notes taken while they taught, and the task the robot learned. List what they clearly asked for that the task does not do: a value they wanted read, a rule or condition, how often, where to put something. Only real gaps, at most 3. For each, a short question to ask them out loud, and their own words it's about.

What they said:
${turns.map((t) => `"${t.text}"`).join("\n")}

Notes taken while they taught:
${cards.map((c) => `- [${c.kind}] ${c.text}`).join("\n") || "(none)"}

The task's steps:
${steps.join("\n")}
Its rules:
${rules.join("\n") || "(none)"}

Reply with ONLY JSON: {"questions": [{"text": "<the question>", "quote": "<their words>"}]}, or {"questions": []} when nothing is missing.`)], "coverage", checker().model);
    return (Array.isArray(r?.questions) ? r.questions : []).filter((q: any) => q?.text).slice(0, 3)
      .map((q: any, i: number) => ({ id: `q-cover-${i + 1}`, text: String(q.text), ...(q.quote ? { quote: String(q.quote) } : {}) }));
  } catch { return []; } // a missed question is not worth failing the learning over
}
