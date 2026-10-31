// End-to-end check of the recorder: real Chromium + the extension + a fake mic playing the
// narration fixture, clicking through the hero task on the mock apps.
// Needs: mock apps on :3100 (cd mock-apps && npm start), port 3200 free.
// Run: npm run test:recorder   (transcription is checked only if ../.env has MODEL_API_KEY)
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MOCK = "http://localhost:3100";
const API = "http://127.0.0.1:3200/api";
const hasKey = existsSync(join(ROOT, ".env")) && /MODEL_API_KEY=\S/.test(readFileSync(join(ROOT, ".env"), "utf8"));

await fetch(MOCK).catch(() => { console.error("Mock apps not running on :3100. Start them: cd mock-apps && npm start"); process.exit(1); });
await fetch(`${MOCK}/api/reset`, { method: "POST" });

// DATA_DIR=data keeps the session (e.g. as a dev fixture); NARRATION picks the fake mic file.
const data = process.env.DATA_DIR ? join(ROOT, "backend", process.env.DATA_DIR) : mkdtempSync(join(tmpdir(), "remuse-"));
const narration = join(ROOT, "scripts", "fixtures", process.env.NARRATION ?? "narration.wav");
const narrationMs = ((readFileSync(narration).length - 44) / 32000) * 1000; // 16 kHz mono 16-bit
const backend = spawn(process.execPath, ["--env-file-if-exists=../.env", "src/server.ts"], {
  cwd: join(ROOT, "backend"), env: { ...process.env, DATA_DIR: data, OPEN_MODEL_KEY: "", BASETEN_API_KEY: "" }, stdio: "inherit",
});
for (let i = 0; i < 50 && !(await fetch(`${API}/sessions`).then((r) => r.ok, () => false)); i++) await new Promise((r) => setTimeout(r, 100));

const ext = join(ROOT, "extension");
let ctx: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
try {
  ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "remuse-profile-")), {
  channel: "chromium", // full Chromium in new headless mode; the headless shell can't load extensions
  headless: true,
  viewport: { width: 1440, height: 900 },
  args: [
    `--disable-extensions-except=${ext}`, `--load-extension=${ext}`,
    "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${narration}`,
  ],
});

  const worker = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(`${MOCK}/inbox`);
  const pause = () => page.waitForTimeout(1200);

  const started = await worker.evaluate(() => (globalThis as any).showrun.start("Resolve a complaint"));
  console.log("started", started);

  await page.getByRole("link", { name: /Maria Santos/ }).click(); await pause();
  await page.goto(`${MOCK}/store`); await pause();
  await page.getByRole("textbox", { name: "Search orders" }).fill("KG-10401");
  await page.keyboard.press("Enter"); await pause();
  await page.getByRole("link", { name: "KG-10401" }).click(); await pause();
  await page.goto(`${MOCK}/courier`); await pause();
  await page.getByRole("textbox", { name: "Tracking number" }).fill("BX782137PH");
  await page.getByRole("button", { name: "Track" }).click(); await pause();
  await page.goto(`${MOCK}/store/orders/KG-10401`); await pause();
  await page.getByRole("textbox", { name: "Replacement reason" }).fill("Mug arrived cracked, photo in email");
  await page.getByRole("button", { name: "Replace" }).click(); await pause();
  await page.goto(`${MOCK}/inbox/m001`); await pause();
  await page.locator("#reply-body").fill("Hi Maria, sorry about the mug. A replacement is on its way.");
  await page.getByRole("button", { name: "Send reply" }).click(); await pause();
  await page.waitForTimeout(Math.max(0, started.t0 + narrationMs + 1200 - Date.now())); // let the narration finish

  const result = await worker.evaluate(() => (globalThis as any).showrun.stop());
  console.log("stopped", result);

  const s = await (await fetch(`${API}/sessions/${result.id}`)).json();
  const ev = s.events as any[];
  console.log(ev.map((e) => `${String(e.t).padStart(6)} ms  ${e.kind.padEnd(5)} ${e.target?.label ?? e.url}${e.value ? ` = "${e.value}"` : ""}${e.before ? " [before]" : ""}${e.after ? " [after]" : ""}`).join("\n"));

  const find = (kind: string, label: string) => ev.findIndex((e) => e.kind === kind && e.target?.label === label);
  assert.ok(ev[0].kind === "start" && ev[0].after, "start event with a screenshot");
  assert.ok(ev.filter((e) => e.kind === "page").length >= 6, "page changes recorded");
  assert.equal(ev[find("input", "Search orders")].value, "KG-10401");
  const replace = ev[find("click", "Replace")];
  assert.ok(replace?.before && replace?.after, "Replace click has before and after screenshots");
  assert.deepEqual(Object.keys(replace.target.grid), ["x_min", "y_min", "x_max", "y_max"]);
  assert.ok(find("input", "Replacement reason") < find("click", "Replace"), "typing recorded before the click that follows it");
  assert.ok(find("input", "Reply to Maria Santos") >= 0 || ev.some((e) => e.kind === "input" && e.target?.tag === "textarea"), "reply text recorded");
  const png = await fetch(`${API}/sessions/${result.id}/files/${replace.before}`);
  assert.equal(png.headers.get("content-type"), "image/png");
  assert.ok(existsSync(join(data, "sessions", result.id, "voice.wav")), "voice uploaded as WAV");

  if (hasKey) {
    assert.ok(s.turns.length > 0, `transcribed (error: ${s.transcribe_error})`);
    assert.match(s.transcript, /replacement/i);
    console.log("turns:", s.turns);
  } else console.log("no MODEL_API_KEY: skipped transcription check");

  const state = await (await fetch(`${MOCK}/api/state`)).json();
  assert.equal(state.orders.find((o: any) => o.id === "KG-10401").status, "replacement_sent", "the demo really changed the mock store");
  console.log("\nrecorder e2e: PASS");
} finally {
  await ctx?.close();
  backend.kill();
  await fetch(`${MOCK}/api/reset`, { method: "POST" });
}
