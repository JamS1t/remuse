// End-to-end: with the extension linked, a run happens in the person's own Chrome. It uses the login that
// Chrome already has (nothing copied), follows a tab the site opens, and closes its tabs when done.
// Needs port 3200 free.
// Run: node test/chrome.e2e.ts
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";

const API = "http://127.0.0.1:3200/api";
const ext = resolve(import.meta.dirname, "../../extension");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: [string, boolean, string][] = [];
const check = (n: string, ok: boolean, d = "") => { results.push([n, ok, d]); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  (${d})` : ""}`); };
const get = async (p: string) => (await fetch(API + p)).json();
const post = async (p: string, b: unknown = {}) => (await fetch(API + p, { method: "POST", body: JSON.stringify(b) })).json();
if (await fetch(`${API}/sessions`).then(() => true, () => false)) { console.error("Port 3200 is busy: stop the Remuse Agent first."); process.exit(1); }

// A site you're signed in to in your Chrome (a session cookie). Without it, it shows its sign-in page.
const site = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  const signedIn = /session=ana/.test(req.headers.cookie ?? "");
  if (!signedIn) return res.end(`<title>Sign in</title><h1>Sign in</h1><input type="password">`);
  if (req.url === "/invoice") return res.end(`<title>Invoice</title><h1>Invoice 4821</h1><p>Customer: Ana Cruz</p><p>Total: ₱1,250.00</p>`);
  res.end(`<title>Orders</title><h1>Orders</h1><a href="/invoice" target="_blank">Open invoice</a>`);
}).listen(0);
const SITE = `http://localhost:${(site.address() as any).port}`;

const data = mkdtempSync(join(tmpdir(), "remuse-chrome-"));
const agent = spawn(process.execPath, ["--env-file-if-exists=../.env", "src/server.ts"], {
  cwd: resolve(import.meta.dirname, ".."), env: { ...process.env, DATA_DIR: data, SHOWRUN_NO_NOTIFY: "1", OPEN_MODEL_KEY: "", BASETEN_API_KEY: "" }, stdio: process.env.SHOW_AGENT ? "inherit" : "ignore",
});
let ctx: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | null = null;
try {
  for (let i = 0; i < 40 && !(await fetch(`${API}/sessions`).then((r) => r.ok, () => false)); i++) await sleep(250);
  // "Your Chrome": the extension loaded and signed in to the site.
  ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "remuse-yourchrome-")), {
    channel: "chromium", headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  await ctx.addCookies([{ name: "session", value: "ana", domain: "localhost", path: "/" }]);
  await ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
  await sleep(2500); // the extension links up with the Agent

  const s = await post("/sessions", { title: "Read the invoice", startedAt: Date.now() });
  const spec = {
    title: "Read the invoice", goal: "Read the customer and total on the invoice.", scope: "", scopeTypes: [], inputs: { source: "once", itemName: "invoice" },
    variables: [{ name: "customer", kind: "text", description: "Customer", demoValue: "Ana Cruz" }, { name: "total", kind: "text", description: "Total", demoValue: "₱1,250.00" }],
    steps: [
      { id: "s1", tab: "orders", do: "goto", url: `${SITE}/orders`, describe: "Open the orders" },
      { id: "s2", tab: "orders", do: "click", target: { role: "link", name: "Open invoice" }, describe: "Open the invoice" },
      { id: "s3", tab: "invoice", do: "extract", vars: ["customer", "total"], describe: "Read it" },
    ],
    rules: [{ if: "otherwise", then: "done" }],
    outcomes: { done: { describe: "Tell me", demonstrated: true, steps: [{ id: "s4", do: "report", message: "{{customer}} {{total}}", describe: "Tell me" }] } },
  };
  const code = `({ extract: { customer: (t) => /Customer:\\s*(.+)/.exec(t)?.[1]?.trim() ?? null, total: (t) => /Total:\\s*(\\S+)/.exec(t)?.[1] ?? null }, compute: {}, decide: () => ({ outcome: "done", rule: 0 }) })`;
  const db = new DatabaseSync(join(data, "showrun.db"));
  const specId = Number(db.prepare("INSERT INTO specs (session_id, version, note, json, code, tests, created_at) VALUES (?, 1, 'test', ?, ?, '[]', ?)")
    .run(s.id, JSON.stringify(spec), code, Date.now()).lastInsertRowid);
  db.close();

  const before = ctx.pages().length;
  const r = await post(`/specs/${specId}/runs`, { autoApprove: true });
  let run: any;
  for (let i = 0; i < 150; i++) { run = await get(`/runs/${r.id}`); if (["done", "failed", "stopped"].includes(run.status)) break; await sleep(1000); }
  const it = run.items[0];
  console.log("   log:", it?.log.map((l: any) => l.msg).join(" / ").slice(0, 500), run.error ?? "");
  check("the run happens in your own Chrome", run.browser === "chrome", run.browser);
  check("with the login Chrome already has, nothing copied", it?.report === "Ana Cruz ₱1,250.00" && run.status === "done", `${run.status}: ${it?.report}`);
  check("and its logins were never copied to the Agent", !existsSync(join(data, "logins.json")) || readFileSync(join(data, "logins.json"), "utf8").length < 5);
  await sleep(1500);
  check("its tabs close when the run ends", ctx.pages().length <= before, `${before} before, ${ctx.pages().length} after`);
} finally {
  await ctx?.close().catch(() => {});
  agent.kill(); site.close();
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map(([n]) => n).join(" | ")}` : ""}`);
}
