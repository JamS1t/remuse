// End-to-end: the microphone keeps recording for the whole demo. James's recordings went silent (exact zeros) after
// about 30 s, so "I'm done" was never heard. Records 60 s of looping speech with memory cleanup forced along the
// way, then checks the saved track has sound in every stretch. Own Agent on port 3297 and a copy of the extension
// pointed at it, so the Agent you use keeps running. Run: node test/mic.e2e.ts
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const PORT = "3297";
const API = `http://127.0.0.1:${PORT}/api`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: [string, boolean, string][] = [];
const check = (n: string, ok: boolean, d = "") => { results.push([n, ok, d]); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  (${d})` : ""}`); };
if (await fetch(`${API}/sessions`).then(() => true, () => false)) { console.error(`Port ${PORT} is busy: another test is running.`); process.exit(1); }

const tmp = mkdtempSync(join(tmpdir(), "remuse-mic-"));
const ext = join(tmp, "extension");
cpSync(resolve(import.meta.dirname, "../../extension"), ext, { recursive: true });
for (const f of readdirSync(ext).filter((x) => x.endsWith(".js"))) writeFileSync(join(ext, f), readFileSync(join(ext, f), "utf8").replaceAll("127.0.0.1:3200", `127.0.0.1:${PORT}`));
const voice = resolve(import.meta.dirname, "../../scripts/fixtures/narration.wav"); // ~15 s of talking, looped by the fake mic

const site = createServer((_req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end(`<!doctype html><title>Home</title><h1>Home</h1>`); }).listen(0);
const data = join(tmp, "data");
const agent = spawn(process.execPath, ["--env-file-if-exists=../.env", "src/server.ts"], {
  cwd: resolve(import.meta.dirname, ".."), env: { ...process.env, PORT, DATA_DIR: data, BROWSER_PROFILE: join(tmp, "browser"), HEADLESS: "1", SHOWRUN_NO_NOTIFY: "1", OPEN_MODEL_KEY: "", BASETEN_API_KEY: "" }, stdio: process.env.SHOW_AGENT ? "inherit" : "ignore",
});
const ctx = await chromium.launchPersistentContext(join(tmp, "profile"), {
  channel: "chromium", headless: true, viewport: { width: 1000, height: 700 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${voice}`, "--js-flags=--expose-gc", "--remote-debugging-port=9337"],
});
try {
  for (let i = 0; i < 40 && !(await fetch(`${API}/sessions`).then((r) => r.ok, () => false)); i++) await sleep(250);
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
  const extId = new URL(sw.url()).host;
  const call = (fn: string, ...a: unknown[]) => sw.evaluate(([f, args]) => (globalThis as any).showrun[f as string](...(args as unknown[])), [fn, a] as const) as Promise<any>;
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${(site.address() as any).port}`);
  await call("start", "");
  for (let i = 0; i < 20 && !(await call("status")).recording; i++) await sleep(500);
  // The recorder's own page, through Chrome's debugging port: force memory cleanup now and then, as a long demo
  // would, and at 15 s switch the mic track off, which delivers exact zeros: what James's recordings showed.
  const targets = await (await fetch("http://127.0.0.1:9337/json")).json() as any[];
  const off = targets.find((t) => t.url === `chrome-extension://${extId}/offscreen.html`);
  const ws = off ? new WebSocket(off.webSocketDebuggerUrl) : null;
  if (ws) await new Promise((r) => ws.addEventListener("open", r));
  let msgId = 0;
  const run = (expression: string) => ws?.send(JSON.stringify({ id: ++msgId, method: "Runtime.evaluate", params: { expression } }));
  for (let s = 0; s < 60; s += 5) {
    await sleep(5000);
    run("typeof gc === 'function' && gc()");
    if (s === 10) run("stream.getAudioTracks()[0].enabled = false");
  }
  ws?.close();
  const stopped = await call("stop");
  const wavPath = join(data, "sessions", stopped.id, "voice.wav");
  check("the voice track was saved", existsSync(wavPath), wavPath);
  const b = readFileSync(wavPath), rate = b.readUInt32LE(24), n = (b.length - 44) >> 1;
  // Every 5 s stretch must have sound in it: the fake mic talks the whole time.
  const silent: number[] = [];
  for (let i = 0; i + rate * 5 <= n; i += rate * 5) { let s = 0; for (let j = i; j < i + rate * 5; j++) { const v = b.readInt16LE(44 + 2 * j); s += v * v; } if (Math.sqrt(s / (rate * 5)) < 30) silent.push(i / rate); }
  check("the mic page was reached", !!off);
  check("after the mic goes silent at 15 s, it comes back: sound again in the last 30 s", silent.every((t) => t < 30) && n / rate > 55, `${(n / rate).toFixed(0)} s; silent from: ${silent.join(", ") || "none"}`);
} catch (e) {
  check("the test ran to the end", false, (e as Error).stack ?? String(e));
} finally {
  await ctx.close().catch(() => {});
  agent.kill(); site.close();
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map(([n]) => n).join(" | ")}` : ""}`);
  process.exit(failed.length ? 1 : 0);
}
