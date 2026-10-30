// Check: a spoken note in the sidebar (feedback said out loud). The extension records it with the same
// microphone recorder, and Muse Voice Transcribe turns it into words. Needs port 3200 free.
// Run: node test/talk.check.ts <narration.wav>
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const API = "http://127.0.0.1:3200/api";
const ext = resolve(import.meta.dirname, "../../extension");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
if (await fetch(`${API}/sessions`).then(() => true, () => false)) { console.error("Port 3200 is busy: stop the Remuse Agent first."); process.exit(1); }
const agent = spawn(process.execPath, ["--env-file-if-exists=../.env", "src/server.ts"], {
  cwd: resolve(import.meta.dirname, ".."), env: { ...process.env, DATA_DIR: mkdtempSync(join(tmpdir(), "remuse-talk-")) }, stdio: "ignore",
});
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "remuse-profile-")), {
  channel: "chromium", headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${resolve(process.argv[2] ?? "")}`],
});
let ok = false;
try {
  for (let i = 0; i < 40 && !(await fetch(`${API}/sessions`).then((r) => r.ok, () => false)); i++) await sleep(250);
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${new URL(sw.url()).host}/sidepanel.html`);
  const say = (type: string) => page.evaluate((type) => chrome.runtime.sendMessage({ type }), type) as Promise<any>;
  const started = await say("talk");
  await sleep(9000);
  const r = await say("talkDone");
  console.log("started:", JSON.stringify(started), "heard:", JSON.stringify(r));
  ok = !started?.error && typeof r?.text === "string" && r.text.length > 10;
} finally {
  await ctx.close().catch(() => {});
  agent.kill();
  console.log(ok ? "PASS  a spoken note comes back as words" : "FAIL  a spoken note comes back as words");
}
