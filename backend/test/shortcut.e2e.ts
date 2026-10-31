// End-to-end: the teach shortcut (Alt+Shift+S) starts teaching, stops it when pressed again, and never starts a new
// recording over a review in progress. A silent test microphone, so nothing said can end it. Needs port 3200 free.
// Run: node test/shortcut.e2e.ts
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const API = "http://127.0.0.1:3200/api";
const ext = resolve(import.meta.dirname, "../../extension");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: [string, boolean, string][] = [];
const check = (n: string, ok: boolean, d = "") => { results.push([n, ok, d]); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  (${d})` : ""}`); };
if (await fetch(`${API}/sessions`).then(() => true, () => false)) { console.error("Port 3200 is busy: stop the Remuse Agent first."); process.exit(1); }

const site = createServer((_req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end(`<!doctype html><title>Home</title><h1>Home</h1>`); }).listen(0);
const SITE = `http://127.0.0.1:${(site.address() as any).port}`;
const tmp = mkdtempSync(join(tmpdir(), "remuse-shortcut-"));
const quiet = join(tmp, "quiet.wav");
{ const n = 16000 * 30, b = Buffer.alloc(44 + n * 2); b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40); writeFileSync(quiet, b); }

const agent = spawn(process.execPath, ["--env-file-if-exists=../.env", "src/server.ts"], {
  cwd: resolve(import.meta.dirname, ".."), env: { ...process.env, DATA_DIR: join(tmp, "data"), HEADLESS: "1", SHOWRUN_NO_NOTIFY: "1", OPEN_MODEL_KEY: "", BASETEN_API_KEY: "" }, stdio: process.env.SHOW_AGENT ? "inherit" : "ignore",
});
const ctx = await chromium.launchPersistentContext(join(tmp, "profile"), {
  channel: "chromium", headless: true, viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${quiet}`],
});
try {
  for (let i = 0; i < 40 && !(await fetch(`${API}/sessions`).then((r) => r.ok, () => false)); i++) await sleep(250);
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
  const extId = new URL(sw.url()).host;
  const call = (fn: string, ...a: unknown[]) => sw.evaluate(([f, args]) => (globalThis as any).showrun[f as string](...(args as unknown[])), [fn, a] as const) as Promise<any>;
  const recording = async () => !!(await call("status")).recording;
  const page = await ctx.newPage();
  await page.goto(SITE);

  await call("command", "teach");
  for (let i = 0; i < 20 && !(await recording()); i++) await sleep(500);
  check("the teach shortcut starts a recording", await recording());
  await call("command", "teach");
  check("pressed again, it stops", !(await recording()));
  await call("setMode", "review");
  await call("command", "teach"); await sleep(1500);
  check("during a review it never starts a new recording", !(await recording()));
  await call("setMode", "idle");

  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  const keys = await panel.evaluate(() => chrome.runtime.sendMessage({ type: "keys" }));
  check("the sidebar can show the bound keys", keys?.teach === "Alt+Shift+S" && keys?.pen === "Alt+Shift+D", JSON.stringify(keys));
  const mode = await panel.evaluate(() => chrome.runtime.sendMessage({ type: "mode", mode: "learning" }));
  check("the sidebar sets what it's showing", mode?.mode === "learning", JSON.stringify(mode));
} catch (e) {
  check("the test ran to the end", false, (e as Error).stack ?? String(e));
} finally {
  await ctx.close().catch(() => {});
  agent.kill(); site.close();
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map(([n]) => n).join(" | ")}` : ""}`);
  process.exit(failed.length ? 1 : 0);
}
