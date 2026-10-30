// End-to-end: right after learning, Remuse practices the task once on the person's own example. It finds
// the very item from the demo, reads the same values, makes the same choice, and stops before anything
// irreversible (nothing is sent). A practice never waits on the person, flags what doesn't match, and
// gives way when a real run starts. Uses its own Agent, data folder and a stand-in inbox. Needs port 3200 free.
// Run: node test/practice.e2e.ts
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

// A small inbox: three emails, each with a reply box and a Send button that really sends.
const mails = [{ id: 1, subject: "Broken mug", order: "1001", amount: "1,250" }, { id: 2, subject: "Late parcel", order: "1002", amount: "570" }, { id: 3, subject: "Wrong size", order: "1003", amount: "320" }];
let sent = 0;
const site = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/send") { sent++; res.writeHead(303, { Location: "/sent" }); return res.end(); }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  if (req.url === "/inbox") return res.end(`<!doctype html><title>Inbox</title><h1>Inbox</h1>${mails.map((m) => `<p><a class="mail" href="/mail?id=${m.id}">${m.subject}</a></p>`).join("")}`);
  if (req.url === "/sent") return res.end(`<!doctype html><title>Sent</title><p>Reply sent</p>`);
  const m = mails.find((x) => req.url === `/mail?id=${x.id}`);
  if (!m) return res.end("<p>Not found</p>");
  res.end(`<!doctype html><title>${m.subject}</title><h1>${m.subject}</h1><p>Order: ${m.order}</p><p>Amount: ₱${m.amount}</p>
    <form method="post" action="/send"><label>Reply <textarea name="reply"></textarea></label><button>Send reply</button></form>
    <form method="post" action="/send"><input name="q" aria-label="Quick reply"></form>`);
}).listen(0);
const SITE = `http://127.0.0.1:${(site.address() as any).port}`;
let modelCalls = 0;
const model = createServer(async (req, res) => {
  modelCalls++;
  let body = "";
  for await (const c of req) body += c;
  // A screen check ("did the step work?") passes; reading a value finds nothing.
  const answer = body.includes("Did the step work?") ? { ok: true, why: "stand-in model" } : { tracking: null };
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ output_text: JSON.stringify(answer), usage: { total_tokens: 1 } }));
}).listen(0);
const MODEL = `http://127.0.0.1:${(model.address() as any).port}/v1`;

const spec = {
  title: "Answer refund emails", goal: "Refund small orders, decline big ones.", scope: "", scopeTypes: [],
  inputs: { source: "list", itemName: "email", listUrl: `${SITE}/inbox`, itemSelector: "a.mail", itemEvent: 0 },
  variables: [
    { name: "order", kind: "text", description: "Order number", demoValue: "1002" },
    { name: "amount", kind: "text", description: "Amount in pesos", demoValue: "570" },
  ],
  steps: [
    { id: "s1", do: "open_item", describe: "Open the email" },
    { id: "s2", do: "extract", vars: ["order", "amount"], describe: "Read the order and amount" },
  ],
  rules: [{ if: "amount under 1000", then: "refund", said: "small ones I just refund" }, { if: "otherwise", then: "decline" }],
  outcomes: {
    refund: { describe: "Refund and say so", demonstrated: true, steps: [
      { id: "s3", do: "fill", target: { role: "textbox", name: "Reply" }, value: "Refunded order {{order}}", describe: "Write the reply" },
      { id: "s4", do: "click", target: { role: "button", name: "Send reply" }, describe: "Send the reply" },
    ] },
    decline: { describe: "Decline", demonstrated: false, steps: [
      { id: "s5", do: "fill", target: { role: "textbox", name: "Reply" }, value: "Sorry, we can't refund {{order}}", describe: "Write the reply" },
      { id: "s6", do: "click", target: { role: "button", name: "Send reply" }, describe: "Send the reply" },
    ] },
  },
};
const read = (re: string) => `(t) => { const m = /${re}/.exec(t); return m ? m[1] : null; }`;
const code = (order: string, amount: string) => `({ extract: { order: ${order}, amount: ${amount} }, compute: {},
  decide: (v) => Number(String(v.amount).replace(/,/g, "")) < 1000 ? { outcome: "refund", rule: 0 } : { outcome: "decline", rule: 1 } })`;
