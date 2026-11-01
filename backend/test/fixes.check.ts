// What Remuse keeps from a fix it worked out: proposed once its step is proven, learned once the whole item is done,
// dropped after it fails twice in a row. No model, no browser. Run: node test/fixes.check.ts
import { failed, promote, worked, type Fix } from "../src/fixes.ts";

let fails = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (${JSON.stringify(detail)})`}`); if (!ok) fails++; };

const fix: Fix = { task: "t1", group: "Open the attach menu", move: { strategy: "clicked", role: "button", name: "Add attachment", selector: "#plus" }, state: "proposed", fails: 0 };

check("a proposed fix stays proposed if its item didn't finish", promote(fix, false).state === "proposed");
check("and becomes learned once the whole item is done", promote(fix, true).state === "learned" && !!promote(fix, true).provenAt);
const learned = promote(fix, true);
check("one failure keeps it, counted", failed(learned)?.state === "learned" && failed(learned)?.fails === 1);
check("a second failure in a row drops it", failed(failed(learned)!) === null);
check("working again resets the count", worked(failed(learned)!).fails === 0);

console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
