// End-to-end: plan first. A run you start on several items reads and decides every one before doing
// anything, asks its questions up front (while you're there), shows the plan ("2 refund · 1 decline"), and
// acts only after your Go, without reading or judging anything twice. Cancel leaves everything untouched.
// Uses its own Agent, data folder, a stand-in inbox and a stand-in model. Needs port 3200 free.
// Run: node test/plan.e2e.ts
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const API = "http://127.0.0.1:3200/api";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: [string, boolean, string][] = [];
const check = (n: string, ok: boolean, d = "") => { results.push([n, ok, d]); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  (${d})` : ""}`); };
const get = async (p: string) => (await fetch(API + p)).json();
const post = async (p: string, b: unknown = {}) => (await fetch(API + p, { method: "POST", body: JSON.stringify(b) })).json();
if (await fetch(`${API}/sessions`).then(() => true, () => false)) { console.error("Port 3200 is busy: stop the Remuse Agent first."); process.exit(1); }

// Three emails; the third doesn't say its amount, so Remuse has to ask about it.
const mails = [{ id: 1, subject: "Broken mug", order: "1001", amount: "1,250" }, { id: 2, subject: "Late parcel", order: "1002", amount: "570" }, { id: 3, subject: "Wrong size", order: "1003", amount: "" }];
// Every reply that was really sent, in order, so acting on the wrong email (or twice) shows.
const replies: string[] = [];
const site = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/send") {
    let b = ""; for await (const c of req) b += c;
    replies.push(new URLSearchParams(b).get("reply") ?? ""); res.writeHead(303, { Location: "/sent" }); return res.end();
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  if (req.url === "/inbox") return res.end(`<!doctype html><title>Inbox</title><h1>Inbox</h1>${mails.map((m) => `<p><a class="mail" href="/mail?id=${m.id}">${m.subject}</a></p>`).join("")}`);
  if (req.url === "/sent") return res.end(`<!doctype html><title>Sent</title><p>Reply sent</p>`);
  const m = mails.find((x) => req.url === `/mail?id=${x.id}`);
  if (!m) return res.end("<p>Not found</p>");
  res.end(`<!doctype html><title>${m.subject}</title><h1>${m.subject}</h1><p>Order: ${m.order}</p>${m.amount ? `<p>Amount: ₱${m.amount}</p>` : ""}
    <form method="post" action="/send"><label>Reply <textarea name="reply"></textarea></label><button>Send reply</button></form>`);
}).listen(0);
const SITE = `http://127.0.0.1:${(site.address() as any).port}`;

// Stand-in model: judging the tone counts as one call per item; screen checks pass; a missing amount stays missing.
let judged = 0;
const model = createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  const answer = body.includes("Did the step work?") ? { ok: true, why: "stand-in model" }
    : body.includes("Answer each question") ? (judged++, { tone: { answer: "calm", why: "stand-in model" } })
    : { amount: null };
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ output_text: JSON.stringify(answer), usage: { total_tokens: 1 } }));
}).listen(0);
const MODEL = `http://127.0.0.1:${(model.address() as any).port}/v1`;

const spec = {
  title: "Answer refund emails", goal: "Refund small orders, decline big ones.", scope: "", scopeTypes: [],
  inputs: { source: "list", itemName: "email", listUrl: `${SITE}/inbox`, itemSelector: "a.mail" },
  variables: [
    { name: "order", kind: "text", description: "Order number", demoValue: "1002" },
    { name: "amount", kind: "text", description: "Amount in pesos", demoValue: "570" },
    { name: "tone", kind: "judge", description: "How the customer sounds", question: "Is the customer calm or angry?", options: ["calm", "angry"], demoValue: "calm" },
  ],
  steps: [
    // Model output can hold nulls where a value is missing; a step like this must still run.
    { id: "s1", do: "open_item", describe: "Open the email", expect: { textIncludes: null }, value: null },
    { id: "s2", do: "extract", vars: ["order", "amount", "tone"], describe: "Read the order, amount and tone" },
  ],
  rules: [{ if: "amount under 1000", then: "refund" }, { if: "otherwise", then: "decline" }],
  outcomes: Object.fromEntries(["refund", "decline"].map((o) => [o, { describe: o, demonstrated: o === "refund", steps: [
    { id: `${o}1`, do: "fill", target: { role: "textbox", name: "Reply" }, value: `${o} {{order}}`, describe: "Write the reply" },
    { id: `${o}2`, do: "click", target: { role: "button", name: "Send reply" }, describe: "Send the reply" },
  ] }])),
};
const code = `({ extract: { order: (t) => /Order: (\\d+)/.exec(t)?.[1] ?? null, amount: (t) => /Amount: ₱([\\d,]+)/.exec(t)?.[1] ?? null }, compute: {},
  decide: (v) => Number(String(v.amount).replace(/,/g, "")) < 1000 ? { outcome: "refund", rule: 0 } : { outcome: "decline", rule: 1 } })`;

