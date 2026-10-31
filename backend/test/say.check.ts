// What Remuse says out loud after practicing on your example. No model. Run: node test/say.check.ts
import { practiceSay } from "../web/src/lib/say.ts";

let fails = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (${JSON.stringify(detail)})`}`); if (!ok) fails++; };

const p = (result: object) => ({ runId: "r", status: "done", label: "Video stats", result: { sameItem: true, values: [], ...result } }) as any;
const ok = p({ values: [{ name: "views", got: "2,607", want: "2,607", ok: true }, { name: "ctr", got: "5.1%", want: "5.1%", ok: true }] });
const stuck = p({ problem: "the Reach tab wasn't there." });
const bad = p({ values: [{ name: "views", got: "2,600", want: "2,607", ok: false }, { name: "ctr", got: "5.1%", want: "5.1%", ok: true }] });
const none = p({ values: [{ name: "avg_view_duration", got: null, want: "3:04", ok: false }] });
const stopped = p({ values: [{ name: "views", got: "2,607", want: "2,607", ok: true }], stoppedBefore: "Send the reply" });

check("all read right", practiceSay(ok) === "That worked. I read views 2,607, ctr 5.1%.", practiceSay(ok));
check("stuck", practiceSay(stuck) === "I got stuck: the Reach tab wasn't there.", practiceSay(stuck));
check("a wrong value", practiceSay(bad) === "I read views as 2,600, but you saw 2,607.", practiceSay(bad));
check("a value it couldn't read", practiceSay(none) === "I couldn't read avg view duration. You saw 3:04.", practiceSay(none));
check("stopped before something it would send", practiceSay(stopped) === `That worked. I read views 2,607. I stopped before "send the reply"; real runs wait for your OK there.`, practiceSay(stopped));

console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
