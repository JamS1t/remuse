// Each file (or item) is matched to its place on the site by the person's own rule: exactly one fit goes ahead;
// none or several means asking, never a guess. No model. Run: node test/match.check.ts
import { matchOutcome } from "../src/recover.ts";
import { normalize, type Spec } from "../src/understand.ts";

let fails = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (${JSON.stringify(detail)})`}`); if (!ok) fails++; };

check("exactly one fit opens it", matchOutcome([2]) === "open");
check("no fit asks", matchOutcome([]) === "none");
check("two fits ask, never the first", matchOutcome([1, 3]) === "several");

// Learning keeps a match step with the person's rule.
const spec = {
  title: "Submit labs", goal: "g", scope: "", scopeTypes: [], inputs: { source: "once", itemName: "lab" }, variables: [],
  steps: [
    { id: "s1", do: "goto", url: "https://classroom.google.com/c/1", describe: "Open the class" },
    { id: "s2", do: "match", target: { role: "link" }, said: "match it by the course code in the file name", describe: "Open the assignment for this file" },
  ],
  rules: [{ if: "otherwise", then: "submit" }], outcomes: { submit: { describe: "Turn it in", steps: [] } },
} as unknown as Spec;
normalize(spec, { id: "t", events: [], turns: [] } as any);
const m = spec.steps.find((s) => s.id === "s2");
check("learning keeps a match step and its rule", m?.do === "match" && m.said === "match it by the course code in the file name" && m.target?.role === "link", m);

console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
