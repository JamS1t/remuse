// End-to-end: in what order Remuse decides. Your own rules come first: one that clearly applies decides, whatever
// kind of request it is. Only an item that would fall through to "otherwise" looks at its kind: a kind your rules
// weren't about is asked, and your answer is reused for that kind, but never over your other rules (an old order
// is still declined). Uses its own Agent, data folder, a stand-in inbox and a stand-in model. Needs port 3200 free.
// Run: node test/decide.e2e.ts
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

// Emails: what kind of request each is, and how old the order is.
const mails = [
  { id: 1, subject: "Where is my parcel", kind: "late delivery", days: 40 },   // old: declined by your rule, no question
  { id: 2, subject: "Changed my mind", kind: "change of mind", days: 5 },       // a kind your rules weren't about: asked
  { id: 3, subject: "Don't want it anymore", kind: "change of mind", days: 45 }, // same kind, but old: still declined
  { id: 4, subject: "Please take it back", kind: "change of mind", days: 3 },   // same kind, recent: your answer reused
  { id: 5, subject: "Arrived broken", kind: "damaged item", days: 2 },          // the kind your rules were about
  { id: 6, subject: "Return please", kind: "change of mind", days: null },      // its age can't be read: asked, answer or not
] as { id: number; subject: string; kind: string; days: number | null }[];
const site = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  if (req.url === "/inbox") return res.end(`<!doctype html><title>Inbox</title>${mails.map((m) => `<p><a class="mail" href="/mail?id=${m.id}">${m.subject}</a></p>`).join("")}`);
  const m = mails.find((x) => req.url === `/mail?id=${x.id}`);
  res.end(m ? `<!doctype html><title>${m.subject}</title><h1>${m.subject}</h1><p>Kind: ${m.kind}</p>${m.days === null ? "" : `<p>Order age: ${m.days} days</p>`}` : "<p>Not found</p>");
}).listen(0);
const SITE = `http://127.0.0.1:${(site.address() as any).port}`;
// The stand-in model reads the kind off the page, as Muse Spark would judge it.
const model = createServer(async (req, res) => {
  let b = ""; for await (const c of req) b += c;
  const kind = /Kind: ([a-z ]+)/.exec(b)?.[1] ?? "other";
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ output_text: JSON.stringify({ item_type: { answer: kind, why: "stand-in" } }), usage: { total_tokens: 1 } }));
}).listen(0);
const MODEL = `http://127.0.0.1:${(model.address() as any).port}/v1`;

const spec = {
  title: "Answer complaints", goal: "Decline old orders, replace damaged items, refund the rest.", scope: "damaged items", scopeTypes: ["damaged item"],
  inputs: { source: "list", itemName: "email", listUrl: `${SITE}/inbox`, itemSelector: "a.mail" },
  variables: [
    { name: "item_type", kind: "judge", description: "Kind of request", question: "What kind of request is this?", options: ["damaged item", "late delivery", "change of mind", "other"], demoValue: "damaged item" },
    { name: "days_since_order", kind: "text", description: "Order age in days", demoValue: "2" },
    { name: "subject", kind: "text", description: "Subject", demoValue: "Arrived broken" },
  ],
  steps: [{ id: "s1", do: "open_item", describe: "Open the email" }, { id: "s2", do: "extract", vars: ["item_type", "days_since_order", "subject"], describe: "Read it" }],
  rules: [{ if: "days_since_order > 30", then: "decline", said: "older than 30 days, decline" }, { if: "item_type is damaged item", then: "replace" }, { if: "otherwise", then: "refund" }],
  outcomes: Object.fromEntries(["decline", "replace", "refund"].map((o) => [o, { describe: o, demonstrated: o === "replace", steps: [] }])),
};
const code = `({ extract: { days_since_order: (t) => /Order age: (\\d+)/.exec(t)?.[1] ?? null, subject: (t) => t.trim().split("\\n")[0] || null }, compute: {},
  decide: (v) => Number(v.days_since_order) > 30 ? { outcome: "decline", rule: 0 } : v.item_type === "damaged item" ? { outcome: "replace", rule: 1 } : { outcome: "refund", rule: 2 } })`;

