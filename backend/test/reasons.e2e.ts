// End-to-end: every step says why it counts as done, and shows it. A run on a redesigned store ("Refund" is now
// "Issue refund", somewhere else): each step carries its reason and how it was checked (on the page, or by
// looking at the screen), the decision lists the values it went by, and finding the moved button keeps a
// screenshot with the boxes Muse Spark and SAM 3.1 drew. Uses its own Agent, data folder, a stand-in store
// and a stand-in model. Needs port 3200 free.
// Run: node test/reasons.e2e.ts [screenshot-out.png]
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { copyFileSync, existsSync, mkdtempSync } from "node:fs";
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

// The redesigned store: the refund button is renamed and sits at a fixed spot (600,400 to 800,450 on a 1440x900 screen).
const orders = [{ id: 1, amount: "500" }, { id: 2, amount: "320" }];
let refunds = 0;
const site = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/refund") { refunds++; res.writeHead(303, { Location: "/done" }); return res.end(); }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  if (req.url === "/orders") return res.end(`<!doctype html><title>Orders</title><h1>Orders</h1>${orders.map((o) => `<p><a class="order" href="/order?id=${o.id}">Order 100${o.id}</a></p>`).join("")}`);
  if (req.url === "/done") return res.end(`<!doctype html><title>Done</title><p>Refunded</p>`);
  const o = orders.find((x) => req.url === `/order?id=${x.id}`);
  if (!o) return res.end("<p>Not found</p>");
  res.end(`<!doctype html><title>Order 100${o.id}</title><body style="margin:0"><h1>Order 100${o.id}</h1><p>Amount: ₱${o.amount}</p>
    <form method="post" action="/refund"><label>Note <input name="note"></label>
    <button style="position:absolute;left:600px;top:400px;width:200px;height:50px">Issue refund</button>
    <button type="button" style="position:absolute;left:900px;top:400px;width:160px;height:50px">Print label</button></form></body>`);
}).listen(0);
const SITE = `http://127.0.0.1:${(site.address() as any).port}`;

// Stand-in model. Finding an element: Muse Spark's box (0-1000 grid) around the new button; SAM 3.1: pixel boxes
// for both buttons on the page. A screen check passes with a reason.
const calls: Record<string, number> = {};
const model = createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  const kind = body.includes('"sam-3.1"') ? "sam" : body.includes("on this screenshot of a web page") ? "ground" : body.includes("Did the step work?") ? "check" : "other";
  calls[kind] = (calls[kind] ?? 0) + 1;
  const out = kind === "sam" ? "<|box;x1=600;y1=400;x2=800;y2=450;w=1440;h=900|><|box;x1=900;y1=400;x2=1060;y2=450;w=1440;h=900|>"
    : kind === "ground" ? JSON.stringify({ found: true, bbox: [{ x_min: 410, y_min: 440, x_max: 560, y_max: 505 }] })
    : kind === "check" ? JSON.stringify({ ok: true, why: "the page says Refunded" })
    : "{}";
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ output_text: out, usage: { total_tokens: 1 } }));
}).listen(0);
const MODEL = `http://127.0.0.1:${(model.address() as any).port}/v1`;

const spec = {
  title: "Refund orders", goal: "Refund every order.", scope: "", scopeTypes: [],
  inputs: { source: "list", itemName: "order", listUrl: `${SITE}/orders`, itemSelector: "a.order" },
  variables: [{ name: "amount", kind: "text", description: "Amount", demoValue: "500" }],
  steps: [
    { id: "s1", do: "open_item", describe: "Open the order" },
    { id: "s2", do: "extract", vars: ["amount"], describe: "Read the amount" },
  ],
  rules: [{ if: "otherwise", then: "refund", said: "refund them all" }],
  outcomes: { refund: { describe: "Refund it", demonstrated: true, steps: [
    { id: "s3", do: "fill", target: { role: "textbox", name: "Note" }, value: "Refund {{amount}}", describe: "Write a note" },
    { id: "s4", do: "click", target: { role: "button", name: "Refund" }, describe: "Press Refund", expect: { textIncludes: "Refunded" } },
  ] } },
};
const code = `({ extract: { amount: (t) => /Amount: ₱(\\d+)/.exec(t)?.[1] ?? null }, compute: {}, decide: () => ({ outcome: "refund", rule: 0 }) })`;

