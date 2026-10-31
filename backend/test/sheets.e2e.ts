// End-to-end: a recording longer than 30 s keeps the whole voice track, typing into a spreadsheet grid
// (drawn on a canvas, keys going through a hidden frame, like Google Sheets) is recorded with its cell,
// and the runner can write a cell through the Name Box. Needs port 3200 free.
// Run: node test/sheets.e2e.ts <narration.wav>
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
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

// A stand-in spreadsheet: the grid is a canvas, the cell address is in a "Name Box", and keys are typed
// into a hidden about:blank frame, as in Google Sheets.
const cells: Record<string, string> = {};
const site = createServer(async (req, res) => {
  if (req.url === "/save" && req.method === "POST") {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c);
    Object.assign(cells, JSON.parse(Buffer.concat(chunks).toString()));
    res.writeHead(200); return res.end("ok");
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><title>Stats log</title>
    <p id="views">Views 1,830</p>
    <input id="t-name-box" aria-label="Name Box" value="A1">
    <canvas id="grid" role="application" width="600" height="300" style="border:1px solid #ccc"></canvas>
    <iframe id="keys" style="position:absolute;left:-9999px"></iframe>
    <script>
      const box = document.getElementById("t-name-box"), f = document.getElementById("keys");
      const ed = f.contentDocument; ed.body.contentEditable = "true";
      const select = (c) => { box.value = c; f.contentWindow.focus(); ed.body.focus(); };
      // Clicking the grid picks a cell: column by x (A, B, C...), row by y.
      document.getElementById("grid").addEventListener("click", (e) => select("ABCDEF"[Math.floor(e.offsetX / 100)] + (Math.floor(e.offsetY / 30) + 1)));
      box.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); select(box.value.toUpperCase()); } });
      ed.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        const c = box.value, v = ed.body.innerText.trim();
        fetch("/save", { method: "POST", body: JSON.stringify({ [c]: v }) });
        ed.body.innerText = "";
        box.value = c[0] + (Number(c.slice(1)) + 1);
      });
    </script>`);
}).listen(0);
const SITE = `http://127.0.0.1:${(site.address() as any).port}`;

