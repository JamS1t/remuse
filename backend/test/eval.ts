// Evaluation: how well Remuse does the hero task, in numbers. The task (customer complaints across the three test
// sites) is learned once from a recorded demo (the extension, a narration with the rules said out loud, Muse Spark)
// and kept in docs/eval/hero-task.json, so every evaluation runs the same learned task. Then it handles all 15
// emails on the store as recorded and on a redesigned store, answering Remuse's questions the way a person would,
// and writes docs/eval.md: right decisions, questions, wrong irreversible actions, layout fixes, model calls, time.
// Needs: mock apps on :3100 (cd mock-apps && npm start), port 3200 free, model access (../.env or the Remuse proxy).
// Run: node test/eval.ts [--relearn]
import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { meaning } from "../src/runner.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MOCK = "http://localhost:3100";
const API = "http://127.0.0.1:3200/api";
const OUT = join(ROOT, "docs", "eval");
const TASK = join(OUT, "hero-task.json");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const get = async (p: string) => (await fetch(API + p)).json();
const post = async (p: string, b: unknown = {}) => (await fetch(API + p, { method: "POST", body: JSON.stringify(b) })).json();
const mock = (p: string) => fetch(`${MOCK}${p}`, { method: "POST" });

await fetch(MOCK).catch(() => { console.error("Mock apps not running on :3100. Start them: cd mock-apps && npm start"); process.exit(1); });
if (await fetch(`${API}/sessions`).then(() => true, () => false)) { console.error("Port 3200 is busy: stop the Remuse Agent first."); process.exit(1); }
mkdirSync(OUT, { recursive: true });

let agent: ChildProcess | null = null;
const startAgent = async (data: string) => {
  // The checker as configured in ../.env (Muse Spark Open with a partner key), so the numbers are the real setup's.
  agent = spawn(process.execPath, ["--env-file-if-exists=../.env", "src/server.ts"], {
    cwd: join(ROOT, "backend"), env: { ...process.env, DATA_DIR: data, HEADLESS: "1", SHOWRUN_NO_NOTIFY: "1" }, stdio: process.env.SHOW_AGENT ? "inherit" : "ignore",
  });
  for (let i = 0; i < 60 && !(await fetch(`${API}/sessions`).then((r) => r.ok, () => false)); i++) await sleep(250);
};
const stopAgent = async () => { agent?.kill(); agent = null; await sleep(1500); };