const data = mkdtempSync(join(tmpdir(), "remuse-decide-"));
const agent = spawn(process.execPath, ["--env-file-if-exists=../.env", "src/server.ts"], {
  cwd: resolve(import.meta.dirname, ".."), stdio: process.env.SHOW_AGENT ? "inherit" : "ignore",
  env: { ...process.env, DATA_DIR: data, HEADLESS: "1", SHOWRUN_NO_NOTIFY: "1", OPEN_MODEL_KEY: "", BASETEN_API_KEY: "", MODEL_API_KEY: "", SHOWRUN_PROXY: MODEL },
});
try {
  for (let i = 0; i < 40 && !(await fetch(`${API}/sessions`).then((r) => r.ok, () => false)); i++) await sleep(250);
  const s = await post("/sessions", { title: "Answer complaints", startedAt: Date.now() });
  const db = new DatabaseSync(join(data, "showrun.db"));
  const specId = Number(db.prepare("INSERT INTO specs (session_id, version, note, json, code, tests, created_at) VALUES (?, 1, 'test', ?, ?, '[]', ?)").run(s.id, JSON.stringify(spec), code, Date.now()).lastInsertRowid);
  db.close();
  const r = await post(`/specs/${specId}/runs`, { autoApprove: true });
  const questions: string[] = [];
  let run: any;
  for (let i = 0; i < 120; i++) {
    run = await get(`/runs/${r.id}`);
    if (run.pending?.kind === "ask") { questions.push(run.items[run.pending.item].label); await post(`/runs/${r.id}/answer`, { outcome: "refund", note: "a change of mind gets a refund", learn: true }); }
    if (["done", "failed", "stopped"].includes(run.status)) break;
    await sleep(500);
  }
  const it = (n: number) => run.items[n - 1];
  check("an old order is declined by your rule, even though its kind wasn't one your rules were about: no question", it(1).outcome === "decline" && it(1).decidedBy === "rules", `${it(1).outcome} by ${it(1).decidedBy}`);
  check("a kind your rules weren't about, falling through to \"otherwise\", is asked about", it(2).decidedBy === "you" && questions[0] === "Changed my mind", JSON.stringify(questions));
  check("a fact it can't read is asked about even when it has your answer for that kind", it(6).decidedBy === "you" && questions.length === 2 && questions[1] === "Return please", JSON.stringify(questions));
  check("your answer doesn't override your other rules: an old change-of-mind order is still declined", it(3).outcome === "decline" && it(3).decidedBy === "rules", `${it(3).outcome} by ${it(3).decidedBy}`);
  check("for the same kind, recent, your answer is reused without asking again", it(4).outcome === "refund" && it(4).decidedBy === "learned", `${it(4).outcome} by ${it(4).decidedBy}`);
  check("the kind your rules were about is decided by them", it(5).outcome === "replace" && it(5).decidedBy === "rules", `${it(5).outcome} by ${it(5).decidedBy}`);

  // The catch-all doesn't have to say "otherwise": your last rule is treated as one, so asking still happens.
  const reworded = { ...spec, rules: [spec.rules[0], spec.rules[1], { if: "item_type is not damaged item", then: "refund" }] };
  const db2 = new DatabaseSync(join(data, "showrun.db"));
  const v2 = Number(db2.prepare("INSERT INTO specs (session_id, version, note, json, code, tests, created_at) VALUES (?, 2, 'test', ?, ?, '[]', ?)").run(s.id, JSON.stringify(reworded), code, Date.now()).lastInsertRowid);
  db2.close();
  const r2 = await post(`/specs/${v2}/runs`, { autoApprove: true, redo: true, limit: 2 });
  let run2: any; let askedAgain = false;
  for (let i = 0; i < 120; i++) {
    run2 = await get(`/runs/${r2.id}`);
    if (run2.pending?.kind === "ask") { askedAgain = askedAgain || run2.items[run2.pending.item].label === "Changed my mind"; await post(`/runs/${r2.id}/answer`, { outcome: "refund", learn: false }); }
    if (["done", "failed", "stopped"].includes(run2.status)) break;
    await sleep(500);
  }
  check("a last rule worded differently (\"item_type is not damaged item\") still counts as the catch-all, so it asks", askedAgain && run2.items[1].decidedBy === "you", `${run2.items[1]?.outcome} by ${run2.items[1]?.decidedBy}`);
} finally {
  agent.kill(); site.close(); model.close();
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map(([n]) => n).join(" | ")}` : ""}`);
}
