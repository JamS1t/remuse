// End-to-end, hands-free: after a task is learned the sidebar keeps listening. The person just talks and
// pauses (no buttons); Remuse hears it, works out it's a correction, and changes the task. Also checks how
// other things people say get sorted. Goes through the real sidebar and its message bridge.
// Needs port 3200 free.
// Run: node test/converse.e2e.ts <voice.wav>   (a correction, then silence)
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";
import { sortSaid } from "../src/understand.ts";

const API = "http://127.0.0.1:3200/api";
const ext = resolve(import.meta.dirname, "../../extension");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: [string, boolean, string][] = [];
const check = (n: string, ok: boolean, d = "") => { results.push([n, ok, d]); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  (${d})` : ""}`); };
const get = async (p: string) => (await fetch(API + p)).json();
const post = async (p: string, b: unknown = {}) => (await fetch(API + p, { method: "POST", body: JSON.stringify(b) })).json();
if (!process.env.SORT_ONLY && await fetch(`${API}/sessions`).then(() => true, () => false)) { console.error("Port 3200 is busy: stop the Remuse Agent first."); process.exit(1); }

const spec = {
  title: "Video stats", goal: "Report this video's views and CTR every hour.", scope: "", scopeTypes: [], inputs: { source: "once", itemName: "update" },
  variables: [{ name: "views", kind: "text", description: "Total views", demoValue: "1,830" }, { name: "ctr", kind: "text", description: "Click-through rate", demoValue: "4.5%" }],
  steps: [
    { id: "s1", do: "goto", url: "https://studio.youtube.com/video/x/analytics/tab-overview", describe: "Open the overview" },
    { id: "s2", do: "extract", vars: ["views"], describe: "Read the views" },
    { id: "s3", do: "click", target: { role: "tab", name: "Reach" }, describe: "Open the Reach tab" },
    { id: "s4", do: "extract", vars: ["ctr"], describe: "Read the CTR" },
  ],
  rules: [{ if: "otherwise", then: "report" }],
  outcomes: { report: { describe: "Tell me", demonstrated: true, steps: [{ id: "s5", do: "report", message: "Views {{views}}, CTR {{ctr}}", describe: "Tell me" }] } },
};

// How things people say are sorted (Muse Spark, text only).
for (const [said, want] of process.env.SKIP_SORT ? [] : [["looks good, that's exactly it", "approve"], ["do this every weekday at 9 in the morning", "schedule"], ["hey, can you pass me the water?", "none"], ["wait, let me show you again", "teach"], ["go ahead and try it now", "run"]] as const) {
  const r = await sortSaid(spec as any, said);
  check(`"${said}" is taken as ${want}`, r.intent === want, r.intent + (r.schedule ? ` ${JSON.stringify(r.schedule)}` : ""));
}
// With a question open (the review asks one at a time), an answer is an answer, and "looks good" is still approval.
if (!process.env.SKIP_SORT) {
  const q = "Should I do this for every video, or only the newest one?";
  const a = await sortSaid(spec as any, "yes, every video", q);
  check(`with a question open, "yes, every video" is an answer`, a.intent === "answer", a.intent);
  const b = await sortSaid(spec as any, "looks good, that's it", q);
  check(`with a question open, "looks good" is still approve`, b.intent === "approve", b.intent);
  for (const [said, want] of [["no, revert that and remove the task, go back to the dashboard", "discard"], ["never mind, delete this one", "discard"], ["okay stop listening for now", "stop"], ["thanks, that's all for now", "stop"]] as const) {
    const r = await sortSaid(spec as any, said);
    check(`"${said}" is taken as ${want}`, r.intent === want, r.intent);
  }
}
if (process.env.SORT_ONLY) { const failed = results.filter(([, ok]) => !ok); console.log(`\n${results.length - failed.length}/${results.length} passed`); process.exit(failed.length ? 1 : 0); }

const data = mkdtempSync(join(tmpdir(), "remuse-converse-"));
const agent = spawn(process.execPath, ["--env-file-if-exists=../.env", "src/server.ts"], {
  cwd: resolve(import.meta.dirname, ".."), env: { ...process.env, DATA_DIR: data, HEADLESS: "1", SHOWRUN_NO_NOTIFY: "1", OPEN_MODEL_KEY: "", BASETEN_API_KEY: "" }, stdio: process.env.SHOW_AGENT ? "inherit" : "ignore",
});
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "remuse-profile-")), {
  channel: "chromium", headless: true, viewport: { width: 420, height: 900 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${resolve(process.argv[2] ?? "")}%noloop`],
});
try {
  for (let i = 0; i < 40 && !(await fetch(`${API}/sessions`).then((r) => r.ok, () => false)); i++) await sleep(250);
  // A task that was just learned, as after a recording.
  const s = await post("/sessions", { title: "Video stats", startedAt: Date.now() - 60_000 });
  const db = new DatabaseSync(join(data, "showrun.db"));
  db.prepare("INSERT INTO specs (session_id, version, note, json, code, tests, created_at) VALUES (?, 1, 'test', ?, ?, '[]', ?)")
    .run(s.id, JSON.stringify(spec), `({ extract: {}, compute: {}, decide: () => ({ outcome: "report", rule: 0 }) })`, Date.now());
  db.prepare("UPDATE sessions SET ended_at = ?, learn_stage = 'ready' WHERE id = ?").run(Date.now(), s.id);
  db.close();

  // The real sidebar: it starts listening by itself. The test microphone then says a correction and goes quiet.
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${new URL(sw.url()).host}/sidepanel.html`);
  const frame = panel.frameLocator("#ui");
  await frame.getByText("Listening. Just talk").waitFor({ timeout: 20_000 }).then(() => check("the sidebar starts listening by itself", true), () => check("the sidebar starts listening by itself", false));

  let heard: any = null;
  for (let i = 0; i < 40; i++) { heard = await get(`/sessions/${s.id}/say`); if (heard && heard.intent !== "thinking") break; await sleep(1500); }
  console.log("   heard:", JSON.stringify(heard));
  check("what you said is heard after you pause, no button", !!heard?.text && /subscriber/i.test(heard.text), heard?.text);
  check("it's understood as a correction and the task changes", heard?.intent === "change" && heard.changes?.length > 0, JSON.stringify(heard?.changes));
  const latest = (await get("/tasks")).find((t: any) => t.sessionId === s.id);
  const next = (await get(`/specs/${latest.specId}`)).spec;
  check("the task now reads the subscribers too", next.variables.some((v: any) => /subscri/i.test(v.name + v.description)), next.variables.map((v: any) => v.name).join(", "));
  await frame.getByText("What I changed").or(frame.getByText(/subscriber/i).first()).waitFor({ timeout: 15_000 })
    .then(() => check("and the sidebar shows what changed", true), () => check("and the sidebar shows what changed", false));
} finally {
  await ctx.close().catch(() => {});
  agent.kill();
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map(([n]) => n).join(" | ")}` : ""}`);
}
