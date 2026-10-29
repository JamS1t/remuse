// End-to-end: a task that spans three tabs. Read values in a tab the site opened by itself, type them into
// a form in another tab, then go back to the first tab and find it exactly as it was left (not reloaded).
// Uses its own Agent and data folder and a stand-in site. Needs port 3200 free.
// Run: node test/tabs.e2e.ts
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

// Orders page: "Open invoice" opens a new tab; "Mark as logged" only works if this tab wasn't reloaded since.
const saved: Record<string, string>[] = [];
const site = createServer(async (req, res) => {
  if (req.url === "/save" && req.method === "POST") {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c);
    saved.push(JSON.parse(Buffer.concat(chunks).toString()));
    res.writeHead(200); return res.end("ok");
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  if (req.url === "/orders") return res.end(`<!doctype html><title>Orders</title><h1>Orders</h1>
    <p>Order 4821</p><a href="/invoice/4821" target="_blank" onclick="window.opened = true">Open invoice</a>
    <button onclick="document.body.insertAdjacentHTML('beforeend', window.opened ? '<p>Logged after opening the invoice</p>' : '<p>Page was reloaded</p>')">Mark as logged</button>`);
  if (req.url === "/invoice/4821") return res.end(`<!doctype html><title>Invoice 4821</title><h1>Invoice 4821</h1><p>Customer: Ana Cruz</p><p>Total: ₱1,250.00</p>`);
  if (req.url === "/sheet") return res.end(`<!doctype html><title>Sheet</title><h1>Order log</h1>
    <input aria-label="Customer"><input aria-label="Amount">
    <button onclick="fetch('/save',{method:'POST',body:JSON.stringify({customer:document.querySelectorAll('input')[0].value,amount:document.querySelectorAll('input')[1].value})}).then(()=>document.body.insertAdjacentHTML('beforeend','<p>Row saved</p>'))">Save row</button>`);
  res.end("not here");
}).listen(0);
const SITE = `http://127.0.0.1:${(site.address() as any).port}`;

const data = mkdtempSync(join(tmpdir(), "remuse-data-"));
const agent = spawn(process.execPath, ["--env-file-if-exists=../.env", "src/server.ts"], {
  cwd: resolve(import.meta.dirname, ".."), env: { ...process.env, DATA_DIR: data, HEADLESS: "1", SHOWRUN_NO_NOTIFY: "1" }, stdio: "ignore",
});
try {
  for (let i = 0; i < 40 && !(await fetch(`${API}/sessions`).then((r) => r.ok, () => false)); i++) await sleep(250);

  // A learned task, as Muse Spark would write it (hand-written so the test needs no model).
  const s = await post("/sessions", { title: "Log new orders", startedAt: Date.now() });
  const spec = {
    title: "Log new orders", goal: "Copy the invoice's customer and total into the order log, then mark the order logged.", scope: "", scopeTypes: [],
    inputs: { source: "once", itemName: "order" },
    variables: [
      { name: "customer", kind: "text", description: "Customer on the invoice", demoValue: "Ana Cruz" },
      { name: "total", kind: "text", description: "Invoice total", demoValue: "₱1,250.00" },
    ],
    steps: [
      { id: "s1", tab: "orders", do: "goto", url: `${SITE}/orders`, describe: "Open the orders" },
      { id: "s2", tab: "orders", do: "click", target: { role: "link", name: "Open invoice" }, describe: "Open the invoice" },
      { id: "s3", tab: "invoice", do: "extract", vars: ["customer", "total"], describe: "Read the customer and total" },
      { id: "s4", tab: "sheet", do: "goto", url: `${SITE}/sheet`, describe: "Open the order log" },
      { id: "s5", tab: "sheet", do: "fill", target: { role: "textbox", name: "Customer" }, value: "{{customer}}", describe: "Type the customer" },
      { id: "s6", tab: "sheet", do: "fill", target: { role: "textbox", name: "Amount" }, value: "{{total}}", describe: "Type the amount" },
      { id: "s7", tab: "sheet", do: "click", target: { role: "button", name: "Save row" }, describe: "Save the row", expect: { textIncludes: "Row saved" } },
    ],
    rules: [{ if: "otherwise", then: "done" }],
    outcomes: { done: { describe: "Mark it logged", demonstrated: true, steps: [
      { id: "s8", tab: "orders", do: "click", target: { role: "button", name: "Mark as logged" }, describe: "Mark the order logged", expect: { textIncludes: "Logged after opening the invoice" } },
      { id: "s9", do: "report", message: "Logged {{customer}}, {{total}}", describe: "Tell me" },
    ] } },
  };
  const code = `({ extract: { customer: (t) => /Customer:\\s*(.+)/.exec(t)?.[1]?.trim() ?? null, total: (t) => /Total:\\s*(\\S+)/.exec(t)?.[1] ?? null }, compute: {}, decide: () => ({ outcome: "done", rule: 0 }) })`;
  const db = new DatabaseSync(join(data, "showrun.db"));
  const specId = Number(db.prepare("INSERT INTO specs (session_id, version, note, json, code, tests, created_at) VALUES (?, 1, 'test', ?, ?, '[]', ?)")
    .run(s.id, JSON.stringify(spec), code, Date.now()).lastInsertRowid);
  db.close();

  const r = await post(`/specs/${specId}/runs`, { autoApprove: true });
  let run: any;
  for (let i = 0; i < 60; i++) { run = await get(`/runs/${r.id}`); if (["done", "failed", "stopped"].includes(run.status)) break; await sleep(1000); }
  const it = run.items[0];
  console.log("   log:", it?.log.map((l: any) => l.msg).join(" / ").slice(0, 600));
  check("the run finishes", run.status === "done" && it?.status === "done", `${run.status} / ${it?.status} ${run.error ?? ""}`);
  check("values read in the tab the site opened", it?.vars.customer === "Ana Cruz" && it?.vars.total === "₱1,250.00", JSON.stringify({ c: it?.vars.customer, t: it?.vars.total }));
  check("are typed into the form in another tab", saved[0]?.customer === "Ana Cruz" && saved[0]?.amount === "₱1,250.00", JSON.stringify(saved[0]));
  check("the first tab is found as it was left", it?.log.some((l: any) => l.msg.includes("Mark the order logged") && l.level === "ok"));
  check("three tabs were used", ["orders", "invoice", "sheet"].every((n) => it?.log.some((l: any) => l.msg === `In the ${n} tab`)));
  check("the report uses values from the other tabs", it?.report === "Logged Ana Cruz, ₱1,250.00", it?.report);
} finally {
  agent.kill(); site.close();
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map(([n]) => n).join(" | ")}` : ""}`);
}