const data = mkdtempSync(join(tmpdir(), "remuse-plan-"));
const agent = spawn(process.execPath, ["--env-file-if-exists=../.env", "src/server.ts"], {
  cwd: resolve(import.meta.dirname, ".."), env: { ...process.env, DATA_DIR: data, HEADLESS: "1", SHOWRUN_NO_NOTIFY: "1", MODEL_API_KEY: "", SHOWRUN_PROXY: MODEL }, stdio: process.env.SHOW_AGENT ? "inherit" : "ignore",
});
const sent = () => replies.length;
const until = async (id: string, ok: (r: any) => boolean, secs = 90) => {
  let run: any;
  for (let i = 0; i < secs * 2; i++) { run = await get(`/runs/${id}`); if (ok(run) || ["done", "failed", "stopped"].includes(run.status)) break; await sleep(500); }
  return run;
};
try {
  for (let i = 0; i < 40 && !(await fetch(`${API}/sessions`).then((r) => r.ok, () => false)); i++) await sleep(250);
  const s = await post("/sessions", { title: "Answer refund emails", startedAt: Date.now() - 60_000 });
  const db = new DatabaseSync(join(data, "showrun.db"));
  const specId = Number(db.prepare("INSERT INTO specs (session_id, version, note, json, code, tests, created_at) VALUES (?, 1, 'test', ?, ?, '[]', ?)")
    .run(s.id, JSON.stringify(spec), code, Date.now()).lastInsertRowid);
  db.close();

  // 1. Questions come first, while you're there.
  const r = await post(`/specs/${specId}/runs`, { plan: true });
  let run = await until(r.id, (x) => !!x.pending);
  check("it asks its question while looking, before doing anything", run.pending?.kind === "ask" && /amount/.test(run.pending.question) && sent() === 0, run.pending?.question ?? run.status);
  await post(`/runs/${r.id}/answer`, { outcome: "refund", note: "small one, just refund", learn: false });

  // 2. Then the plan, and nothing done yet.
  run = await until(r.id, (x) => x.pending?.kind === "plan");
  const p = run.pending ?? {};
  check("then it shows the plan: what it will do with each", p.kind === "plan" && p.counts?.refund === 2 && p.counts?.decline === 1, JSON.stringify(p.counts));
  check("every item is planned with its reason", run.items.every((i: any) => i.status === "planned" && i.outcome && i.because), run.items.map((i: any) => `${i.label}: ${i.status} ${i.outcome}`).join("; "));
  check("your answer is in the plan", run.items[2].decidedBy === "you" && run.items[2].outcome === "refund");
  check("it knows how many need your OK", p.needsOk === 3, String(p.needsOk));
  check("nothing has been sent yet", sent() === 0, `${sent()} sent`);
  check("each item was judged once", judged === 3, `${judged} judge calls`);

  // A stray answer meant for something else doesn't count as Go.
  await post(`/runs/${r.id}/answer`, { outcome: "refund" });
  await sleep(1500);
  check("only Go starts it: a stray answer leaves the plan waiting", (await get(`/runs/${r.id}`)).pending?.kind === "plan" && sent() === 0);

  // While the plan waits, two emails change: one so the decision would differ (left alone), one not (carries on).
  mails[1].amount = "1,640";
  mails[0].amount = "1,300";
  // 3. Go: it acts, still asking before each send unless you approve them all.
  await post(`/runs/${r.id}/answer`, { decision: "approve" });
  run = await until(r.id, (x) => x.pending?.kind === "approval");
  check("after Go, it still asks before sending", run.pending?.kind === "approval" && run.pending.step === "Send the reply", run.pending?.step);
  await post(`/runs/${r.id}/answer`, { decision: "approve_all" });
  run = await until(r.id, () => false, 120);
  check("then it does the rest, each with its own reply", run.status === "done" && JSON.stringify(replies) === JSON.stringify(["decline 1001", "refund 1003"]), `${run.status}: ${JSON.stringify(replies)}`);
  const changed = run.items[1];
  check("an email whose change would flip the decision is left alone, and it says why", changed.status === "skipped" && /changed since the plan/.test(changed.log.at(-1)?.msg ?? ""), changed.log.at(-1)?.msg);
  check("one whose change doesn't matter carries on, and says so", run.items[0].status === "done" && run.items[0].log.some((l: any) => /decision is the same/.test(l.msg)), run.items[0].log.map((l: any) => l.msg).filter((m: string) => /plan/.test(m)).join(" / "));
  mails[1].amount = "570"; mails[0].amount = "1,250";
  check("acting didn't read or judge anything again", judged === 3, `${judged} judge calls`);

  // 4. Cancel at the plan: nothing happens.
  const c = await post(`/specs/${specId}/runs`, { plan: true, redo: true });
  let cr = await until(c.id, (x) => !!x.pending);
  if (cr.pending?.kind === "ask") { await post(`/runs/${c.id}/answer`, { outcome: "decline", learn: false }); cr = await until(c.id, (x) => x.pending?.kind === "plan"); }
  await post(`/runs/${c.id}/answer`, { decision: "reject" });
  cr = await until(c.id, () => false);
  check("Cancel at the plan does nothing, and says so on each", cr.status === "stopped" && sent() === 2 && cr.items.every((i: any) => i.status === "skipped" && /cancelled at the plan/.test(i.log.at(-1)?.msg)), `${cr.status}, ${sent()} sent; ${cr.items.map((i: any) => `${i.status}: ${i.log.at(-1)?.msg}`).join(" | ")}`);

  // 5. "Approve all" at the plan: no more stops.
  const g = await post(`/specs/${specId}/runs`, { plan: true, limit: 2, redo: true });
  let gr = await until(g.id, (x) => x.pending?.kind === "plan");
  await post(`/runs/${g.id}/answer`, { decision: "approve_all" });
  gr = await until(g.id, (x) => !!x.pending, 120);
  check("approving all at the plan runs through with no more stops", gr.status === "done" && !gr.pending && sent() === 4, `${gr.status}, ${sent()} sent, pending ${gr.pending?.kind ?? "none"}`);

  // 6. No plan: a single item; a run you chose to do without asking; a run started without asking for a plan.
  const one = await post(`/specs/${specId}/runs`, { plan: true, limit: 1, redo: true });
  const oneRun = await until(one.id, (x) => !!x.pending);
  check("one item needs no plan (it asks before sending, as always)", oneRun.pending?.kind === "approval", oneRun.pending?.kind ?? oneRun.status);
  await post(`/runs/${one.id}/stop`); await until(one.id, () => false);
  const auto = await post(`/specs/${specId}/runs`, { plan: true, limit: 2, autoApprove: true, redo: true });
  const autoRun = await until(auto.id, (x) => !!x.pending, 120);
  check("a run you chose to do without asking doesn't stop at a plan", autoRun.status === "done" && sent() === 6, `${autoRun.status}, pending ${autoRun.pending?.kind ?? "none"}, ${sent()} sent`);
  const plain = await post(`/specs/${specId}/runs`, { limit: 2, redo: true });
  const plainRun = await until(plain.id, (x) => !!x.pending);
  check("without a plan, it goes item by item as before", plainRun.pending?.kind === "approval" && plainRun.items[0].status === "approval", plainRun.pending?.kind);
  await post(`/runs/${plain.id}/stop`); await until(plain.id, () => false);
} finally {
  agent.kill(); site.close(); model.close();
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map(([n]) => n).join(" | ")}` : ""}`);
}
