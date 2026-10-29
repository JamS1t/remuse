// End-to-end, with Muse Spark: record a task that spans three tabs in real Chromium with the Remuse
// extension (a link that opens a new tab, a second tab the person opens, then back to the first tab),
// let Remuse learn it, then run it on changed data. Needs port 3200 free.
// Run: node test/tabs-learn.e2e.ts <narration.wav>
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const API = "http://127.0.0.1:3200/api";
const narration = resolve(process.argv[2] ?? "");
const ext = resolve(import.meta.dirname, "../../extension");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: [string, boolean, string][] = [];
const check = (n: string, ok: boolean, d = "") => { results.push([n, ok, d]); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  (${d})` : ""}`); };
const get = async (p: string) => (await fetch(API + p)).json();
const post = async (p: string, b: unknown = {}) => (await fetch(API + p, { method: "POST", body: JSON.stringify(b) })).json();
if (await fetch(`${API}/sessions`).then(() => true, () => false)) { console.error("Port 3200 is busy: stop the Remuse Agent first."); process.exit(1); }

// The stand-in apps: orders (invoice opens in a new tab; it counts its own page loads, so a reload shows)
// and an order log. The invoice changes after the demo.
let invoice = { customer: "Ana Cruz", total: "₱1,250.00" };
const saved: Record<string, string>[] = [];
const site = createServer(async (req, res) => {
  if (req.url === "/save" && req.method === "POST") {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c);
    saved.push(JSON.parse(Buffer.concat(chunks).toString()));
    res.writeHead(200); return res.end("ok");
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  if (req.url === "/orders") return res.end(`<!doctype html><title>Orders</title><h1>Orders</h1>
    <p>New order 4821</p><a href="/invoice/4821" target="_blank">Open invoice</a>
    <script>sessionStorage.loads = (+sessionStorage.loads || 0) + 1</script>
    <button onclick="document.body.insertAdjacentHTML('beforeend', '<p>Order logged (page loaded ' + sessionStorage.loads + ' time' + (sessionStorage.loads > 1 ? 's' : '') + ')</p>')">Mark as logged</button>`);
  if (req.url === "/invoice/4821") return res.end(`<!doctype html><title>Invoice 4821</title><h1>Invoice 4821</h1><p>Customer: ${invoice.customer}</p><p>Total: ${invoice.total}</p>`);
  if (req.url === "/log") return res.end(`<!doctype html><title>Order log</title><h1>Order log</h1>
    <label>Customer <input name="customer"></label> <label>Amount <input name="amount"></label>
    <button onclick="fetch('/save',{method:'POST',body:JSON.stringify({customer:document.querySelectorAll('input')[0].value,amount:document.querySelectorAll('input')[1].value})}).then(()=>document.body.insertAdjacentHTML('beforeend','<p>Row saved</p>'))">Save row</button>`);
  res.end("not here");
}).listen(0);
const SITE = `http://127.0.0.1:${(site.address() as any).port}`;

const data = mkdtempSync(join(tmpdir(), "remuse-tabs-"));
const agent = spawn(process.execPath, ["--env-file-if-exists=../.env", "src/server.ts"], {
  cwd: resolve(import.meta.dirname, ".."), env: { ...process.env, DATA_DIR: data, HEADLESS: "1", SHOWRUN_NO_NOTIFY: "1" }, stdio: "ignore",
});
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "remuse-profile-")), {
  channel: "chromium", headless: true, viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${narration}`],
});
try {
  for (let i = 0; i < 40 && !(await fetch(`${API}/sessions`).then((r) => r.ok, () => false)); i++) await sleep(250);
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
  const call = (fn: string, ...a: unknown[]) => sw.evaluate(([f, args]) => (globalThis as any).showrun[f as string](...(args as unknown[])), [fn, a] as const);

  // The demo, across three tabs.
  const orders = await ctx.newPage();
  await orders.goto(`${SITE}/orders`);
  await call("start", "");
  for (let i = 0; i < 30 && !((await call("status")) as any)?.recording; i++) await sleep(500);
  await orders.bringToFront(); await sleep(1500);
  const [inv] = await Promise.all([ctx.waitForEvent("page"), orders.getByRole("link", { name: "Open invoice" }).click()]);
  await inv.waitForLoadState(); await inv.bringToFront(); await sleep(4000);
  const log = await ctx.newPage();
  await log.goto(`${SITE}/log`); await log.bringToFront(); await sleep(1500);
  await log.getByRole("textbox", { name: "Customer" }).fill("Ana Cruz"); await log.getByRole("textbox", { name: "Customer" }).blur(); await sleep(800);
  await log.getByRole("textbox", { name: "Amount" }).fill("₱1,250.00"); await log.getByRole("textbox", { name: "Amount" }).blur(); await sleep(800);
  await log.getByRole("button", { name: "Save row" }).click(); await sleep(1500);
  await orders.bringToFront(); await sleep(800);
  await orders.getByRole("button", { name: "Mark as logged" }).click();
  await sleep(14000); // let the narration finish
  const stopped = (await call("stop")) as any;

  const s = await get(`/sessions/${stopped.id}`);
  const tabsSeen = new Set(s.events.filter((e: any) => e.tab != null).map((e: any) => e.tab));
  check("the recording knows which tab each action was in", tabsSeen.size === 3, `${tabsSeen.size} tabs`);

  let task: any;
  for (let i = 0; i < 120; i++) {
    task = (await get("/tasks")).find((t: any) => t.sessionId === stopped.id);
    if (task?.learnStage === "ready" || task?.learnStage === "failed") break;
    await sleep(3000);
  }
  check("Remuse learned it", task?.learnStage === "ready", task?.learnError ?? task?.learnStage);
  if (task?.learnStage === "ready") {
    const spec = (await get(`/specs/${task.specId}`)).spec;
    const steps = [...spec.steps, ...Object.values(spec.outcomes).flatMap((o: any) => o.steps)];
    console.log("   " + task.title + " | " + steps.map((x: any) => `[${x.tab ?? "-"}] ${x.do} ${x.target?.name ?? x.url ?? (x.vars ?? []).join(",")}`).join(" / "));
    check("each step says which tab it's in", new Set(steps.filter((x: any) => x.tab).map((x: any) => x.tab)).size >= 3, [...new Set(steps.map((x: any) => x.tab))].join(", "));

    invoice = { customer: "Ben Reyes", total: "₱980.00" }; // new data: it must read it, not replay the demo
    const r = await post(`/specs/${task.specId}/runs`, { autoApprove: true, rows: [{}] });
    let run: any;
    for (let i = 0; i < 80; i++) { run = await get(`/runs/${r.id}`); if (["done", "failed", "stopped"].includes(run.status)) break; await sleep(1500); }
    console.log("   run:", run.status, "|", run.items[0]?.log.map((l: any) => l.msg).join(" / ").slice(0, 700));
    const row = saved.at(-1);
    check("the run copies the new invoice into the log tab", row?.customer === "Ben Reyes" && row?.amount?.includes("980"), JSON.stringify(row));
    check("and finishes back in the orders tab, as it was left", run.items[0]?.log.some((l: any) => /logged/i.test(l.msg) && l.level === "ok") && run.status === "done", run.status);
  }
} finally {
  await ctx.close().catch(() => {});
  agent.kill(); site.close();
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map(([n]) => n).join(" | ")}` : ""}`);
}
