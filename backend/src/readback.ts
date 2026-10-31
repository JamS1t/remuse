// What Remuse says when it reads a learned task back to you: plain sentences built from the task itself (no model,
// so it says exactly what it will do). The plan first, then its questions, which the review asks one at a time.
import type { Spec, Step } from "./understand.ts";

export type Line = { text: string; step?: string; question?: string };
// A step as a person would name it, and the task steps it stands for (keypresses fold into the step they finish).
export type Shown = { text: string; ids: string[] };

const sentence = (s: string) => s.trim().replace(/[.\s]+$/, "");
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const MAX = 8; // a plan read aloud stops being listened to after about this many steps

// Keypresses and the spreadsheet's Name Box are how a step gets done, not steps a person would name.
const small = (s: Step) => s.do === "press" || (s.do === "fill" && /name box/i.test(s.target?.name ?? ""));

/** The steps as a person would name them. A run of keypresses that finds the next empty row (Name Box, Ctrl+End,
 *  Home, Down) is one step; a Tab or Enter after typing belongs to that typing. */
export function shownSteps(steps: Step[]): Shown[] {
  const out: Shown[] = [];
  for (let i = 0; i < steps.length; i++) {
    if (!small(steps[i])) { out.push({ text: sentence(steps[i].describe), ids: [steps[i].id] }); continue; }
    const run: Step[] = [];
    while (i < steps.length && small(steps[i])) run.push(steps[i++]);
    i--;
    const ids = run.map((s) => s.id);
    if (run.some((s) => /control\+end|ctrl\+end|arrowdown/i.test(s.key ?? ""))) out.push({ text: "Go to the next empty row", ids });
    else if (out.length) out[out.length - 1].ids.push(...ids);
    else out.push({ text: sentence(run[0].describe), ids });
  }
  return out;
}

export function readback(spec: Spec): { plan: Line[]; questions: Line[]; steps: Shown[] } {
  const steps = shownSteps([...spec.steps, ...Object.values(spec.outcomes ?? {}).flatMap((o) => o.steps)]);
  const plan: Line[] = [{ text: "Here's my plan." }];
  steps.slice(0, MAX).forEach((s, i) => plan.push({ text: `Step ${i + 1}: ${s.text}.`, step: s.ids[0] }));
  if (steps.length > MAX) plan.push({ text: `And ${steps.length - MAX} more steps, all on the screen.` });
  for (const r of spec.rules ?? []) {
    const then = lower(sentence(spec.outcomes?.[r.then]?.describe ?? String(r.then ?? "").replaceAll("_", " ")));
    const cond = String(r.if ?? "");
    if (!then || (!cond && !r.said)) continue; // half a rule from the model: nothing sensible to say
    const always = /^\s*(otherwise|else|default|always|in all cases|every)\b/i.test(cond); // "do it": no condition to read
    if (r.said && /^(if|when|whenever|otherwise|every|each|all|for every|for each)\b/i.test(r.said.trim())) plan.push({ text: `${upper(sentence(r.said))}.` }); // their whole rule, as they said it
    else if (always) continue;
    else if (r.said) plan.push({ text: `If ${sentence(r.said)}, I'll ${then}.` });
    else plan.push({ text: `If ${sentence(cond.replaceAll("_", " "))}, I'll ${then}.` });
  }
  const questions = (spec.questions ?? []).map((q) => ({ text: q.quote ? `One thing: you said "${sentence(q.quote)}". ${q.text}` : q.text, question: q.id }));
  return { plan, questions, steps };
}