// ---- 1. The learned task: recorded once through the extension and learned by Muse Spark, then kept. ----
async function learn() {
  console.log("Learning the hero task from a recorded demo (a few minutes)…");
  await mock("/api/reset"); await mock("/api/layout?v=v1");
  const data = mkdtempSync(join(tmpdir(), "remuse-eval-learn-"));
  await startAgent(data);
  const narration = join(ROOT, "scripts", "fixtures", "narration-full.wav");
  const narrationMs = ((readFileSync(narration).length - 44) / 32000) * 1000;
  const ext = join(ROOT, "extension");
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "remuse-eval-profile-")), {
    channel: "chromium", headless: true, viewport: { width: 1440, height: 900 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${narration}`],
  });
  try {
    const worker = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto(`${MOCK}/inbox`);
    const pause = () => page.waitForTimeout(1500);
    const started = await worker.evaluate(() => (globalThis as any).showrun.start("Resolve a complaint"));
    // The demo: one complaint, handled across the inbox, the store and the courier tracker.
    await page.getByRole("link", { name: /Maria Santos/ }).click(); await pause();
    await page.goto(`${MOCK}/store`); await pause();
    await page.getByRole("textbox", { name: "Search orders" }).fill("KG-10401");
    await page.keyboard.press("Enter"); await pause();
    await page.getByRole("link", { name: "KG-10401" }).click(); await pause();
    await page.goto(`${MOCK}/courier`); await pause();
    await page.getByRole("textbox", { name: "Tracking number" }).fill("BX782137PH");
    await page.getByRole("button", { name: "Track" }).click(); await pause();
    await page.goto(`${MOCK}/store/orders/KG-10401`); await pause();
    await page.getByRole("textbox", { name: "Replacement reason" }).fill("Mug arrived cracked, photo in email");
    await page.getByRole("button", { name: "Replace" }).click(); await pause();
    await page.goto(`${MOCK}/inbox/m001`); await pause();
    await page.locator("#reply-body").fill("Hi Maria, sorry about the mug. A replacement is on its way.");
    await page.getByRole("button", { name: "Send reply" }).click(); await pause();
    await page.waitForTimeout(Math.max(0, started.t0 + narrationMs + 1500 - Date.now())); // the narration says the rules
    const done = await worker.evaluate(() => (globalThis as any).showrun.stop());
    let t: any;
    for (let i = 0; i < 120; i++) { t = (await get("/tasks")).find((x: any) => x.sessionId === done.id); if (t?.learnStage === "ready" || t?.learnStage === "failed") break; await sleep(3000); }
    if (t?.learnStage !== "ready") throw new Error(`learning didn't finish: ${t?.learnStage} ${t?.learnError ?? ""}`);
    const row = await get(`/specs/${t.specId}`);
    const s = await get(`/sessions/${done.id}`);
    writeFileSync(TASK, JSON.stringify({ learnedAt: new Date().toISOString(), transcript: s.transcript, checks: row.tests, spec: row.spec, code: row.code,
      demo: s.events.find((e: any) => e.kind === "click" && /Maria Santos/.test(e.target?.label ?? e.target?.text ?? "")) ?? null }, null, 2));
    console.log(`Learned: "${row.spec.title}", ${row.spec.rules.length} rules, ${row.tests.filter((x: any) => x.ok).length}/${row.tests.length} checks pass against the demo.`);
  } finally { await ctx.close().catch(() => {}); await stopAgent(); await mock("/api/reset"); }
}
if (process.argv.includes("--relearn") || !existsSync(TASK)) await learn();
const task = JSON.parse(readFileSync(TASK, "utf8"));

// ---- 2. Runs: all 15 emails, as recorded and redesigned. ----
// site: what the store really shows afterwards (null when it wasn't captured, e.g. a report from saved data).
type Result = { name: string; layout: string; run: any; calls: any[] | null; ms: number; asked: number; askedNeeded: number; reused: number; right: number; total: number; alone: number; aloneRight: number; wrongActs: string[]; heals: number; site: { matched: number; wrong: string[] } | null };
const gated = new Set(Object.entries(task.spec.outcomes as Record<string, any>).filter(([, o]) => o.steps.some((x: any) => x.irreversible || /\b(refund|replace|send|ship|issue|confirm|submit)\b/i.test(x.target?.name ?? ""))).map(([k]) => k));
// A refund for a lost parcel counts as right whatever the outcome is called: the learned task may use one refund
// outcome for both (the store action is the same; the reply wording differs). The report says so.
const same = (o: string | undefined, want: string) => meaning(o) === want || (want === "lost_refund" && meaning(o) === "refund");
// What each decision leaves on the store: the order's status.
const STATE: Record<string, string> = { replace: "replacement_sent", refund: "refunded", lost_refund: "refunded", decline: "paid" };
/** The store afterwards, email by email: did each order end up the way Remuse said it decided, with a reply sent?
 *  And did anything change on an order that shouldn't have (a wrong refund or replacement)? */