const good = code(read("Order: (\\d+)"), read("Amount: ₱([\\d,]+)"));

const data = mkdtempSync(join(tmpdir(), "remuse-practice-"));
const agent = spawn(process.execPath, ["--env-file-if-exists=../.env", "src/server.ts"], {
  cwd: resolve(import.meta.dirname, ".."), env: { ...process.env, DATA_DIR: data, HEADLESS: "1", SHOWRUN_NO_NOTIFY: "1", MODEL_API_KEY: "", SHOWRUN_PROXY: MODEL }, stdio: process.env.SHOW_AGENT ? "inherit" : "ignore",
});
const finished = async (id: string, secs = 90) => {
  let run: any;
  for (let i = 0; i < secs; i++) { run = await get(`/runs/${id}`); if (["done", "failed", "stopped"].includes(run.status)) break; await sleep(1000); }
  return run;
};
try {
  for (let i = 0; i < 40 && !(await fetch(`${API}/sessions`).then((r) => r.ok, () => false)); i++) await sleep(250);
  const s = await post("/sessions", { title: "Answer refund emails", startedAt: Date.now() - 60_000 });
  const db = new DatabaseSync(join(data, "showrun.db"));
  // The demo: the person opened the second email ("Late parcel").
  db.prepare("INSERT INTO events (session_id, t, kind, url, data) VALUES (?, ?, 'click', ?, ?)")
    .run(s.id, 1000, `${SITE}/inbox`, JSON.stringify({ target: { role: "link", text: "Late parcel", href: `${SITE}/mail?id=2`, selector: "p:nth-of-type(2) > a.mail" } }));
  const addSpec = (v: number, c: string, sp: object = spec) => Number(db.prepare("INSERT INTO specs (session_id, version, note, json, code, tests, created_at) VALUES (?, ?, 'test', ?, ?, '[]', ?)")
    .run(s.id, v, JSON.stringify(sp), c, Date.now()).lastInsertRowid);
  const v1 = addSpec(1, good);
  db.prepare("UPDATE sessions SET ended_at = ?, learn_stage = 'ready' WHERE id = ?").run(Date.now(), s.id);

  // 1. Practice on the example: same item, same values, same choice, stops before sending.
  const p = await post(`/specs/${v1}/practice`);
  check("a practice starts on its own kind of run", p.mode === "practice", p.error ?? p.mode);
  const run = await finished(p.id);
  const r = run.practice ?? {};
  check("it practices on the very email from the demo, not the first one", run.items.length === 1 && run.items[0].label === "Late parcel" && r.sameItem, run.items.map((x: any) => x.label).join(", "));
  check("it reads the same values the person saw", r.values?.length === 2 && r.values.every((v: any) => v.ok), JSON.stringify(r.values));
  check("it makes the same choice the person made", r.outcome === "refund" && r.expected === "refund", `${r.outcome} vs ${r.expected}`);
  check("it stops before the irreversible step and says where", r.stoppedBefore === "Send the reply" && run.items[0].status === "done", r.stoppedBefore);
  check("nothing was sent", sent === 0, `${sent} sent`);
  check("the practice counts as a match", r.ok === true && run.status === "done", JSON.stringify({ ok: r.ok, status: run.status, problem: r.problem }));
  const shot = run.items[0].log.find((l: any) => l.msg.startsWith("Next I'd"));
  check("it shows the button it would press, on a screenshot", !!shot?.shot, shot?.msg);
  const task = (await get("/tasks")).find((t: any) => t.sessionId === s.id);
  check("the sidebar's task list carries how the practice went", task?.practice?.runId === p.id && task.practice.result?.ok === true, JSON.stringify(task?.practice)?.slice(0, 160));
  const act = (await get(`/runs?task=${s.id}`)).find((x: any) => x.id === p.id);
  check("Activity marks it as a practice, and that it matched", act?.mode === "practice" && act.practiceOk === true);
  check("reading the demo item took no model calls (code read it)", modelCalls === 0, `${modelCalls} calls`);

  // 2. A version that misreads, and expects a value that isn't on the page (its code finds nothing, and
  // neither does Muse Spark): the practice flags both, and never waits for an answer it can't get.
  const withTracking = { ...spec, variables: [...spec.variables, { name: "tracking", kind: "text", description: "Courier tracking number", demoValue: "TRK-77" }],
    steps: [spec.steps[0], { ...spec.steps[1], vars: ["order", "amount", "tracking"] }] };
  const v2 = addSpec(2, code(read("Order: (\\d+)"), "() => \"999\"").replace("amount: () => \"999\" }", "amount: () => \"999\", tracking: () => null }"), withTracking);
  const p2 = await post(`/specs/${v2}/practice`);
  const run2 = await finished(p2.id);
  const r2 = run2.practice ?? {};
  check("a value it reads wrong, or can't find, is flagged", r2.values?.some((v: any) => v.name === "tracking" && !v.ok && v.got === null) && r2.values?.some((v: any) => v.name === "amount" && !v.ok && v.got === "999"), JSON.stringify(r2.values));
  check("where a real run would ask, the practice ends and reports the question", !!r2.asked && run2.status === "done" && !run2.pending, r2.asked);
  check("that practice doesn't count as a match", r2.ok === false);
  check("still nothing sent", sent === 0, `${sent} sent`);

  // 3. Sending by pressing Enter (a chat box): a practice stops before it, and a real run asks first.
  const chat = { ...spec, outcomes: { ...spec.outcomes, refund: { describe: "Quick reply", demonstrated: true, steps: [
    { id: "s7", do: "fill", target: { role: "textbox", name: "Quick reply" }, value: "Refunded {{order}}", describe: "Type the quick reply" },
    { id: "s8", do: "press", key: "Enter", target: { role: "textbox", name: "Quick reply" }, irreversible: true, describe: "Press Enter to send it" },
  ] } } };
  const v3 = addSpec(3, good.replace(/decide: [\s\S]*$/, "decide: () => ({ outcome: \"refund\", rule: 0 }) })"), chat);
  const run3 = await finished((await post(`/specs/${v3}/practice`)).id);
  check("a practice stops before pressing Enter to send", run3.practice?.stoppedBefore === "Press Enter to send it" && sent === 0, `${run3.practice?.stoppedBefore}, ${sent} sent`);
  const real3 = await post(`/specs/${v3}/runs`, { limit: 2 });
  let w: any;
  for (let i = 0; i < 60; i++) { w = await get(`/runs/${real3.id}`); if (w.pending || !["starting", "running"].includes(w.status)) break; await sleep(500); }
  check("a real run asks for your OK before pressing Enter to send", w.pending?.kind === "approval" && /Enter/.test(w.pending.step) && sent === 0, w.pending?.step ?? w.status);
  await post(`/runs/${real3.id}/stop`);
  await finished(real3.id);

  // 4. A newer practice replaces an older one; a practice gives way to a real run.
  const old = await post(`/specs/${v1}/practice`);
  await sleep(300);
  const newer = await post(`/specs/${v1}/practice`);
  check("a newer practice replaces one that's still going", !!newer.id && !newer.error && (await get(`/runs/${old.id}`)).status === "stopped", newer.error);
  await finished(newer.id);
  const p3 = await post(`/specs/${v1}/practice`);
  await sleep(300);
  const real = await post(`/specs/${v1}/runs`, { autoApprove: true, limit: 1 });
  check("starting a real run during a practice works", real.id && !real.error, real.error);
  const stopped = await get(`/runs/${p3.id}`);
  check("the practice stops for it", stopped.status === "stopped", stopped.status);
  const realRun = await finished(real.id);
  check("and the real run does the work (it sends)", realRun.status === "done" && sent === 1, `${realRun.status}, ${sent} sent; ${realRun.items?.[0]?.log?.slice(-3).map((l: any) => l.msg).join(" / ")}`);
  const last = await (await fetch(`${API}/specs/${v1}/practice`, { method: "POST" })).json();
  await finished(last.id);
  const busy = await post(`/specs/${v1}/runs`, { autoApprove: true, limit: 1 });
  const again = await fetch(`${API}/specs/${v1}/practice`, { method: "POST" });
  check("a practice never interrupts a real run", again.status === 409, String(again.status));
  await finished(busy.id);
} finally {
  agent.kill(); site.close(); model.close();
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map(([n]) => n).join(" | ")}` : ""}`);
}
