// Check: the checker model answers for real (one small question with a picture), the way runs will use it.
// With OPEN_MODEL_KEY (or BASETEN_API_KEY) in ../.env this is Muse Spark Open on Baseten (OPEN_MODEL_URL for Modal or
// Fireworks). Prints which model answered and its answer; never the key.
// Run: node --env-file-if-exists=../.env test/open.check.ts
import { askJson, calls, checker, png, text } from "../src/meta.ts";
import { chromium } from "playwright";

const c = checker();
console.log(`Checker: ${c.name} (${c.model})${c.name === "Muse Spark" ? ". No OPEN_MODEL_KEY / BASETEN_API_KEY set, so this is Muse Spark asked again." : ""}`);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 480, height: 200 } });
// One screen where the refund worked and one where it didn't: a checker that says yes to everything fails.
const ask = async (status: string, color: string) => {
  await p.setContent(`<body style="font:24px system-ui;padding:24px"><h1 style="margin:0">Order 1042</h1><p>Status: <b style="color:${color}">${status}</b></p></body>`);
  const t0 = Date.now();
  const r = await askJson<{ ok: boolean; why: string }>([
    text('A browser robot just did this step: "Refund the order". It expected: "the order shows as refunded". Look at the screen now. Did the step work? Reply with only JSON: {"ok": true|false, "why": "one short sentence"}'),
    png(await p.screenshot()),
  ], "check", c.model);
  console.log(`"${status}" → ${JSON.stringify(r)} in ${((Date.now() - t0) / 1000).toFixed(1)} s (${calls.at(-1)?.model})`);
  return r;
};
const yes = await ask("Refunded", "#16a34a");
const no = await ask("Refund failed: card declined", "#dc2626");
await b.close();
if (yes.ok !== true || no.ok !== false) { console.error("FAIL: expected ok true for the refunded screen and false for the failed one"); process.exit(1); }
console.log("PASS: the checker reads screenshots and tells a worked step from a failed one.");
