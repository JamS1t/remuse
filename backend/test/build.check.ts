// The rules code's self-checks must catch a decide() that gives no outcome, e.g. "report nothing on the first run"
// when the person's only rule is "otherwise -> report". No model calls. Run: node test/build.check.ts
import { selfTest } from "../src/build.ts";
import type { Spec } from "../src/understand.ts";

let fails = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (${JSON.stringify(detail)})`}`); if (!ok) fails++; };

const page = { url: "https://studio.youtube.com/video/x/analytics", text: "Video analytics\nThis video has had 2,595 views since it was published" };
const monitor = {
  title: "Monitor video analytics", inputs: { source: "once" },
  variables: [
    { name: "views", kind: "text", description: "views", demoValue: "2,595" },
    { name: "views_change", kind: "computed", description: "change since last time", demoValue: null },
  ],
  rules: [{ if: "otherwise", then: "report", said: "I want you to monitor" }],
  outcomes: { report: { describe: "Report", demonstrated: false, steps: [{ id: "r1", do: "report", message: "Views {{views}}", describe: "Report" }] } },
  steps: [],
} as unknown as Spec;
const code = (decide: string, tests = "[]") => `({
  extract: { views: (t) => t.match(/had\\s+([\\d,]+)\\s*views/)?.[1] ?? null },
  compute: { views_change: (v) => v.prev_views == null ? null : 0 },
  decide: ${decide},
  tests: ${tests},
})`;
const failed = (r: ReturnType<typeof selfTest>) => r.filter((t) => !t.ok).map((t) => `${t.name}: ${t.detail}`);

// What Muse Spark wrote for the first real task: nothing on the first run.
let r = selfTest(monitor, code(`(v) => { if (v.views_change == null) return undefined; return { outcome: "report", rule: 0 }; }`), [page], "2026-10-31");
check("no outcome on the demo's own case is caught, though nothing was demonstrated", failed(r).some((f) => /^demo case/.test(f)), failed(r));
check("…and the failure says which outcomes it must pick from", failed(r).some((f) => /report/.test(f) && /must/.test(f)), failed(r));

// A rule test expecting "nothing" is caught too, with what to return instead.
r = selfTest(monitor, code(`(v) => ({ outcome: "report", rule: 0 })`, `[{ name: "first run", vars: { views: "1" }, expect: undefined }]`), [page], "2026-10-31");
check("a rule test that expects no outcome is caught, saying what decide must return", failed(r).some((f) => /is not an outcome/.test(f) && /report/.test(f)), failed(r));

// The right code passes everything.
r = selfTest(monitor, code(`(v) => ({ outcome: "report", rule: 0 })`, `[{ name: "first run", vars: { views: "1", views_change: null }, expect: "report" }]`), [page], "2026-10-31");
check("always reporting passes every check", failed(r).length === 0, failed(r));

// When an outcome was demonstrated, the demo case must still pick exactly that one.
const shown = { ...monitor, rules: [{ if: "views over 1000", then: "report" }, { if: "otherwise", then: "skip" }], outcomes: { report: { ...monitor.outcomes.report, demonstrated: true }, skip: { describe: "Skip", demonstrated: false, steps: [] } } } as unknown as Spec;
r = selfTest(shown, code(`(v) => ({ outcome: "skip", rule: 1 })`), [page], "2026-10-31");
check("a demonstrated outcome must still be the one picked", failed(r).some((f) => /^demo case/.test(f)), failed(r));

// Without a catch-all ("if damaged -> refund" only), an item no rule fits may get no outcome: it stops, never refunds.
const noCatchAll = { ...monitor, rules: [{ if: "views over 1000", then: "report" }] } as unknown as Spec;
r = selfTest(noCatchAll, code(`(v) => null`), [page], "2026-10-31");
check("without a catch-all, no outcome on the demo case is allowed", failed(r).length === 0, failed(r));

console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
