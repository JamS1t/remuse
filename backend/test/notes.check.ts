// Live notes while teaching: cards must cite words or real events, and only a real "I'm done" ends the demo.
// No model calls. Run: node test/notes.check.ts
import { applyOps, endPhrase } from "../src/notes.ts";

let fails = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (${JSON.stringify(detail)})`}`); if (!ok) fails++; };

for (const s of ["Okay, that's it.", "tapos na", "Alright, proceed.", "I'm done now", "okay so that's all Remuse", "sige na po", "Okay Remuse.", "Ayan na."]) check(`"${s}" ends the demo`, endPhrase(s));
for (const s of ["I'm done with this tab", "that's it for the title", "proceed to the next page and click", "go ahead and click Reach", "", "na"]) check(`"${s}" doesn't`, !endPhrase(s));

const known = new Set([12, 13]);
const c = applyOps([], [
  { op: "add", card: { kind: "step", text: "Open Analytics", events: [12] } },
  { op: "add", card: { kind: "read", text: "Read the views", quote: "I want the views" } },
  { op: "add", card: { kind: "step", text: "Watch this", events: [99] } }, // invented event
  { op: "add", card: { kind: "step", text: "Hover the chart" } }, // no evidence
  { op: "add", card: { kind: "vibe" as any, text: "x", quote: "y" } }, // unknown kind
  { op: "add", card: { kind: "rule", text: "  ", quote: "y" } }, // no text
], known);
check("invented event ids and quote-less cards are dropped", c.length === 2 && c[0].id === "c1" && c[1].id === "c2", c);
check("a card keeps only the events that really happened", JSON.stringify(applyOps([], [{ op: "add", card: { kind: "step", text: "Open it", events: [12, 99] } }], known)[0].events) === "[12]");
const d = applyOps(c, [{ op: "edit", id: "c1", card: { text: "Open the Analytics tab" } }, { op: "remove", id: "c2" }, { op: "remove", id: "c9" }], known);
check("edit and remove by id; unknown ids ignored", d.length === 1 && d[0].text === "Open the Analytics tab", d);
check("an edit that would leave a card with no evidence is ignored", applyOps(c, [{ op: "edit", id: "c2", card: { quote: "" } }], known)[1].quote === "I want the views");
check("new ids follow the highest id there is", applyOps(d, [{ op: "add", card: { kind: "question", text: "Every video?", quote: "my videos" } }], known).at(-1)!.id === "c2");

console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
