// What Remuse says when it reads its plan back: plain sentences from the task itself, no model.
// Run: node test/readback.check.ts
import { readback } from "../src/readback.ts";
import type { Spec } from "../src/understand.ts";

let fails = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (${JSON.stringify(detail)})`}`); if (!ok) fails++; };

const step = (id: string, describe: string) => ({ id, do: "click", describe });
const spec = (n: number, extra: Partial<Spec> = {}) => ({
  title: "t", goal: "g", scope: "", scopeTypes: [], inputs: { source: "once", itemName: "update" }, variables: [],
  steps: [step("s1", "Open YouTube Studio."), ...Array.from({ length: n - 1 }, (_, i) => step(`s${i + 2}`, `Step thing ${i + 2}`))],
  rules: [{ if: "item_type == 'damaged'", then: "refund", said: "it's damaged" }, { if: "late", then: "reply", said: "if it's late, just reply sorry." }, { if: "otherwise", then: "skip" }],
  outcomes: { refund: { describe: "Refund it.", demonstrated: true, steps: [] }, reply: { describe: "Reply", demonstrated: false, steps: [] }, skip: { describe: "Skip", demonstrated: true, steps: [] } },
  ...extra,
} as unknown as Spec);

const r = readback(spec(3, { questions: [{ id: "q-cover-1", text: "Every video, or only the newest?", quote: "only new videos" }, { id: "q-s9", text: "I wasn't sure about \"Click Delete\". Did you do that?" }] }));
check("plan starts with the intro and numbers each step", r.plan[0].text === "Here's my plan." && r.plan[1].text === "Step 1: Open YouTube Studio." && r.plan[1].step === "s1", r.plan.slice(0, 2));
check("rules read as 'If …, I'll …'", r.plan.some((l) => l.text === "If it's damaged, I'll refund it."), r.plan.map((l) => l.text));
check("a rule said as a whole sentence is read as said", r.plan.some((l) => l.text === "If it's late, just reply sorry."), r.plan.map((l) => l.text));
check("a plain 'otherwise' rule isn't read out", !r.plan.some((l) => /otherwise/i.test(l.text)));
check("a question quotes the person", r.questions[0].text === `One thing: you said "only new videos". Every video, or only the newest?` && r.questions[0].question === "q-cover-1", r.questions);
check("a question without a quote is just the question", r.questions[1].text === "I wasn't sure about \"Click Delete\". Did you do that?" && r.questions[1].question === "q-s9");
const long = readback(spec(11));
check("over 8 steps: 8, then how many more", long.plan.filter((l) => l.step).length === 8 && long.plan.some((l) => l.text === "And 3 more steps, all on the screen."), long.plan.map((l) => l.text));
check("no questions: none", readback(spec(2)).questions.length === 0);
const doIt = readback(spec(2, { rules: [{ if: "otherwise", then: "skip", said: "Open the report page and read the total." }] } as any));
check("a do-it-every-time rule isn't read as an 'If'", !doIt.plan.some((l) => /^If /.test(l.text)), doIt.plan.map((l) => l.text));

console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
