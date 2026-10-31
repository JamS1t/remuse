// End-to-end teaching: real Chromium with the extension and a test microphone that says "Open the report page
// and read the total.", then "Okay, that's it." Each sentence is heard whole while recording, cards appear that
// cite words or clicks, and the end phrase stops the recording by itself. Needs port 3200 free.
// Run: node test/teach.e2e.ts
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const API = "http://127.0.0.1:3200/api";
const voice = resolve(import.meta.dirname, "../../scripts/fixtures/teach.wav");
const ext = resolve(import.meta.dirname, "../../extension");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: [string, boolean, string][] = [];
const check = (n: string, ok: boolean, d = "") => { results.push([n, ok, d]); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  (${d})` : ""}`); };
const get = async (p: string) => (await fetch(API + p)).json();
const post = async (p: string, b: unknown = {}) => (await fetch(API + p, { method: "POST", body: JSON.stringify(b) })).json();
if (await fetch(`${API}/sessions`).then(() => true, () => false)) { console.error("Port 3200 is busy: stop the Remuse Agent first."); process.exit(1); }

const site = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(req.url === "/report" ? `<!doctype html><title>Report</title><h1>Report</h1><p id="total">Total 1,204</p>` : `<!doctype html><title>Home</title><h1>Home</h1><a href="/report">Report</a>`);
}).listen(0);
const SITE = `http://127.0.0.1:${(site.address() as any).port}`;

// A WAV of silence: what the microphone sends when it picks up a cough or a click.
const silence = (secs: number) => {
  const n = 16000 * secs, b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  return b;
};

