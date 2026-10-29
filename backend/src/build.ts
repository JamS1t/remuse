// Build: Muse Spark writes the extraction and decision rules as real JavaScript, then we test that code
// against what the demo showed. Totals, dates and rule checks are computed, not guessed by a model.
import vm from "node:vm";
import { respond, text } from "./meta.ts";
import type { Spec } from "./understand.ts";

export type Rules = {
  extract: Record<string, (pageText: string) => unknown>;
  compute: Record<string, (v: Record<string, unknown>) => unknown>;
  decide: (v: Record<string, unknown>) => { outcome: string; rule: number };
  // compare steps only: higher is better; null means this result doesn't qualify.
  score?: (c: Record<string, unknown>, v: Record<string, unknown>) => number | null;
};
export type TestResult = { name: string; ok: boolean; detail: string };
export type Built = { code: string; tests: TestResult[]; ok: boolean };

const SHAPE = `({
  extract: {
    // one per "text" variable: (pageText) => value, or null if not on this page
    order_number: (text) => text.match(/KG-\\d+/)?.[0] ?? null,
  },
  compute: {
    // one per "computed" variable: (v) => value. v holds every variable plus v.today ("YYYY-MM-DD")
  },
  // the rules, in order, first match wins. Return the outcome key and the 0-based rule index.
  decide: (v) => { /* ... */ return { outcome: "refund", rule: 3 }; },
  // one test per rule, plus edge cases (exactly at a threshold, missing values)
  tests: [ { name: "lost parcel", vars: { /* every variable decide reads */ }, expect: "lost_refund" } ],
  // ONLY if there is a compare step: score one result. c = that result's candidate variables (already
  // extracted and computed), v = the item's variables. Higher is better; return null if it doesn't qualify.
  score: (c, v) => { /* ... */ return 0; },
  // ONLY with a compare step: pairs where the person's rule says "better" must outscore "worse"
  rankTests: [ { name: "cheaper per unit wins", better: { /* candidate vars */ }, worse: { /* ... */ } } ],
})`;

const compares = (spec: Spec) => [...spec.steps, ...Object.values(spec.outcomes).flatMap((o) => o.steps)].filter((s) => s.do === "compare");
function compareText(spec: Spec) {
  const c = compares(spec);
  if (!c.length) return "There is no compare step: leave out score and rankTests.\n\n";
  const cand = spec.variables.filter((v) => v.candidate).map((v) => ({ name: v.name, kind: v.kind, demoValue: v.demoValue }));
  return `Compare step: the robot opens several results and keeps the best by score(). How the person chooses: "${c.map((x) => x.said ?? x.describe).join("; ")}"
Candidate variables (score receives these as c; computed candidate variables are computed per result first):
${JSON.stringify(cand, null, 2)}
After comparing, decide() also receives best_<name> for each candidate variable, best_url, best_title and candidates_found.

`;
}

function prompt(spec: Spec, pages: { url: string; text: string }[], failures?: string, previous?: string) {
  const textVars = spec.variables.filter((v) => v.kind === "text").map((v) => ({ name: v.name, description: v.description, demoValue: v.demoValue }));
  const computed = spec.variables.filter((v) => v.kind === "computed").map((v) => ({ name: v.name, description: v.description, from: v.from, demoValue: v.demoValue }));
  const other = spec.variables.filter((v) => v.kind === "vision" || v.kind === "judge").map((v) => ({ name: v.name, kind: v.kind, values: v.kind === "vision" ? [true, false] : v.options }));
  return [
    text(`Write plain JavaScript (no imports, no async) for a browser robot. Return one code block containing a single object expression in exactly this shape:

${SHAPE}

Text variables to extract from page text (the demoValue is what the demo page showed; your extractor must return exactly that on the matching page below, same type):
${JSON.stringify(textVars, null, 2)}

Computed variables:
${JSON.stringify(computed, null, 2)}

Also in v: prev_<name> for every variable, its value from the previous run of this task, or null on the first run (use it for "change since last time"; return null when it is null).

Values the person gives per item (always present in v):
${JSON.stringify(spec.inputs.columns ?? [], null, 2)}

Variables filled by vision or judgement before decide runs (decide receives these too):
${JSON.stringify(other, null, 2)}

${compareText(spec)}Rules, in order (first match wins):
${spec.rules.map((r, i) => `${i}. if ${r.if} -> ${r.then}${r.said ? `   (person said: "${r.said}")` : ""}`).join("\n")}

Notes: compare strings case-insensitively and trim them. Dates on the pages are YYYY-MM-DD; compute day differences in UTC so time zones can't shift them. Make extractors robust to layout changes: anchor on labels and value formats, not on line positions.

Pages recorded in the demo:
${pages.map((p) => `--- ${p.url}\n${p.text}`).join("\n\n")}`),
    ...(failures ? [text(`Your previous code:\n${previous}\n\nIt failed these checks. Fix it and return the whole object again:\n${failures}`)] : []),
  ];
}

export function load(code: string): Rules {
  // ponytail: vm keeps the generated code away from our globals and caps load time; it is not a security
  // sandbox. The code comes from our own model call and is shown to the user on the review screen.
  return vm.runInNewContext(code, Object.create(null), { timeout: 1000 });
}

