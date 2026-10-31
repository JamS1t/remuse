// What Remuse never presses on its own: these wait for your OK, in every run. No model, no browser.
// Run: node test/gate.check.ts
import { gatedStep } from "../src/runner.ts";
import type { Step } from "../src/understand.ts";

let fails = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (${JSON.stringify(detail)})`}`); if (!ok) fails++; };
const click = (name: string) => ({ id: "s", do: "click", describe: name, target: { role: "button", name } }) as Step;

for (const name of ["Turn in", "Hand in", "Mark as done", "Checkout", "Place order", "Send", "Submit", "Archive"]) check(`"${name}" waits for your OK`, gatedStep(click(name)));
for (const name of ["Add or create", "File", "Open", "View instructions"]) check(`"${name}" doesn't`, !gatedStep(click(name)));

console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
