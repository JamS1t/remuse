// Every learned step must come from something the person did or said. Steps with nothing behind them are taken
// out and asked about, but a task is never emptied. No model calls. Run: node test/evidence.check.ts
import { checkEvidence } from "../src/evidence.ts";
import type { Spec, Step } from "../src/understand.ts";

let fails = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (${JSON.stringify(detail)})`}`); if (!ok) fails++; };

const A = "https://studio.youtube.com/channel/UC1/analytics";
const events = [
  { t: 0, kind: "start", url: A },
  { t: 2000, kind: "click", url: A, target: { role: "tab", label: "Analytics" } },
  { t: 4000, kind: "input", url: A, target: { role: "textbox", label: "Search" }, value: "mug" },
  { t: 5000, kind: "point", url: A, target: { role: "button", label: "Ghost" } },
];
const spec = (steps: Partial<Step>[], outcomes: Spec["outcomes"] = {}) => ({
  title: "t", goal: "g", scope: "", scopeTypes: [], inputs: { source: "once", itemName: "update" }, variables: [{ name: "views", kind: "text", description: "views" }],
  steps: steps.map((s) => ({ describe: s.id, ...s })), rules: [], outcomes,
} as unknown as Spec);
const click = (id: string, name: string, ev?: number[]) => ({ id, do: "click" as const, target: { role: name === "Analytics" ? "tab" : "button", name }, ...(ev ? { evidence: { events: ev } } : {}) });

const one = spec([click("s1", "Analytics", [1])]);
checkEvidence(one, events);
check("a step citing a real click keeps it and sets fromEvent", one.steps[0].fromEvent === 1, one.steps[0]);

const two = spec([{ id: "s1", do: "goto", url: A }, click("s2", "Analytics"), { id: "s3", do: "extract", vars: ["views"] }]);
checkEvidence(two, events);
check("an uncited click step is re-cited by its target", two.steps.find((s) => s.id === "s2")?.evidence?.events[0] === 1, two.steps);
check("an uncited goto is re-cited by its URL", two.steps[0].evidence?.events[0] === 0, two.steps[0]);
check("a read step is kept without events", two.steps.some((s) => s.id === "s3"));

const three = spec([{ id: "s1", do: "goto", url: A, evidence: { events: [0] } }, click("s9", "Delete")]);
checkEvidence(three, events);
check("an unbacked click is removed and asked about, with the step kept on the question", !three.steps.some((s) => s.id === "s9") && three.questions?.[0]?.id === "q-s9" && three.questions[0].step?.id === "s9" && three.questions[0].after === "s1", three);
check("the question says which step", /I wasn't sure about "s9"\. Did you do that\?/.test(three.questions?.[0]?.text ?? ""), three.questions);

const four = spec([click("s1", "Analytics", [1]), click("s3", "Ghost", [3])]);
checkEvidence(four, events);
check("a step citing a resting-mouse event counts as unbacked", !four.steps.some((s) => s.id === "s3"), four.steps);

const five = spec([click("s1", "Ghost"), click("s2", "Phantom")]);
checkEvidence(five, events);
check("no step cited and none matchable: all kept, one question", five.steps.length === 2 && five.questions?.length === 1 && five.questions[0].id === "q-evidence", five);

const six = spec([click("s1", "Analytics", [1])], { refund: { describe: "Refund", demonstrated: false, steps: [click("r1", "Refund") as Step] } });
checkEvidence(six, events);
check("undemonstrated outcome steps are left alone", six.outcomes.refund.steps.length === 1 && !six.questions?.length, six);

const seven = spec([click("s1", "Analytics", [99])]);
checkEvidence(seven, events);
check("an out-of-range event is not evidence, but the target still matches", seven.steps[0].evidence?.events[0] === 1, seven.steps[0]);

console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
