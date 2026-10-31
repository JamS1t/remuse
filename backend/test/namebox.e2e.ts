// End-to-end: writing a row in a Google-Sheets-like page whose Name Box has no label (as in real Sheets), next to the
// "Search the menus" box. The run must type into the Name Box, never "find" the menu search instead and save that
// into the task (James's practice did). Own Agent on port 3295. Run: node test/namebox.e2e.ts
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const PORT = "3295";
const API = `http://127.0.0.1:${PORT}/api`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: [string, boolean, string][] = [];
const check = (n: string, ok: boolean, d = "") => { results.push([n, ok, d]); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  (${d})` : ""}`); };
const get = async (p: string) => (await fetch(API + p)).json();
const post = async (p: string, b: unknown = {}) => (await fetch(API + p, { method: "POST", body: JSON.stringify(b) })).json();
if (await fetch(`${API}/sessions`).then(() => true, () => false)) { console.error(`Port ${PORT} is busy.`); process.exit(1); }

// Like real Sheets: the Name Box is #t-name-box with no aria-label; the menu search is a labelled toolbar beside it.
const cells: Record<string, string> = {};
const site = createServer(async (req, res) => {
  if (req.url === "/save" && req.method === "POST") { const c: Buffer[] = []; for await (const x of req) c.push(x); Object.assign(cells, JSON.parse(Buffer.concat(c).toString())); res.writeHead(200); return res.end("ok"); }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><title>Receipts</title>
    <div role="toolbar" id="docs-omnibox-toolbar" aria-label="Search the menus (Alt+/)" tabindex="0" style="display:inline-block;width:200px;height:24px;border:1px solid #ccc">Search the menus</div>
    <input id="t-name-box" class="waffle-name-box" value="A1" style="width:80px">
    <canvas id="grid" width="600" height="300" style="border:1px solid #ccc"></canvas>
    <iframe id="keys" style="position:absolute;left:-9999px"></iframe>
    <script>
      const box = document.getElementById("t-name-box"), f = document.getElementById("keys");
      const ed = f.contentDocument; ed.body.contentEditable = "true";
      const select = (c) => { box.value = c; f.contentWindow.focus(); ed.body.focus(); };
      box.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); select(box.value.toUpperCase()); } });
      ed.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const c = box.value, v = ed.body.innerText.trim();
        fetch("/save", { method: "POST", body: JSON.stringify({ [c]: v }) });
        ed.body.innerText = ""; box.value = c[0] + (Number(c.slice(1)) + 1);
      });
    </script>`);
}).listen(0);
const SITE = `http://127.0.0.1:${(site.address() as any).port}`;
const data = mkdtempSync(join(tmpdir(), "remuse-namebox-"));
const agent = spawn(process.execPath, ["--env-file-if-exists=../.env", "src/server.ts"], {
  cwd: resolve(import.meta.dirname, ".."), env: { ...process.env, PORT, DATA_DIR: data, BROWSER_PROFILE: join(data, "browser"), HEADLESS: "1", SHOWRUN_NO_NOTIFY: "1", OPEN_MODEL_KEY: "", BASETEN_API_KEY: "" }, stdio: process.env.SHOW_AGENT ? "inherit" : "ignore",
});
try {
  for (let i = 0; i < 40 && !(await fetch(`${API}/sessions`).then((r) => r.ok, () => false)); i++) await sleep(250);
  const s = await post("/sessions", { title: "Write a cell", startedAt: Date.now() });
  // As Muse Spark writes it: the Name Box by its role and name only (no selector).
  const spec = {
    title: "Write a cell", goal: "Put the total in C4.", scope: "", scopeTypes: [], inputs: { source: "once", itemName: "update" }, variables: [],
    steps: [
      { id: "s1", do: "goto", url: `${SITE}/sheet`, describe: "Open the sheet" },
      { id: "s2", do: "fill", target: { role: "textbox", name: "Name Box" }, value: "C4", describe: "Go to C4" },
      { id: "s3", do: "press", target: { role: "textbox", name: "Name Box" }, key: "Enter", describe: "Select it" },
      { id: "s4", do: "fill", value: "349", describe: "Type the total" },
      { id: "s5", do: "press", key: "Enter", describe: "Save the cell" },
    ],
    rules: [{ if: "otherwise", then: "done" }], outcomes: { done: { describe: "Done", demonstrated: true, steps: [] } },
  };
  // A task learned before the fix: no selector on the Name Box (James's receipts task is one).
  const db = new DatabaseSync(join(data, "showrun.db"));
  const specId = Number(db.prepare("INSERT INTO specs (session_id, version, note, json, code, tests, created_at) VALUES (?, 1, 'test', ?, ?, '[]', ?)")
    .run(s.id, JSON.stringify(spec), `({ extract: {}, compute: {}, decide: () => ({ outcome: "done", rule: 0 }) })`, Date.now()).lastInsertRowid);
  db.close();
  const r = await post(`/specs/${specId}/runs`, { autoApprove: true });
  let run: any;
  for (let i = 0; i < 60; i++) { run = await get(`/runs/${r.id}`); if (["done", "failed", "stopped"].includes(run.status)) break; await sleep(1000); }
  await sleep(500);
  const log = (run.items[0]?.log ?? []).map((l: any) => l.msg);
  check("the row is written through the unlabelled Name Box", cells.C4 === "349", `${run.status}: ${JSON.stringify(cells)} | ${log.slice(-3).join(" / ")}`);
  check("it never mistakes the menu search for it", !log.some((m: string) => /Search the menus/.test(m)), log.join(" / ").slice(0, 300));
  check("it finds the Name Box directly, without searching the screen", !log.some((m: string) => /Couldn.t find the text box "Name Box"|Found it:/.test(m)), log.join(" / ").slice(0, 300));
  const after = (await get(`/specs/${specId}`)).spec;
  check("and never saves a wrong box into the task", !JSON.stringify(after.steps).includes("Search the menus") && !JSON.stringify(after.steps).includes("\"A1\""), JSON.stringify(after.steps[1].target));
} catch (e) {
  check("the test ran to the end", false, (e as Error).stack ?? String(e));
} finally {
  agent.kill(); site.close();
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map(([n]) => n).join(" | ")}` : ""}`);
  process.exit(failed.length ? 1 : 0);
}
