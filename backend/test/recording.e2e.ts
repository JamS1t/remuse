// End-to-end edge cases for recording and learning, in real Chromium with the Remuse extension and a
// fake microphone. Uses its own Agent and a throwaway data folder, so real tasks are never touched.
// Needs port 3200 free (stop the Remuse Agent first). Model calls use ../.env or the Remuse proxy.
// Run: node test/recording.e2e.ts <narration.wav>
//
// A. Tab opened BEFORE the extension reloads (its recorder is cut off), first-time mic permission,
//    an "update me every hour" task: recorded, learned by Muse Spark, run twice (change since last time).
// B. Voice only, no clicks: kept, not thrown away.
// C. Truly empty recording: thrown away.
// D. Stop when nothing is recording: a clear error, nothing breaks.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const API = "http://127.0.0.1:3200/api";
const narration = resolve(process.argv[2] ?? "");
const ext = resolve(import.meta.dirname, "../../extension");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => { results.push([name, ok, detail]); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
const get = async (p: string) => (await fetch(API + p)).json();
const post = async (p: string, b: unknown = {}) => (await fetch(API + p, { method: "POST", body: JSON.stringify(b) })).json();

if (await fetch(`${API}/sessions`).then(() => true, () => false)) { console.error("Port 3200 is busy: stop the Remuse Agent first."); process.exit(1); }

// A stand-in for a video analytics page (made up, no real site).
const stats = { views: 1204, ctr: 5.2, avd: "1:47" };
const site = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  if (req.url === "/bump") { stats.views += 311; stats.ctr = +(stats.ctr + 0.6).toFixed(1); stats.avd = "1:52"; return res.end("ok"); }
  if (req.url?.startsWith("/studio/video/abc/analytics")) return res.end(`<!doctype html><title>Video analytics - Studio</title>
    <h1>Video analytics</h1><p>How to fix a leaky faucet</p>
    <section><h2>Overview</h2><dl><dt>Views</dt><dd>${stats.views.toLocaleString("en-US")}</dd>
    <dt>Impressions click-through rate</dt><dd>${stats.ctr}%</dd><dt>Average view duration</dt><dd>${stats.avd}</dd></dl></section>
    <nav><button>Overview</button> <button>Reach</button> <button>Engagement</button></nav>`);
  return res.end(`<!doctype html><title>Channel content - Studio</title><h1>Channel content</h1>
    <ul><li><a href="/studio/video/abc/analytics">How to fix a leaky faucet</a> · analytics</li><li><a href="#">Old video</a></li></ul>`);
}).listen(0);
const SITE = `http://127.0.0.1:${(site.address() as any).port}`;

