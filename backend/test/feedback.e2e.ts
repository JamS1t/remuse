// End-to-end, with Muse Spark: feedback in plain words updates a learned task. Only what was asked changes,
// the person is told what changed in plain sentences, and the rules are rebuilt. Uses its own port (3299).
// Run: node test/feedback.e2e.ts
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Its own port and browser profile, so a running Remuse Agent (and its sign-ins) is never touched.
const PORT = process.env.TEST_PORT ?? "3299";
const API = `http://127.0.0.1:${PORT}/api`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: [string, boolean, string][] = [];
const check = (n: string, ok: boolean, d = "") => { results.push([n, ok, d]); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  (${d})` : ""}`); };
const get = async (p: string) => (await fetch(API + p)).json();
const post = async (p: string, b: unknown = {}) => (await fetch(API + p, { method: "POST", body: JSON.stringify(b) })).json();
if (await fetch(`${API}/sessions`).then(() => true, () => false)) { console.error(`Port ${PORT} is busy: another test is running.`); process.exit(1); }

const data = mkdtempSync(join(tmpdir(), "remuse-feedback-"));
const agent = spawn(process.execPath, ["--env-file-if-exists=../.env", "src/server.ts"], {
  cwd: resolve(import.meta.dirname, ".."), env: { ...process.env, DATA_DIR: data, PORT, BROWSER_PROFILE: join(data, "browser"), HEADLESS: "1", SHOWRUN_NO_NOTIFY: "1", OPEN_MODEL_KEY: "", BASETEN_API_KEY: "" }, stdio: "ignore",
});
try {
  for (let i = 0; i < 40 && !(await fetch(`${API}/sessions`).then((r) => r.ok, () => false)); i++) await sleep(250);
  const s = await post("/sessions", { title: "Video stats", startedAt: Date.now() });
  const spec = {
    title: "Video stats", goal: "Report this video's views and CTR every hour.", scope: "", scopeTypes: [], inputs: { source: "once", itemName: "update" },
    variables: [
      { name: "views", kind: "text", description: "Total views on the Overview tab", demoValue: "1,830" },
      { name: "ctr", kind: "text", description: "Impressions click-through rate on the Reach tab", demoValue: "4.5%" },
    ],
    steps: [
      { id: "s1", do: "goto", url: "https://studio.youtube.com/video/x/analytics/tab-overview", describe: "Open the overview" },
      { id: "s2", do: "extract", vars: ["views"], describe: "Read the views" },
      { id: "s3", do: "click", target: { role: "tab", name: "Reach" }, describe: "Open the Reach tab" },
      { id: "s4", do: "extract", vars: ["ctr"], describe: "Read the CTR" },
    ],
    rules: [{ if: "otherwise", then: "report", said: "report to me every hour" }],
    outcomes: { report: { describe: "Tell me", demonstrated: true, steps: [{ id: "s5", do: "report", message: "Views {{views}}, CTR {{ctr}}", describe: "Tell me" }] } },
  };
  const db = new DatabaseSync(join(data, "showrun.db"));
  const specId = Number(db.prepare("INSERT INTO specs (session_id, version, note, json, code, tests, created_at) VALUES (?, 1, 'test', ?, '', '[]', ?)")
    .run(s.id, JSON.stringify(spec), Date.now()).lastInsertRowid);
  db.close();

  const r = await post(`/specs/${specId}/feedback`, { text: "The update should also say the subscribers I gained, it's on the Audience tab." });
  console.log("   changes:", JSON.stringify(r.changes ?? r));
  check("you're told what changed, in plain sentences", Array.isArray(r.changes) && r.changes.length > 0 && r.changes.every((c: string) => !/[{}]/.test(c)), JSON.stringify(r.changes));
  const next = (await get(`/specs/${r.specId}`)).spec;
  const steps = [...next.steps, ...Object.values(next.outcomes).flatMap((o: any) => o.steps)];
  check("the new thing is added", steps.some((x: any) => /audience/i.test(JSON.stringify(x))) && next.variables.some((v: any) => /subscri/i.test(v.name + v.description)), next.variables.map((v: any) => v.name).join(", "));
  check("the rest is left as it was", ["s1", "s2", "s3", "s4"].every((id) => JSON.stringify(steps.find((x: any) => x.id === id)) === JSON.stringify(spec.steps.find((x) => x.id === id))));
  check("it's a new version, with your words as its note", (await get(`/specs/${r.specId}`)).note?.startsWith("You said:"));
  let t: any;
  for (let i = 0; i < 60; i++) { t = (await get("/tasks")).find((x: any) => x.sessionId === s.id); if (t?.learnStage === "ready" || t?.learnStage === "failed") break; await sleep(2000); }
  check("and its rules are rebuilt", t?.learnStage === "ready" && t?.specId === r.specId, `${t?.learnStage} ${t?.learnError ?? ""}`);
  // Then it tries the changed task once by itself, and finishes without waiting on anyone.
  for (let i = 0; i < 60; i++) { t = (await get("/tasks")).find((x: any) => x.sessionId === s.id); if (t?.practice && !["starting", "running"].includes(t.practice.status)) break; await sleep(2000); }
  check("a practice of the changed task follows by itself and finishes", !!t?.practice?.result && t.practice.status !== "running", JSON.stringify(t?.practice)?.slice(0, 220));
} finally {
  agent.kill();
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map(([n]) => n).join(" | ")}` : ""}`);
}