function siteCheck(run: any, state: any) {
  let matched = 0; const wrong: string[] = [];
  for (const e of state.emails) {
    const it = run.items.find((i: any) => i.url?.endsWith(`/${e.id}`));
    const order = state.orders.find((o: any) => o.id === /KG-\d+/.exec(e.body)?.[0]);
    if (!it || !order) continue;
    if (it.status === "done" && order.status === STATE[meaning(it.outcome) ?? ""] && e.reply) matched++;
    const want = state.expected[e.id];
    if (want && want !== "ask" && order.status !== "paid" && order.status !== STATE[want]) wrong.push(`${e.fromName}: order is ${order.status}, should be ${STATE[want]}`);
  }
  return { matched, wrong };
}
function score(name: string, layout: string, run: any, calls: any[] | null, site: Result["site"] = null): Result {
  const scored = run.items.filter((i: any) => i.expected);
  const right = (i: any) => i.status === "done" && (i.expected === "ask" ? i.decidedBy !== "rules" : same(i.outcome, i.expected));
  // A wrong irreversible action: something that can't be undone, done on an email that needed something else
  // (including acting by the rules on one that should have been asked about).
  const wrongActs = run.items.filter((i: any) => i.status === "done" && i.expected && gated.has(i.outcome) && (i.expected === "ask" ? i.decidedBy === "rules" : !same(i.outcome, i.expected))).map((i: any) => `${i.label}: did ${i.outcome}, should ${i.expected === "ask" ? "have asked" : i.expected}`);
  const asked = run.items.filter((i: any) => i.decidedBy === "you");
  const alone = run.items.filter((i: any) => i.decidedBy === "rules" && i.expected);
  return { name, layout, run, calls, site, ms: (run.endedAt ?? Date.now()) - run.startedAt, asked: asked.length, askedNeeded: asked.filter((i: any) => i.expected === "ask").length,
    reused: run.items.filter((i: any) => i.decidedBy === "learned").length, right: scored.filter(right).length, total: scored.length,
    alone: alone.length, aloneRight: alone.filter(right).length, wrongActs, heals: new Set(run.heals.map((h: any) => h.to)).size };
}
// --report <dataDir>: the report from a finished evaluation's saved data. Its runs are on disk; its model-call log and
// the store's state afterwards are not, so those show as not measured (nothing is borrowed from other runs).
const reportAt = process.argv.indexOf("--report");
const saved = reportAt > 0 ? process.argv[reportAt + 1] : null;
const results: Result[] = [];
let practice: any = null;
let callsNote = "";
if (saved) {
  const runs = (new DatabaseSync(join(saved, "showrun.db"), { readOnly: true }).prepare("SELECT json FROM runs ORDER BY updated_at").all() as any[]).map((r) => JSON.parse(r.json));
  runs.filter((r) => !r.mode).slice(-2).forEach((r, k) => results.push(score(k ? "Store redesigned (new labels, new layout)" : "Store as recorded", k ? "v2" : "v1", r, null)));
  practice = runs.filter((r) => r.mode === "practice").at(-1) ?? null;
  callsNote = "Written from the run's saved data after the evaluation was stopped (low memory) before it could write its report, so model calls and the store's state afterwards weren't captured.";
}
const data = mkdtempSync(join(tmpdir(), "remuse-eval-"));
if (!saved) await startAgent(data);
if (!saved) try {
  const s = await post("/sessions", { title: task.spec.title, startedAt: Date.now() });
  const db = new DatabaseSync(join(data, "showrun.db"));
  if (task.demo) db.prepare("INSERT INTO events (session_id, t, kind, url, data) VALUES (?, ?, 'click', ?, ?)").run(s.id, 1, task.demo.url ?? `${MOCK}/inbox`, JSON.stringify({ target: task.demo.target }));
  const specId = Number(db.prepare("INSERT INTO specs (session_id, version, note, json, code, tests, created_at) VALUES (?, 1, 'eval', ?, ?, ?, ?)")
    .run(s.id, JSON.stringify({ ...task.spec, inputs: { ...task.spec.inputs, itemEvent: task.demo ? 0 : task.spec.inputs.itemEvent } }), task.code, JSON.stringify(task.checks ?? []), Date.now()).lastInsertRowid);
  db.close();

  for (const [name, layout] of [["Store as recorded", "v1"], ["Store redesigned (new labels, new layout)", "v2"]] as const) {
    await mock("/api/reset"); await mock(`/api/layout?v=${layout}`);
    console.log(`\n${name}: running all emails…`);
    const t0 = Date.now();
    const r = await post(`/specs/${specId}/runs`, { autoApprove: true, redo: true });
    let run: any;
    for (let i = 0; i < 1800; i++) {
      run = await get(`/runs/${r.id}`);
      const p = run.pending;
      // A person's answers: the email outside the rules (a wrong item sent) gets "send the right one"; anything
      // else Remuse asks about gets what the seed says is right; a hand-off is skipped.
      if (p?.kind === "ask") {
        const it = run.items[p.item];
        const want = it.expected && it.expected !== "ask" ? it.expected : "replace";
        const outcome = p.options.find((o: string) => meaning(o) === want) ?? (want === "lost_refund" ? p.options.find((o: string) => meaning(o) === "refund") : undefined) ?? p.options[0];
        console.log(`  asked about "${it.label.slice(0, 50)}": ${p.question.slice(0, 120)} → ${outcome}`);
        await post(`/runs/${r.id}/answer`, { outcome, note: "Wrong item sent: ship the right one", learn: true });
      } else if (p?.kind === "handoff") { console.log(`  stuck on "${p.step}": ${p.problem}`); await post(`/runs/${r.id}/answer`, { decision: "skip" }); }
      else if (p?.kind === "plan") await post(`/runs/${r.id}/answer`, { decision: "approve_all" });
      if (["done", "failed", "stopped"].includes(run.status)) break;
      await sleep(1000);
    }
    const state = await (await fetch(`${MOCK}/api/state`)).json();
    results.push(score(name, layout, run, (await get("/calls")).filter((c: any) => c.at >= t0), siteCheck(run, state)));
    const x = results.at(-1)!;
    console.log(`  ${x.right}/${x.total} right · store matches ${x.site?.matched}/${x.total} · ${x.asked} asked · ${x.wrongActs.length + (x.site?.wrong.length ?? 0)} wrong irreversible · ${x.heals} layout fixes · ${x.calls?.length} model calls · ${(x.ms / 1000).toFixed(0)} s`);
  }

  // The practice on the demo email, the way it runs right after learning.
  await mock("/api/reset"); await mock("/api/layout?v=v1");
  const p = await post(`/specs/${specId}/practice`);
  for (let i = 0; i < 300; i++) { practice = await get(`/runs/${p.id}`); if (["done", "failed", "stopped"].includes(practice.status)) break; await sleep(1000); }
} finally { await stopAgent(); await mock("/api/reset"); await mock("/api/layout?v=v1"); }

