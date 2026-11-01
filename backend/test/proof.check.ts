// How a step's result is judged: proof from the page beats a look at the screen, and a write needs page proof.
// No model. Run: node test/proof.check.ts
import { combine, newlyAppeared, sameValue, usedInWrites, writes } from "../src/proof.ts";
import type { Step } from "../src/understand.ts";

let fails = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (${JSON.stringify(detail)})`}`); if (!ok) fails++; };

check("text that was already there doesn't count", !newlyAppeared("Receipts sheet", "Receipts sheet", "Receipts"));
check("text that newly appeared counts", newlyAppeared("Lab Report 5", "Lab Report 5 Lab5.pdf", "lab5.pdf"));
check("text there more times than before counts", newlyAppeared("Sent", "Sent Sent", "sent"));
check("a failed page check stays failed whatever the screen says", combine({ result: "failed", proof: "page", why: "x" }, { ok: true, why: "looks fine" }, false).result === "failed");
check("the screen can veto a page pass", combine({ result: "verified", proof: "page", why: "x" }, { ok: false, why: "error dialog" }, false).result === "failed");
check("a page pass with the screen agreeing is page proof", combine({ result: "verified", proof: "page", why: "x" }, { ok: true, why: "ok" }, true).proof === "page");
check("a screen pass alone verifies a non-write", combine(null, { ok: true, why: "ok", by: "Muse Spark Open" }, false).result === "verified");
check("and says who looked", combine(null, { ok: true, why: "ok", by: "Muse Spark Open" }, false).by === "Muse Spark Open");
check("a screen pass alone leaves a write unverified", combine(null, { ok: true, why: "ok" }, true).result === "unverified");
check("a screen fail with no page check fails", combine(null, { ok: false, why: "nothing changed" }, false).result === "failed");
check("nothing to go on is unverified", combine(null, null, false).result === "unverified");
check("₱451 = 451.00", sameValue("₱451", "451.00") && sameValue("1,799", 1799) && sameValue("₱1,388.80", "1388.8"));
check("different numbers differ", !sameValue("349", "394") && !sameValue("Subtotal 349", "Total 394"));
check("text compares without case", sameValue("Byte Café", "byte café") && !sameValue("Byte Café", "Kape Kalye"));
check("nothing equals nothing only", !sameValue(null, "0") && !sameValue("", "0"));
// Which values get a second read: any that something written uses (typed, a site tool, an address, a reply); not a
// report to you.
const spec = {
  steps: [{ id: "a", do: "fill", value: "{{total}}" }, { id: "b", do: "goto", url: "https://x/orders/{{order}}" }, { id: "c", do: "click", tool: { name: "refund", args: { amount: "{{amount}}" } } }, { id: "d", do: "report", message: "Views {{views}}" }],
  outcomes: { reply: { reply: "Hi, your refund of {{refund}} is on its way", steps: [] } },
} as any;
const used = usedInWrites(spec);
check("values typed, sent to a site tool, put in an address or a reply get a second read", ["total", "order", "amount", "refund"].every((n) => used.has(n)), [...used]);
check("a value only reported to you doesn't", !used.has("views"), [...used]);
check("fill and upload write; click doesn't", writes({ do: "fill" } as Step) && writes({ do: "upload" } as Step) && !writes({ do: "click" } as Step));

console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