const data = mkdtempSync(join(tmpdir(), "remuse-e2e-"));
const agent = spawn(process.execPath, ["--env-file-if-exists=../.env", "src/server.ts"], {
  cwd: resolve(import.meta.dirname, ".."), env: { ...process.env, DATA_DIR: data, HEADLESS: "1", SHOWRUN_NO_NOTIFY: "1", OPEN_MODEL_KEY: "", BASETEN_API_KEY: "" }, stdio: "ignore",
});
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "remuse-profile-")), {
  channel: "chromium", headless: true, viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${narration}`],
});
try {
  for (let i = 0; i < 40 && !(await fetch(`${API}/sessions`).then((r) => r.ok, () => false)); i++) await sleep(250);
  let sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
  const call = (fn: string, ...a: unknown[]) => sw.evaluate(([f, args]) => (globalThis as any).showrun[f as string](...(args as unknown[])), [fn, a] as const);
  const status = () => call("status"); // a worker cannot message itself, so call the function directly

  // ---- A ----
  const tab = await ctx.newPage();
  await tab.goto(`${SITE}/studio`);
  // (Under automation Chrome drops a reloaded extension, so the cut-off-recorder case is covered by
  // start() re-attaching to open tabs and the double-recording guard checked below.)
  const started = await call("start", "YouTube hourly update");
  check("A. first recording asks for the mic in a tab", !!(started as any)?.needsMic || !!(started as any)?.id, JSON.stringify(started));
  let rec = false;
  for (let i = 0; i < 30 && !rec; i++) { await sleep(500); rec = ((await status()) as any)?.recording; }
  check("A. recording starts by itself once the mic is allowed", rec);
  await tab.bringToFront();
  await sleep(1500);
  await tab.getByRole("link", { name: "How to fix a leaky faucet" }).click();
  await tab.waitForURL(/analytics/);
  await sleep(1500);
  await tab.getByRole("button", { name: "Overview" }).click();
  await sleep(22000); // let the narration play out
  const stopped = (await call("stop")) as any;
  check("A. stop keeps the recording and starts learning", stopped?.learning === true && !stopped?.discarded, JSON.stringify(stopped));
  const s = await get(`/sessions/${stopped.id}`);
  const actions = s.events.filter((e: any) => !["start", "tools"].includes(e.kind));
  check("A. clicks in the tab that was already open were recorded", actions.some((e: any) => e.kind === "click"), `${actions.length} actions: ${actions.map((e: any) => e.kind).join(",")}`);
  const overview = actions.filter((e: any) => e.kind === "click" && e.target?.label === "Overview").length;
  check("A. re-attaching the recorder never records a click twice", overview === 1, `Overview clicks recorded: ${overview}`);

  let task: any;
  for (let i = 0; i < 120; i++) {
    task = (await get("/tasks")).find((t: any) => t.sessionId === stopped.id);
    if (task?.learnStage === "ready" || task?.learnStage === "failed") break;
    await sleep(3000);
  }
  check("A. the voice was transcribed", !!(await get(`/sessions/${stopped.id}`)).turns.length, (await get(`/sessions/${stopped.id}`)).transcribe_error ?? "");
  check("A. Remuse learned the task by itself", task?.learnStage === "ready", task?.learnError ?? task?.learnStage);
  if (task?.learnStage === "ready") {
    const row = await get(`/specs/${task.specId}`);
    const spec = row.spec;
    console.log("   title:", task.title, "| source:", spec.inputs.source, "| schedule:", JSON.stringify(spec.schedule), "| vars:", spec.variables.map((v: any) => v.name).join(","));
    check("A. it named the task itself", !!task.title);
    check("A. it runs once by itself (nothing to go through)", spec.inputs.source === "once", spec.inputs.source);
    const steps = [...spec.steps, ...Object.values(spec.outcomes).flatMap((o: any) => o.steps)];
    check("A. it reports back instead of clicking anything", steps.some((x: any) => x.do === "report"), steps.map((x: any) => x.do).join(","));
    check("A. it heard \"every hour\"", spec.schedule?.everyMinutes === 60, JSON.stringify(spec.schedule));
    check("A. the rules built into passing code", row.tests?.every((t: any) => t.ok), `${row.tests?.filter((t: any) => t.ok).length}/${row.tests?.length}`);

    const runOnce = async () => {
      const r = await post(`/specs/${task.specId}/runs`, {});
      let run: any;
      for (let i = 0; i < 80; i++) { run = await get(`/runs/${r.id}`); if (["done", "failed", "stopped"].includes(run.status)) break; await sleep(1500); }
      return run;
    };
    const r1 = await runOnce();
    const rep1 = r1.items[0]?.report ?? "";
    console.log("   run 1:", r1.status, "|", rep1);
    check("A. run 1 gives the update with the three numbers", r1.status === "done" && rep1.includes("1,204") || rep1.includes("1204"), rep1 || r1.error || r1.items[0]?.log.at(-1)?.msg);
    await fetch(`${SITE}/bump`);
    const r2 = await runOnce();
    const rep2 = r2.items[0]?.report ?? "";
    const prev = Object.entries(r2.items[0]?.vars ?? {}).filter(([k]) => k.startsWith("prev_"));
    console.log("   run 2:", r2.status, "|", rep2, "| prev:", JSON.stringify(Object.fromEntries(prev)));
    check("A. run 2 knows last run's numbers", prev.some(([, v]) => v !== null), JSON.stringify(Object.fromEntries(prev)));
    check("A. run 2 reports the new numbers", rep2.includes("1,515") || rep2.includes("1515"), rep2);
  }

  // ---- B ---- voice only: talk, don't click.
  const quiet = await ctx.newPage();
  await quiet.goto(`${SITE}/studio`);
  await call("start", "Voice only");
  for (let i = 0; i < 20 && !((await status()) as any)?.recording; i++) await sleep(300);
  await sleep(6000);
  const b = (await call("stop")) as any;
  check("B. a recording with only your voice is kept", !b?.discarded && b?.learning === true, JSON.stringify(b));

  // ---- C ---- empty: no clicks, no voice (API, like a recording stopped instantly with the mic off).
  const empty = await post("/sessions", { title: "Empty", startedAt: Date.now() });
  const c = await post(`/sessions/${empty.id}/finish`, { endedAt: Date.now() });
  check("C. an empty recording is thrown away", c?.discarded === true, JSON.stringify(c));
  check("C. and it never shows in the lists", !(await get("/sessions")).some((x: any) => x.id === empty.id));

  // ---- D ---- stop with nothing recording.
  const d = await call("stop").then(() => "no error", (e: Error) => e.message);
  check("D. stop with nothing recording says so", /not recording/.test(d), d);
} finally {
  await ctx.close().catch(() => {});
  agent.kill();
  site.close();
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map(([n]) => n).join(" | ")}` : ""}`);
}