// ---- 3. The write-up. ----
const byLabel = (calls: any[] | null) => !calls ? "not measured" : Object.entries(calls.reduce((m: Record<string, number>, c: any) => ((m[c.label.replace(/:repair$/, "")] = (m[c.label.replace(/:repair$/, "")] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ");
const models = (calls: any[] | null) => (!calls ? "not measured" : [...new Set(calls.map((c: any) => c.model))].join(", "));
const secs = (ms: number) => `${(ms / 1000).toFixed(0)} s`;
const pr = practice?.practice;
const md = `# Evaluation

The hero task, learned once from a recorded demo, then run on every email. Generated by \`node backend/test/eval.ts\` on ${new Date().toISOString().slice(0, 10)}.${callsNote ? ` ${callsNote}` : ""}

**The task.** "${task.spec.title}": ${task.spec.goal} Learned on ${task.learnedAt.slice(0, 10)} from one demo (one complaint handled across the inbox, the store and the courier tracker, rules said out loud). ${task.spec.rules.length} rules, ${(task.checks ?? []).filter((x: any) => x.ok).length} of ${(task.checks ?? []).length} built-in checks pass against the demo.

**The runs.** All 15 seeded emails, run without stopping for approvals (so a wrong decision would really act), on the store as recorded and on a redesigned store (different labels and layout). Questions were answered the way a person would.

| | ${results.map((r) => r.name).join(" | ")} |
|---|${results.map(() => "---").join("|")}|
| Right decisions | ${results.map((r) => `**${r.right} / ${r.total}**`).join(" | ")} |
| Decided alone (by your rules), and right | ${results.map((r) => `${r.aloneRight} / ${r.alone}`).join(" | ")} |
| Store shows what it decided (order status + reply) | ${results.map((r) => (r.site ? `${r.site.matched} / ${r.total}` : "not measured")).join(" | ")} |
| Wrong irreversible actions | ${results.map((r) => `**${r.wrongActs.length + (r.site?.wrong.length ?? 0)}**${r.site ? "" : " (by its own record; store not checked)"}`).join(" | ")} |
| Asked you | ${results.map((r) => `${r.asked} (${r.askedNeeded} outside your rules; ${r.asked - r.askedNeeded} where your rules would have been right)`).join(" | ")} |
| Reused your answer without asking again | ${results.map((r) => r.reused).join(" | ")} |
| Elements found again after the redesign | ${results.map((r) => r.heals).join(" | ")} |
| Model calls | ${results.map((r) => (r.calls ? r.calls.length : "not measured")).join(" | ")} |
| Model calls by job | ${results.map((r) => byLabel(r.calls)).join(" | ")} |
| Models used | ${results.map((r) => models(r.calls)).join(" | ")} |
| Time, all emails | ${results.map((r) => secs(r.ms)).join(" | ")} |
| Time per email | ${results.map((r) => secs(r.ms / Math.max(1, r.run.items.length))).join(" | ")} |

${results.flatMap((r) => [...r.wrongActs, ...(r.site?.wrong ?? [])].map((w) => `- Wrong (${r.name}): ${w}`)).join("\n")}

How it is scored: a decision is right when it matches the test data's answer; for the two emails outside the rules (a wrong item sent) asking you, or reusing your answer, is right. A refund for a lost parcel counts whatever the learned task named the outcome (it may use one refund outcome for both; the store action is the same). Your answers were given the way a person would, so an email Remuse asked about counts as right; "Decided alone" shows the decisions it made without you.

**Practice** (what happens right after learning): ${!pr ? "didn't run." : pr.sameItem
  ? `on the demo email, ${pr.ok ? "matched what was done in the demo" : "did not match"}. Read ${pr.values.filter((v: any) => v.ok).length} of ${pr.values.length} values the same, chose ${pr.outcome ?? "nothing"} (the demo did ${pr.expected ?? "?"}), stopped before "${pr.stoppedBefore ?? "?"}".`
  : `the demo email wasn't found in the list, so it practiced on the first one: found ${pr.values.filter((v: any) => v.got !== null).length} of ${pr.values.length} values, chose ${pr.outcome ?? "nothing"}, stopped before "${pr.stoppedBefore ?? "?"}".`}

## Every email

${results.map((r) => `### ${r.name}

| Email | Should | Did | Decided by | Time |
|---|---|---|---|---|
${r.run.items.map((i: any) => `| ${i.label.replace(/\|/g, "/").slice(0, 60)} | ${i.expected ?? ""} | ${i.status === "done" ? `${meaning(i.outcome)}${meaning(i.outcome) !== i.outcome ? ` (${i.outcome})` : ""}` : i.status} | ${i.decidedBy ?? ""} | ${i.log.length ? secs(i.log.at(-1).at - i.log[0].at) : ""} |`).join("\n")}
`).join("\n")}`;
writeFileSync(join(ROOT, "docs", "eval.md"), md);
writeFileSync(join(OUT, "results.json"), JSON.stringify({ at: new Date().toISOString(), results: results.map(({ run, calls, ...x }) => ({ ...x, items: run.items.map((i: any) => ({ label: i.label, expected: i.expected, status: i.status, outcome: i.outcome, decidedBy: i.decidedBy })), heals: run.heals, calls: calls?.map((c: any) => ({ model: c.model, label: c.label, ms: c.ms, tokens: c.tokens, error: c.error })) ?? null })), note: callsNote || undefined, practice: pr ?? null }, null, 2));
console.log("\nWrote docs/eval.md and docs/eval/results.json");