const data = mkdtempSync(join(tmpdir(), "remuse-reasons-"));
const agent = spawn(process.execPath, ["--env-file-if-exists=../.env", "src/server.ts"], {
  cwd: resolve(import.meta.dirname, ".."), env: { ...process.env, DATA_DIR: data, HEADLESS: "1", SHOWRUN_NO_NOTIFY: "1", MODEL_API_KEY: "", SHOWRUN_PROXY: MODEL }, stdio: process.env.SHOW_AGENT ? "inherit" : "ignore",
});
try {
  for (let i = 0; i < 40 && !(await fetch(`${API}/sessions`).then((r) => r.ok, () => false)); i++) await sleep(250);
  const s = await post("/sessions", { title: "Refund orders", startedAt: Date.now() });
  const db = new DatabaseSync(join(data, "showrun.db"));
  const specId = Number(db.prepare("INSERT INTO specs (session_id, version, note, json, code, tests, created_at) VALUES (?, 1, 'test', ?, ?, '[]', ?)")
    .run(s.id, JSON.stringify(spec), code, Date.now()).lastInsertRowid);
  db.close();

  const r = await post(`/specs/${specId}/runs`, { autoApprove: true });
  let run: any;
  for (let i = 0; i < 120; i++) { run = await get(`/runs/${r.id}`); if (["done", "failed", "stopped"].includes(run.status)) break; await sleep(1000); }
  const [first, second] = run.items;
  const line = (it: any, re: RegExp) => it.log.find((l: any) => re.test(l.msg));
  check("the run finishes on the redesigned store", run.status === "done" && run.items.every((i: any) => i.status === "done") && refunds === 2, `${run.status}, ${refunds} refunds, ${run.items.map((i: any) => i.status)}`);

  const opened = line(first, /^✓ Open the order/);
  check("opening an item says so, without claiming a check it didn't make", opened?.why === "the page opened" && opened.how === undefined, JSON.stringify(opened));
  const note = line(first, /^✓ Write a note/);
  check("typing says what the field now holds, with a picture of the field", note?.why === "the field now holds “Refund 500”" && note.how === "page" && !!note.shot, JSON.stringify(note));
  const decided = line(first, /^Decision:/);
  check("the decision lists the values it went by", /What it read: amount 500/.test(decided?.why ?? ""), decided?.why);
  const found = line(first, /^Found it:/);
  check("finding the moved button says what it found and what it was", /“Issue refund” \(was “Refund”\)/.test(found?.msg ?? ""), found?.msg);
  check("…how (Muse Spark pointed, SAM 3.1 outlined the buttons), with the marked-up screenshot", found?.how === "screen" && /Muse Spark pointed/.test(found.why) && /SAM 3\.1 outlined 2 buttons/.test(found.why) && !!found.shot && existsSync(join(data, "runs", r.id, found.shot)), found?.why);
  const pressed = line(first, /^✓ Press Refund/);
  check("an irreversible step is checked by looking at the screen, and says what it saw", pressed?.how === "screen" && pressed.why === "the page says Refunded" && !!pressed.shot, JSON.stringify(pressed));
  check("the next order uses the button directly: no second look", !line(second, /^Found it:/) && calls.ground === 1 && calls.sam === 1, JSON.stringify(calls));
  const pressed2 = line(second, /^✓ Press Refund/);
  check("…and still shows its reason", pressed2?.how === "screen" && !!pressed2.why, JSON.stringify(pressed2));
  // Saying no to a step on one order: the next order's steps carry their own pictures, never the last one's.
  const r2 = await post(`/specs/${specId}/runs`, { redo: true });
  let w: any;
  for (let i = 0; i < 60; i++) { w = await get(`/runs/${r2.id}`); if (w.pending || ["done", "failed", "stopped"].includes(w.status)) break; await sleep(500); }
  await post(`/runs/${r2.id}/answer`, { decision: "reject" });
  for (let i = 0; i < 60; i++) { w = await get(`/runs/${r2.id}`); if ((w.pending && w.pending.item === 1) || ["done", "failed", "stopped"].includes(w.status)) break; await sleep(500); }
  const open2 = line(w.items[1], /^✓ Open the order/);
  check("after you say no on one order, the next order's first step has no leftover picture", w.items[0].status === "skipped" && !!open2 && !open2.shot, JSON.stringify(open2));
  await post(`/runs/${r2.id}/stop`);
  for (let i = 0; i < 30 && !["done", "failed", "stopped"].includes(w.status); i++) { w = await get(`/runs/${r2.id}`); await sleep(500); }
  if (process.argv[2] && found?.shot) { copyFileSync(join(data, "runs", r.id, found.shot), process.argv[2]); console.log("   marked-up screenshot:", process.argv[2]); }
} finally {
  agent.kill(); site.close(); model.close();
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map(([n]) => n).join(" | ")}` : ""}`);
}
