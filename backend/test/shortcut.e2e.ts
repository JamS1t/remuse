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
  channel: "chromium", headless: !process.env.HEADED, viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${quiet}`],
});
try {
  for (let i = 0; i < 40 && !(await fetch(`${API}/sessions`).then((r) => r.ok, () => false)); i++) await sleep(250);
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
  const extId = new URL(sw.url()).host;
  const call = (fn: string, ...a: unknown[]) => sw.evaluate(([f, args]) => (globalThis as any).showrun[f as string](...(args as unknown[])), [fn, a] as const) as Promise<any>;
  const recording = async () => !!(await call("status")).recording;
  // The sidebar is open (in its own tab here), as it is when the shortcut opens it.
  const side = await ctx.newPage();
  await side.setViewportSize({ width: 400, height: 860 });
  await side.goto(`chrome-extension://${extId}/sidepanel.html`);
  const ui = side.frameLocator("#ui");
  const page = await ctx.newPage();
  await page.goto(SITE);

  await call("command", "teach");
  for (let i = 0; i < 20 && !(await recording()); i++) await sleep(500);
  check("the teach shortcut starts a recording", await recording());
  await sleep(2500);
  await call("command", "teach");
  check("pressed again, it stops", !(await recording()));
  // Nothing done, nothing understood: not learned. Remuse asks whether that was a task.
  const first = (await call("status")).last;
  let t0: any;
  for (let i = 0; i < 30; i++) { t0 = ((await (await fetch(`${API}/tasks`)).json()) as any[]).find((x) => x.sessionId === first?.id); if (t0?.learnStage) break; await sleep(500); }
  check("a recording with nothing done or understood isn't learned; Remuse asks", t0?.learnStage === "unsure" && !t0?.specId, JSON.stringify({ last: first, task: t0 }));
  await ui.getByText("Was that a task?").waitFor({ timeout: 20000 }).catch(() => {});
  const asks = await ui.getByText("Was that a task?").isVisible().catch(() => false);
  if (!asks) console.log("   sidebar sees:", await side.frames()[1]?.evaluate(() => fetch("/api/tasks").then((r) => r.json()).then((t) => JSON.stringify({ teach: localStorage.getItem("remuse.teach"), tasks: t.map((x: any) => [x.sessionId, x.learnStage]) }))).catch((e) => String(e)));
  check("the sidebar asks \"Was that a task?\"", asks);
  await side.screenshot({ path: join(tmp, "unsure.png") }); console.log("   screenshot:", join(tmp, "unsure.png"));
  await ui.getByRole("button", { name: "Throw it away" }).click({ timeout: 5000 }).catch(() => {});
  await ui.getByRole("button", { name: /Watch me do a task/ }).waitFor({ timeout: 8000 }).catch(() => {});
  check("\"Throw it away\" removes it and goes back to the dashboard", (await fetch(`${API}/sessions/${first?.id}`)).status === 404 && await ui.getByRole("button", { name: /Watch me do a task/ }).isVisible().catch(() => false));
  await page.bringToFront();
  // Cancel while teaching: the recording is thrown away, nothing to learn.
  await call("command", "teach");
  for (let i = 0; i < 20 && !(await recording()); i++) await sleep(500);
  const cid = (await call("status")).rec?.id;
  await call("cancel");
  check("cancel throws the recording away", !(await recording()) && (await fetch(`${API}/sessions/${cid}`)).status === 404 && (await call("status")).last?.cancelled === true, JSON.stringify((await call("status")).last));
  await call("setMode", "review");
  await call("command", "teach"); await sleep(1500);
  check("during a review it never starts a new recording", !(await recording()));
  await call("setMode", "idle");

  // Remuse speaks (the review reads its plan aloud): it shows while it talks, hush ends it, and the teach shortcut
  // while it talks only silences it.
  // Test Chromium has no voices (James's Chrome does): a stand-in engine that "says" each line in 1.5 s, so the
  // speaking, hush and shortcut logic still runs. Real voices are checked live.
  const voices = await sw.evaluate(() => chrome.tts.getVoices().then((v) => v.length));
  if (!voices) await sw.evaluate(() => {
    const q: { o: any; timer?: ReturnType<typeof setTimeout> }[] = [];
    const play = () => { const u = q[0]; if (!u) return; u.o.onEvent?.({ type: "start" }); u.timer = setTimeout(() => { q.shift(); u.o.onEvent?.({ type: "end" }); play(); }, 1500); };
    const tts = chrome.tts as any;
    tts.getVoices = async () => [{ voiceName: "Google US English", lang: "en-US" }];
    tts.speak = (_text: string, o: any) => { q.push({ o }); if (q.length === 1) play(); };
    tts.stop = () => { for (const u of q.splice(0)) { clearTimeout(u.timer); u.o.onEvent?.({ type: "interrupted" }); } };
  });
  const sp = call("speak", ["One.", "Two."]);
  await sleep(300);
  check("speaking shows in status, line by line", (await call("status")).speaking?.total === 2 && (await call("status")).speaking?.line === 0, JSON.stringify((await call("status")).speaking));
  await sleep(1600);
  check("and moves to the next line", (await call("status")).speaking?.line === 1, JSON.stringify((await call("status")).speaking));
  await call("hush");
  check("hush ends it", (await call("status")).speaking === null && (await sp).spoken === 1, JSON.stringify(await sp));
  const whole = await call("speak", ["Short."]);
  check("a plan read to the end says how many lines it spoke", whole.spoken === 1, JSON.stringify(whole));
  call("speak", ["A long line to be cut off by the shortcut."]);
  await sleep(300);
  await call("command", "teach"); await sleep(500);
  const after = await call("status");
  check("the teach shortcut while speaking only silences it", !after.recording && after.speaking === null, JSON.stringify({ recording: after.recording, speaking: after.speaking }));
  // Closing the sidebar ends the review's talking (and listening).
  const extra = await ctx.newPage();
  await extra.goto(`chrome-extension://${extId}/sidepanel.html`); await sleep(500);
  call("speak", ["A long line, still going when the sidebar closes."]);
  await sleep(300);
  await extra.close(); await sleep(800);
  check("closing the sidebar stops Remuse talking", (await call("status")).speaking === null, JSON.stringify((await call("status")).speaking));
  // What the sidebar shows survives the worker being stopped by Chrome.
  await call("setMode", "review");
  check("the review state is kept where a sleeping worker finds it", (await sw.evaluate(() => chrome.storage.session.get("mode")) as any).mode === "review");
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