const data = mkdtempSync(join(tmpdir(), "remuse-teach-"));
const agent = spawn(process.execPath, ["--env-file-if-exists=../.env", "src/server.ts"], {
  cwd: resolve(import.meta.dirname, ".."), env: { ...process.env, DATA_DIR: data, HEADLESS: "1", SHOWRUN_NO_NOTIFY: "1", OPEN_MODEL_KEY: "", BASETEN_API_KEY: "" }, stdio: process.env.SHOW_AGENT ? "inherit" : "ignore",
});
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "remuse-profile-")), {
  channel: "chromium", headless: true, viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${voice}%noloop`],
});
try {
  for (let i = 0; i < 40 && !(await fetch(`${API}/sessions`).then((r) => r.ok, () => false)); i++) await sleep(250);
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
  const extId = new URL(sw.url()).host;
  const call = (fn: string, ...a: unknown[]) => sw.evaluate(([f, args]) => (globalThis as any).showrun[f as string](...(args as unknown[])), [fn, a] as const) as Promise<any>;

  const page = await ctx.newPage();
  await page.goto(SITE);
  await call("start", "");
  for (let i = 0; i < 30 && !(await call("status"))?.recording; i++) await sleep(500);
  const recId = (await call("status")).rec?.id;
  await page.bringToFront(); await sleep(2500);
  await page.getByRole("link", { name: "Report" }).click();

  // The sidebar while teaching: a screen of its own, with Stop, the voice hint and the cards with their evidence.
  const side = await ctx.newPage();
  await side.setViewportSize({ width: 400, height: 860 });
  await side.goto(`chrome-extension://${extId}/sidepanel.html`);
  const ui = side.frameLocator("#ui");
  await ui.getByRole("button", { name: /Stop/ }).waitFor({ timeout: 15000 }).catch(() => {});
  check("Stop and the voice hint are on screen", await ui.getByRole("button", { name: /Stop/ }).isVisible().catch(() => false) && await ui.getByText(/say .I.m done./i).isVisible().catch(() => false));
  check("a Cancel is on screen while teaching", await ui.getByRole("button", { name: "Cancel" }).isVisible().catch(() => false));
  check("teaching shows its own screen: no Connected sites, no start button", !(await ui.getByText("Connected sites").count()) && !(await ui.getByText("Watch me do a task").count()));
  await ui.getByText(/you (said|clicked)/i).first().waitFor({ timeout: 30000 }).catch(() => {});
  check("the cards show their evidence", await ui.getByText(/you (said|clicked)/i).first().isVisible().catch(() => false));
  const shot = join(process.env.SHOTS ?? data, "teach-recording.png");
  await side.screenshot({ path: shot }); console.log("   screenshot:", shot);

  // The test microphone talks for about 12 s, then says it's done: the recording should end by itself.
  let lv: any = null, stoppedByVoice = false;
  for (let i = 0; i < 60; i++) {
    const st = await call("status");
    if (st.recording) lv = await get(`/sessions/${recId}/live`);
    if (!st.recording) { stoppedByVoice = true; break; }
    await sleep(1000);
  }
  console.log("   live:", JSON.stringify(lv).slice(0, 700));
  check("while recording, each sentence is heard whole", !!lv?.turns?.some((t: any) => /report/i.test(t.text)), JSON.stringify(lv?.turns));
  check("cards appear, each citing words or a click", lv?.cards?.length > 0 && lv.cards.every((c: any) => c.quote || c.events?.length), JSON.stringify(lv?.cards));
  check("saying \"okay, that's it\" ends the recording by itself", stoppedByVoice);

  let saved: any = null;
  for (let i = 0; i < 20; i++) { saved = await get(`/sessions/${recId}`); if (saved.cards?.length) break; await sleep(1000); }
  check("the cards are kept with the recording", saved?.cards?.length > 0, JSON.stringify(saved?.cards));
  check("the end phrase is not a card", !(saved?.cards ?? []).some((c: any) => /that'?s it/i.test(`${c.quote ?? ""} ${c.text}`)), JSON.stringify(saved?.cards));

  // Stop pressed and "I'm done" heard at once: the late one changes nothing and breaks nothing.
  const before = await call("status");
  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  const late = await panel.evaluate((id) => chrome.runtime.sendMessage({ type: "saidDone", sessionId: id }).then(() => "ok", (e: Error) => e.message), recId);
  await sleep(1000);
  const after = await call("status");
  check("a saidDone after Stop is ignored", !after.recording && JSON.stringify(after.last) === JSON.stringify(before.last), `${late}; ${JSON.stringify(after.last)}`);

  // Learning (real Muse Spark): every step it learned says what it came from, and nothing practices by itself.
  let task: any = null;
  for (let i = 0; i < 150; i++) { task = ((await get("/tasks")) as any[]).find((t) => t.sessionId === recId); if (task?.learnStage === "ready" || task?.learnStage === "failed") break; await sleep(2000); }
  const learned = task?.specId ? (await get(`/specs/${task.specId}`)).spec : null;
  const acting = learned ? [...learned.steps, ...Object.values(learned.outcomes as Record<string, any>).filter((o) => o.demonstrated !== false).flatMap((o) => o.steps)].filter((s: any) => ["click", "fill", "press", "goto", "upload", "open_item", "compare"].includes(s.do)) : [];
  check("every learned step that acts cites what it came from", task?.learnStage === "ready" && acting.length > 0 && acting.every((s: any) => s.evidence?.events?.length), JSON.stringify({ stage: task?.learnStage, error: task?.learnError, steps: learned?.steps?.map((s: any) => [s.describe, s.evidence]) }).slice(0, 600));
  check("learning doesn't start a practice by itself", !task?.practice, JSON.stringify(task?.practice));
  // Then the review: the plan on screen (read aloud in a real Chrome), and Remuse waiting for "looks good" or a change.
  await ui.getByRole("button", { name: /Looks right, try it once/ }).waitFor({ timeout: 20000 }).catch(() => {});
  check("after learning, the review shows the plan and waits for you", await ui.getByRole("button", { name: /Looks right, try it once/ }).isVisible().catch(() => false) && await ui.getByText(/what I'll do/i).isVisible().catch(() => false) && await ui.getByRole("button", { name: /Type instead/ }).isVisible().catch(() => false) && await ui.getByRole("button", { name: /Remove task/ }).isVisible().catch(() => false));
  const shot2 = join(process.env.SHOTS ?? data, "teach-review.png");
  await side.screenshot({ path: shot2 }); console.log("   screenshot:", shot2);

  // A cough or a click on its own: nothing is heard, nothing changes.
  const s2 = await post("/sessions", { title: "", startedAt: Date.now() });
  const lv0 = await get(`/sessions/${s2.id}/live`);
  const quiet = await (await fetch(`${API}/sessions/${s2.id}/heard?at=0`, { method: "POST", body: silence(2) })).json();
  const lv1 = await get(`/sessions/${s2.id}/live`);
  check("a silent utterance adds nothing", quiet.text === "" && quiet.control === null && lv1.turns.length === lv0.turns.length && lv1.cards.length === 0, JSON.stringify(quiet));
} catch (e) {
  check("the test ran to the end", false, (e as Error).stack ?? String(e));
} finally {
  await ctx.close().catch(() => {});
  agent.kill(); site.close();
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map(([n]) => n).join(" | ")}` : ""}`);
  process.exit(failed.length ? 1 : 0);
}
