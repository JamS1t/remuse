// End-to-end (real models): what counts as proof that a step worked. Text that was already on the page proves
// nothing; a failed page check isn't overruled by a happy-looking screen; something typed that can't be read back
// stops later irreversible steps; a guessed replacement that didn't work is never saved. Own Agent on port 3291.
// Run: node test/proof.e2e.ts
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const PORT = "3291";
const API = `http://127.0.0.1:${PORT}/api`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: [string, boolean, string][] = [];
const check = (n: string, ok: boolean, d = "") => { results.push([n, ok, d]); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  (${d})` : ""}`); };
const get = async (p: string) => (await fetch(API + p)).json();
const post = async (p: string, b: unknown = {}) => (await fetch(API + p, { method: "POST", body: JSON.stringify(b) })).json();
if (await fetch(`${API}/sessions`).then(() => true, () => false)) { console.error(`Port ${PORT} is busy.`); process.exit(1); }

const did = new Set<string>();
const page = (body: string) => `<!doctype html><meta charset="utf-8"><title>Reports</title><body style="font:16px sans-serif;padding:24px">${body}</body>`;
const site = createServer((req, res) => {
  const u = new URL(req.url!, "http://x");
  if (u.pathname === "/did") { did.add(u.searchParams.get("what")!); res.writeHead(200); return res.end("ok"); }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  if (u.pathname === "/already") return res.end(page(`<h1>Monthly report</h1><button onclick="fetch('/did?what=open')">Open report</button>`));
  if (u.pathname === "/export") return res.end(page(`<h1>Monthly report</h1><button onclick="out.textContent='✓ Export complete: your report was exported.'">Export</button><p id="out"></p>`));
  // The editor is in its own frame (like Google Sheets' cell editor), focused on load: what's typed can't be read back.
  if (u.pathname === "/form") return res.end(page(`<h1>Request</h1><iframe id="ed" srcdoc="<body contenteditable=true style='font:16px sans-serif'></body>" style="border:1px solid #999;height:60px;width:400px"></iframe>
    <button onclick="fetch('/did?what=submit');out.textContent='Submitted'">Submit</button><p id="out"></p>
    <script>ed.onload = () => { ed.contentWindow.focus(); ed.contentDocument.body.focus(); };</script>`));
  return res.end(page(`<h1>Monthly report</h1><button onclick="fetch('/did?what=download')">Download</button>`));
}).listen(0);
const SITE = `http://127.0.0.1:${(site.address() as any).port}`;
const data = mkdtempSync(join(tmpdir(), "remuse-proof-"));
const agent = spawn(process.execPath, ["--env-file-if-exists=../.env", "src/server.ts"], {
  cwd: resolve(import.meta.dirname, ".."), env: { ...process.env, PORT, DATA_DIR: data, BROWSER_PROFILE: join(data, "browser"), HEADLESS: "1", SHOWRUN_NO_NOTIFY: "1", OPEN_MODEL_KEY: "", BASETEN_API_KEY: "" }, stdio: process.env.SHOW_AGENT ? "inherit" : "ignore",
});
const addTask = async (title: string, steps: object[]) => {
  const s = await post("/sessions", { title, startedAt: Date.now() });
  const spec = { title, goal: title, scope: "", scopeTypes: [], inputs: { source: "once", itemName: "update" }, variables: [], steps,
    rules: [{ if: "otherwise", then: "done" }], outcomes: { done: { describe: "Done", demonstrated: true, steps: [] } } };
  const db = new DatabaseSync(join(data, "showrun.db"));
  const id = Number(db.prepare("INSERT INTO specs (session_id, version, note, json, code, tests, created_at) VALUES (?, 1, 'test', ?, ?, '[]', ?)")
    .run(s.id, JSON.stringify(spec), `({ extract: {}, compute: {}, decide: () => ({ outcome: "done", rule: 0 }) })`, Date.now()).lastInsertRowid);
  db.close();
  return id;
};
const run = async (specId: number) => {
  const { id } = await post(`/specs/${specId}/runs`, { autoApprove: true });
  let r: any;
  for (let i = 0; i < 120; i++) { r = await get(`/runs/${id}`); if (["done", "failed", "stopped"].includes(r.status)) break; await sleep(1000); }
  return r;
};
const lines = (r: any) => (r.items?.[0]?.log ?? []) as { msg: string; level: string; how?: string; why?: string }[];
try {
  for (let i = 0; i < 40 && !(await fetch(`${API}/sessions`).then((r) => r.ok, () => false)); i++) await sleep(250);

  // 1. "Monthly report" is on the page before the click: finding it afterwards proves nothing about the click.
  const r1 = await run(await addTask("Open the report", [
    { id: "s1", do: "goto", url: `${SITE}/already`, describe: "Open the reports page" },
    { id: "s2", do: "click", target: { role: "button", name: "Open report" }, describe: "Open the report", expect: { textIncludes: "Monthly report", looks: "the report is open" } },
  ]));
  const l1 = lines(r1).find((l) => /Open the report$/.test(l.msg) || /Open the report\b/.test(l.msg) && l.msg !== "In the tab");
  check("text that was there before the step isn't page proof", !!l1 && l1.how !== "page", JSON.stringify(lines(r1).slice(-2)));

  // 2. The page check fails ("Exported OK" never shows); the screen looks like success. The page check wins.
  const r2 = await run(await addTask("Export the report", [
    { id: "s1", do: "goto", url: `${SITE}/export`, describe: "Open the reports page" },
    { id: "s2", do: "click", target: { role: "button", name: "Export" }, describe: "Export the report", expect: { textIncludes: "Exported OK", looks: "the report export finished" } },
  ]));
  check("a failed page check isn't overruled by the screen", r2.items?.[0]?.status === "failed", `${r2.items?.[0]?.status}: ${lines(r2).slice(-2).map((l) => l.msg).join(" / ")}`);

  // 3. Typing into a box that can't be read back isn't proof; the irreversible Submit after it must not happen.
  const r3 = await run(await addTask("Send the request", [
    { id: "s1", do: "goto", url: `${SITE}/form`, describe: "Open the request form" },
    { id: "s2", do: "fill", value: "Please send the invoice", describe: "Write the note" },
    { id: "s3", do: "click", target: { role: "button", name: "Submit" }, describe: "Submit the request", expect: { textIncludes: "Submitted" } },
  ]));
  check("an unproven write stops the irreversible step after it", !did.has("submit") && lines(r3).some((l) => /couldn.t prove "Write the note" worked, so I didn.t submit the request\./i.test(l.msg)), lines(r3).map((l) => l.msg).join(" / ").slice(0, 400));

  // 4. "Export now" is gone; whatever replacement is guessed doesn't make "Exported OK" appear: nothing is saved.
  const id4 = await addTask("Export now", [
    { id: "s1", do: "goto", url: `${SITE}/other`, describe: "Open the reports page" },
    { id: "s2", do: "click", target: { role: "button", name: "Export now" }, describe: "Export the report", expect: { textIncludes: "Exported OK", looks: "the report export finished" } },
  ]);
  const r4 = await run(id4);
  const saved = (await get(`/specs/${r4.newSpecId ?? id4}`)).spec.steps[1].target;
  check("a guessed replacement that didn't work isn't saved", saved.name === "Export now" && !(r4.heals ?? []).length, `${JSON.stringify(saved)} heals=${JSON.stringify(r4.heals)}`);
} catch (e) {
  check("the test ran to the end", false, (e as Error).stack ?? String(e));
} finally {
  agent.kill(); site.close();
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map(([n]) => n).join(" | ")}` : ""}`);
  process.exit(failed.length ? 1 : 0);
}