const same = (a: unknown, b: unknown) =>
  typeof a === "string" && typeof b === "string" ? a.trim().toLowerCase() === b.trim().toLowerCase() : JSON.stringify(a) === JSON.stringify(b);

export function selfTest(spec: Spec, code: string, pages: { url: string; text: string }[], today: string): TestResult[] {
  const out: TestResult[] = [];
  let r: Rules & { tests?: { name: string; vars: Record<string, unknown>; expect: string }[] };
  try { r = load(code) as any; } catch (e) { return [{ name: "code loads", ok: false, detail: (e as Error).message }]; }

  // The demo was a first run: no previous values yet.
  const demo: Record<string, unknown> = { today, ...Object.fromEntries((spec.inputs.columns ?? []).map((c) => [c.name, c.demoValue])), ...Object.fromEntries(spec.variables.map((v) => [`prev_${v.name}`, null])) };
  for (const v of spec.variables) {
    if (v.kind === "text") {
      const fn = r.extract?.[v.name];
      if (!fn) { out.push({ name: `extract ${v.name}`, ok: false, detail: "no extractor" }); continue; }
      const got = pages.map((p) => { try { return fn(p.text); } catch { return null; } }).find((x) => x !== null && x !== undefined);
      demo[v.name] = got;
      out.push({ name: `extract ${v.name}`, ok: same(got, v.demoValue), detail: `got ${JSON.stringify(got)}, demo showed ${JSON.stringify(v.demoValue)}` });
    } else if (v.kind !== "computed") demo[v.name] = v.demoValue;
  }
  for (const v of spec.variables.filter((x) => x.kind === "computed")) {
    // The demo's day count was true on the recording day, so compute it with that day.
    try {
      const got = r.compute[v.name](demo);
      demo[v.name] = got;
      out.push({ name: `compute ${v.name}`, ok: same(got, v.demoValue), detail: `got ${JSON.stringify(got)}, demo had ${JSON.stringify(v.demoValue)}` });
    } catch (e) { out.push({ name: `compute ${v.name}`, ok: false, detail: (e as Error).message }); }
  }
  if (compares(spec).length) {
    const c = Object.fromEntries(spec.variables.filter((v) => v.candidate).map((v) => [v.name, demo[v.name]]));
    for (const [k, val] of Object.entries(c)) demo[`best_${k}`] = val;
    demo.candidates_found = 1;
    try {
      const s = r.score?.(c, demo);
      out.push({ name: "the result you picked qualifies", ok: typeof s === "number", detail: `score() gave ${JSON.stringify(s)}` });
    } catch (e) { out.push({ name: "the result you picked qualifies", ok: false, detail: (e as Error).message }); }
    for (const t of (r as any).rankTests ?? []) {
      try {
        const a = r.score?.(t.better, demo), b = r.score?.(t.worse, demo);
        out.push({ name: `ranking: ${t.name}`, ok: typeof a === "number" && (b === null || (typeof b === "number" && a > b)), detail: `better scored ${a}, worse scored ${b}` });
      } catch (e) { out.push({ name: `ranking: ${t.name}`, ok: false, detail: (e as Error).message }); }
    }
  }
  const shown = Object.entries(spec.outcomes).find(([, o]) => o.demonstrated)?.[0];
  try {
    const d = r.decide(demo);
    out.push({ name: "demo case decides like the person did", ok: d?.outcome === shown, detail: `decide() said ${d?.outcome}, the person did ${shown}` });
  } catch (e) { out.push({ name: "demo case decides like the person did", ok: false, detail: (e as Error).message }); }
  for (const t of r.tests ?? []) {
    try {
      const d = r.decide({ today, ...t.vars });
      out.push({ name: `rule test: ${t.name}`, ok: d?.outcome === t.expect, detail: `expected ${t.expect}, got ${d?.outcome}` });
    } catch (e) { out.push({ name: `rule test: ${t.name}`, ok: false, detail: (e as Error).message }); }
  }
  const unknown = Object.keys(spec.outcomes);
  for (const t of r.tests ?? []) if (!unknown.includes(t.expect)) out.push({ name: `rule test: ${t.name}`, ok: false, detail: `"${t.expect}" is not an outcome` });
  return out;
}

const codeBlock = (reply: string) => (/```(?:js|javascript)?\s*\n([\s\S]*?)```/.exec(reply)?.[1] ?? reply).trim();

export async function build(spec: Spec, pages: { url: string; text: string }[], today: string): Promise<Built> {
  let code = codeBlock(await respond(prompt(spec, pages), "build"));
  let tests = selfTest(spec, code, pages, today);
  if (tests.some((t) => !t.ok)) {
    // One repair round with the failing checks, like a developer reading test output.
    const failures = tests.filter((t) => !t.ok).map((t) => `- ${t.name}: ${t.detail}`).join("\n");
    code = codeBlock(await respond(prompt(spec, pages, failures, code), "build:fix"));
    tests = selfTest(spec, code, pages, today);
  }
  return { code, tests, ok: tests.every((t) => t.ok) };
}
