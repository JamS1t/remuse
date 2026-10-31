// End-to-end: a hidden run hits a sign-in page. Remuse pauses, opens that page in plain Chrome for the
// person, then carries on where it was once they're signed in. Opens a real Chrome window for a few
// seconds. Uses its own port (3299).
// Run: node test/signin.e2e.ts
import { spawn } from "node:child_process";
import { createServer } from "node:http";
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

// A site that sends you to its sign-in page until you've signed in (here: the test flips a switch).
let signedIn = false, exported = 0;
const site = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  if (req.url === "/export") { exported++; return res.end("<title>Report</title><h1>Exported</h1>"); }
  if (req.url === "/app" && !signedIn) return res.end(`<script>location.replace("/login")</script>`);
  if (req.url === "/login") return res.end(signedIn ? `<script>location.replace("/app")</script>` : `<title>Sign in</title><h1>Sign in</h1><input aria-label="Email"><input type="password" aria-label="Password"><button>Sign in</button>`);
  res.end(`<title>Dashboard</title><h1>Dashboard</h1><a href="/export">Export report</a>`);
}).listen(0);
const SITE = `http://127.0.0.1:${(site.address() as any).port}`;

const data = mkdtempSync(join(tmpdir(), "remuse-signin-"));
const agent = spawn(process.execPath, ["--env-file-if-exists=../.env", "src/server.ts"], {
  cwd: resolve(import.meta.dirname, ".."), env: { ...process.env, DATA_DIR: data, PORT, BROWSER_PROFILE: join(data, "browser"), SHOWRUN_NO_NOTIFY: "1", OPEN_MODEL_KEY: "", BASETEN_API_KEY: "" }, stdio: "ignore",
});
try {
  for (let i = 0; i < 40 && !(await fetch(`${API}/sessions`).then((r) => r.ok, () => false)); i++) await sleep(250);
  const s = await post("/sessions", { title: "Export the report", startedAt: Date.now() });
  const spec = {
    title: "Export the report", goal: "Open the dashboard and export the report.", scope: "", scopeTypes: [], inputs: { source: "once", itemName: "report" }, variables: [],
    steps: [
      { id: "s1", do: "goto", url: `${SITE}/app`, describe: "Open the dashboard" },
      { id: "s2", do: "click", target: { role: "link", name: "Export report" }, describe: "Export the report", expect: { textIncludes: "Exported" } },
    ],
    rules: [{ if: "otherwise", then: "done" }], outcomes: { done: { describe: "Done", demonstrated: true, steps: [] } },
  };
  const db = new DatabaseSync(join(data, "showrun.db"));
  const specId = Number(db.prepare("INSERT INTO specs (session_id, version, note, json, code, tests, created_at) VALUES (?, 1, 'test', ?, ?, '[]', ?)")
    .run(s.id, JSON.stringify(spec), `({ extract: {}, compute: {}, decide: () => ({ outcome: "done", rule: 0 }) })`, Date.now()).lastInsertRowid);
  db.close();

  const r = await post(`/specs/${specId}/runs`, { autoApprove: true }); // hidden run
  let run: any;
  for (let i = 0; i < 60; i++) { run = await get(`/runs/${r.id}`); if (run.pending || ["done", "failed", "stopped"].includes(run.status)) break; await sleep(1000); }
  check("a hidden run pauses at the sign-in page instead of failing", run.pending?.kind === "handoff" && /sign in to 127\.0\.0\.1/.test(run.pending.problem), run.pending?.problem ?? `${run.status} ${run.error ?? ""}`);

  signedIn = true; // the person signs in in the window that opened
  await post(`/runs/${r.id}/answer`, { decision: "retry" }); // ...or closes it; pressing Try again does the same
  for (let i = 0; i < 60; i++) { run = await get(`/runs/${r.id}`); if (["done", "failed", "stopped"].includes(run.status)) break; await sleep(1000); }
  const log = run.items[0]?.log.map((l: any) => l.msg) ?? [];
  console.log("   log:", log.join(" / ").slice(0, 500));
  check("then carries on where it was and finishes", run.status === "done" && run.items[0]?.status === "done" && exported === 1, `${run.status} / ${run.items[0]?.status}, exported ${exported}`);
  check("and says what happened", log.some((m: string) => m.startsWith("Signed in to")));
} finally {
  agent.kill(); site.close();
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map(([n]) => n).join(" | ")}` : ""}`);
}