const data = mkdtempSync(join(tmpdir(), "remuse-sheets-"));
const agent = spawn(process.execPath, ["--env-file-if-exists=../.env", "src/server.ts"], {
  cwd: resolve(import.meta.dirname, ".."), env: { ...process.env, DATA_DIR: data, HEADLESS: "1", SHOWRUN_NO_NOTIFY: "1", OPEN_MODEL_KEY: "", BASETEN_API_KEY: "" }, stdio: "ignore",
});
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "remuse-profile-")), {
  channel: "chromium", headless: true, viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${narration}`],
});
try {
  for (let i = 0; i < 40 && !(await fetch(`${API}/sessions`).then((r) => r.ok, () => false)); i++) await sleep(250);
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
  const call = (fn: string, ...a: unknown[]) => sw.evaluate(([f, args]) => (globalThis as any).showrun[f as string](...(args as unknown[])), [fn, a] as const);

  const page = await ctx.newPage();
  await page.goto(`${SITE}/sheet`);
  await call("start", "");
  for (let i = 0; i < 30 && !((await call("status")) as any)?.recording; i++) await sleep(500);
  await page.bringToFront(); await sleep(1000);
  const v = await page.locator("#views").boundingBox();
  await page.mouse.move(v!.x + 5, v!.y + 5); await page.mouse.move(v!.x + 30, v!.y + 8); await sleep(1500); // point at it, no click
  await page.locator("#grid").click({ position: { x: 150, y: 45 } }); // B2
  await sleep(500);
  await page.keyboard.type("1,830"); await page.keyboard.press("Enter");
  await sleep(500);
  await page.keyboard.type("4.5%"); await page.keyboard.press("Enter");
  await sleep(40_000); // longer than the 30 s where the voice used to stop
  // While still recording, the sidebar can already show what Remuse heard and its draft of the task.
  const recId = ((await call("status")) as any).rec?.id;
  let lv: any = null;
  for (let i = 0; i < 20; i++) { lv = await get(`/sessions/${recId}/live`); if (lv.draft?.steps?.length && !lv.drafting) break; await sleep(1500); }
  console.log("   live:", JSON.stringify({ heard: lv.turns.map((x: any) => x.text).join(" ").slice(0, 120), draft: lv.draft }).slice(0, 600));
  check("while recording, the voice is heard in pieces", lv.turns.length > 0, `${lv.turns.length} pieces ${lv.error ?? ""}`);
  check("and a draft of the task is shown before you stop", (lv.draft?.steps?.length ?? 0) > 0, lv.error ?? "");
  const stopped = (await call("stop")) as any;

  const s = await get(`/sessions/${stopped.id}`);
  const typed = s.events.filter((e: any) => e.kind === "input");
  check("typing into the grid is recorded", typed.some((e: any) => e.value === "1,830") && typed.some((e: any) => e.value === "4.5%"), JSON.stringify(typed.map((e: any) => e.value)));
  check("with the cell it went into", typed.find((e: any) => e.value === "1,830")?.cell === "B2" && typed.find((e: any) => e.value === "4.5%")?.cell === "B3", JSON.stringify(typed.map((e: any) => e.cell)));
  check("on the spreadsheet's own address, not the hidden frame's", typed.every((e: any) => e.url.startsWith(SITE)), typed[0]?.url);
  console.log("   stop:", JSON.stringify(stopped));
  const wavPath = join(data, "sessions", stopped.id, "voice.wav");
  check("resting the mouse on something records nothing", !s.events.some((e: any) => e.kind === "point"), JSON.stringify(s.events.map((e: any) => e.kind)));
  const wav = existsSync(wavPath) ? readFileSync(wavPath) : Buffer.alloc(44);
  const secs = (wav.length - 44) / 32000, len = (s.ended_at - s.started_at) / 1000;
  check("the whole voice track is kept", secs > len - 4, `${secs.toFixed(1)} s of voice in a ${len.toFixed(1)} s recording`);

  // The runner writes a cell through the Name Box, then types where the focus is.
  for (const k of Object.keys(cells)) delete cells[k];
  const ss = await post("/sessions", { title: "Write a cell", startedAt: Date.now() });
  const spec = {
    title: "Write a cell", goal: "Put the views in C4.", scope: "", scopeTypes: [], inputs: { source: "once", itemName: "update" }, variables: [],
    steps: [
      { id: "s1", do: "goto", url: `${SITE}/sheet`, describe: "Open the sheet" },
      { id: "s2", do: "fill", target: { role: "textbox", name: "Name Box" }, value: "C4", describe: "Go to C4" },
      { id: "s3", do: "press", target: { role: "textbox", name: "Name Box" }, key: "Enter", describe: "Select it" },
      { id: "s4", do: "fill", value: "2,001", describe: "Type the views" },
      { id: "s5", do: "press", key: "Enter", describe: "Save the cell" },
    ],
    rules: [{ if: "otherwise", then: "done" }], outcomes: { done: { describe: "Done", demonstrated: true, steps: [] } },
  };
  const db = new DatabaseSync(join(data, "showrun.db"));
  const specId = Number(db.prepare("INSERT INTO specs (session_id, version, note, json, code, tests, created_at) VALUES (?, 1, 'test', ?, ?, '[]', ?)")
    .run(ss.id, JSON.stringify(spec), `({ extract: {}, compute: {}, decide: () => ({ outcome: "done", rule: 0 }) })`, Date.now()).lastInsertRowid);
  db.close();
  const r = await post(`/specs/${specId}/runs`, { autoApprove: true });
  let run: any;
  for (let i = 0; i < 40; i++) { run = await get(`/runs/${r.id}`); if (["done", "failed", "stopped"].includes(run.status)) break; await sleep(1000); }
  await sleep(500);
  check("the runner writes a cell through the Name Box", cells.C4 === "2,001", `${run.status}: ${JSON.stringify(cells)} ${run.items[0]?.log.at(-1)?.msg ?? ""}`);
} finally {
  await ctx.close().catch(() => {});
  agent.kill(); site.close();
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map(([n]) => n).join(" | ")}` : ""}`);
}
