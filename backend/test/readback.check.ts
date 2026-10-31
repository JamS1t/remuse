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
let odd: ReturnType<typeof readback> | null = null;
try { odd = readback(spec(2, { rules: [{ then: "skip" }, { if: "late", then: undefined }] } as any)); } catch { /* the review would never start */ }
check("a rule with no condition or outcome doesn't stop the readback", !!odd && odd.plan[0].text === "Here's my plan.", odd?.plan.map((l) => l.text));
// A schedule heard in the demo ("every hour") is said back, with when it starts: the review sets it up on "looks right".
const hourly = readback(spec(2, { schedule: { everyMinutes: 60, said: "every hour" } } as any));
check("a schedule you asked for is read back", hourly.plan.at(-1)?.text === `You said "every hour". Once it looks right, I'll repeat it on that schedule, even with Chrome closed.`, hourly.plan.map((l) => l.text));
check("no schedule asked: none read", !readback(spec(2)).plan.some((l) => /schedule/i.test(l.text)));

// James's receipts plan: the spreadsheet keypresses (Name Box, Ctrl+End, Home, Down, Tab, Enter) are how a step is
// done, not steps of their own. Read and shown as the steps a person would name.
const sheet = (id: string, d: string, extra: object) => ({ id, describe: d, ...extra });
const receipts = {
  ...spec(1), rules: [],
  steps: [
    sheet("s1", "Open the receipt email from the inbox list", { do: "open_item" }),
    sheet("s2", "Read merchant, total, order date and email type from the receipt", { do: "extract", vars: ["merchant"] }),
    sheet("s3", "Open the Receipts sheet", { do: "goto", url: "https://docs.google.com/spreadsheets/d/x" }),
    sheet("s4", "Go to cell A1 to find the first empty row", { do: "fill", target: { role: "textbox", name: "Name Box" }, value: "A1" }),
    sheet("s5", "Confirm cell A1 selection", { do: "press", key: "Enter", target: { role: "textbox", name: "Name Box" } }),
    sheet("s6", "Jump to end of used range", { do: "press", key: "Control+End" }),
    sheet("s7", "Go to start of last row", { do: "press", key: "Home" }),
    sheet("s8", "Land on first empty row", { do: "press", key: "ArrowDown" }),
    sheet("s9", "Type merchant name", { do: "fill", value: "{{merchant}}" }),
    sheet("s10", "Move to next column", { do: "press", key: "Tab" }),
    sheet("s11", "Type total amount", { do: "fill", value: "{{total}}" }),
    sheet("s12", "Move to next column", { do: "press", key: "Tab" }),
    sheet("s13", "Type order date", { do: "fill", value: "{{order_date}}" }),
    sheet("s14", "Confirm date entry", { do: "press", key: "Enter" }),
    sheet("s15", "Archive the receipt email", { do: "click", target: { role: "button", name: "Archive" } }),
  ],
} as unknown as Spec;
const every = readback(spec(2, { rules: [{ if: "item_type == 'receipt'", then: "log_and_archive", said: "every receipt that goes to my Gmail I log it on my Google Sheets" }], outcomes: { log_and_archive: { describe: "Log it and archive", demonstrated: true, steps: [] } } } as any));
check("a rule said as \"every …\" is read as said", every.plan.some((l) => l.text === "Every receipt that goes to my Gmail I log it on my Google Sheets.") && !every.plan.some((l) => /^If every/.test(l.text)), every.plan.map((l) => l.text));
const rr = readback(receipts);
const said = rr.plan.filter((l) => l.step).map((l) => l.text);
check("keypresses aren't read as steps of their own", !said.some((t) => /Confirm|Move to next column|Jump to end|Go to start of last row|Land on first empty row/.test(t)), said);
check("the empty-row recipe is one step", said.includes("Step 4: Go to the next empty row."), said);
check("the plan reads as a person would say it", said.length === 8 && said[7] === "Step 8: Archive the receipt email.", said);
check("each shown step knows the steps it stands for", JSON.stringify(rr.steps.find((g) => g.text === "Go to the next empty row")?.ids) === '["s4","s5","s6","s7","s8"]' && JSON.stringify(rr.steps.find((g) => g.text === "Type merchant name")?.ids) === '["s9","s10"]', rr.steps);

console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
