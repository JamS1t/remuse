// End-to-end: a list whose items aren't links (forum posts, cards, like Discord) and open when clicked.
// Remuse finds them by role, opens each by clicking, and reads it. Needs port 3200 free.
// Run: node test/clicklist.e2e.ts
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { normalize } from "../src/understand.ts";

const API = "http://127.0.0.1:3200/api";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: [string, boolean, string][] = [];
const check = (n: string, ok: boolean, d = "") => { results.push([n, ok, d]); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  (${d})` : ""}`); };
const get = async (p: string) => (await fetch(API + p)).json();
const post = async (p: string, b: unknown = {}) => (await fetch(API + p, { method: "POST", body: JSON.stringify(b) })).json();
if (await fetch(`${API}/sessions`).then(() => true, () => false)) { console.error("Port 3200 is busy: stop the Remuse Agent first."); process.exit(1); }

// What Remuse learns from a click on one post: siblings by role, not by the deep class-less path.
const spec0: any = { inputs: { itemEvent: 0 }, steps: [], outcomes: {} };
normalize(spec0, { id: "x", events: [{ t: 0, kind: "click", url: "https://forum/x", target: { role: "article", selector: "div > div > div > div > div", label: "Team A" } }], turns: [] });
check("posts you click (not links) are found by their role", spec0.inputs.itemSelector === '[role="article"]', spec0.inputs.itemSelector);

const posts = [["Team Orbit", "a study planner"], ["Team Kalye", "street food maps"], ["Team Bayan", "a barangay helpdesk"]];
const site = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><title>team-search</title><h1>team-search</h1>
    <div><div><div>${posts.map(([t, b]) => `<div><div role="article" data-b="${b}" onclick="document.getElementById('open').innerHTML='<h2>'+this.innerText+'</h2><p>Building: '+this.dataset.b+'</p>'">${t}</div></div>`).join("")}</div></div></div>
    <section id="open"></section>`);
}).listen(0);
const SITE = `http://127.0.0.1:${(site.address() as any).port}`;

const data = mkdtempSync(join(tmpdir(), "remuse-clicklist-"));
const agent = spawn(process.execPath, ["--env-file-if-exists=../.env", "src/server.ts"], {
  cwd: resolve(import.meta.dirname, ".."), env: { ...process.env, DATA_DIR: data, HEADLESS: "1", SHOWRUN_NO_NOTIFY: "1" }, stdio: "ignore",
});
try {
  for (let i = 0; i < 40 && !(await fetch(`${API}/sessions`).then((r) => r.ok, () => false)); i++) await sleep(250);
  const s = await post("/sessions", { title: "Review team posts", startedAt: Date.now() });
  const spec = {
    title: "Review team posts", goal: "Read what each team is building.", scope: "", scopeTypes: [],
    inputs: { source: "list", itemName: "post", listUrl: `${SITE}/forum`, itemSelector: '[role="article"]' },
    variables: [{ name: "building", kind: "text", description: "What the team is building", demoValue: "a study planner" }],
    steps: [
      { id: "s1", do: "open_item", describe: "Open the post" },
      { id: "s2", do: "extract", vars: ["building"], describe: "Read what they're building" },
    ],
    rules: [{ if: "otherwise", then: "done" }],
    outcomes: { done: { describe: "Tell me", demonstrated: true, steps: [{ id: "s3", do: "report", message: "{{building}}", describe: "Tell me" }] } },
  };
  const code = `({ extract: { building: (t) => /Building:\\s*(.+)/.exec(t)?.[1]?.trim() ?? null }, compute: {}, decide: () => ({ outcome: "done", rule: 0 }) })`;
  const db = new DatabaseSync(join(data, "showrun.db"));
  const specId = Number(db.prepare("INSERT INTO specs (session_id, version, note, json, code, tests, created_at) VALUES (?, 1, 'test', ?, ?, '[]', ?)")
    .run(s.id, JSON.stringify(spec), code, Date.now()).lastInsertRowid);
  db.close();
  const r = await post(`/specs/${specId}/runs`, { autoApprove: true });
  let run: any;
  for (let i = 0; i < 60; i++) { run = await get(`/runs/${r.id}`); if (["done", "failed", "stopped"].includes(run.status)) break; await sleep(1000); }
  check("every post in the list becomes an item", run.items.length === 3, `${run.items.length}: ${run.items.map((x: any) => x.label).join(", ")} ${run.error ?? ""}`);
  const reports = run.items.map((x: any) => x.report);
  check("each is opened by clicking it and read", JSON.stringify(reports) === JSON.stringify(["a study planner", "street food maps", "a barangay helpdesk"]), JSON.stringify(reports));

  // Plan first, then the list reorders before Go: posts are opened by position, so moved ones are left alone.
  const p = await post(`/specs/${specId}/runs`, { plan: true, redo: true });
  let pr: any;
  for (let i = 0; i < 60; i++) { pr = await get(`/runs/${p.id}`); if (pr.pending?.kind === "plan" || ["done", "failed", "stopped"].includes(pr.status)) break; await sleep(1000); }
  check("posts opened by clicking can be planned too", pr.pending?.kind === "plan" && pr.pending.counts.done === 3, JSON.stringify(pr.pending?.counts));
  posts.reverse();
  await post(`/runs/${p.id}/answer`, { decision: "approve" });
  for (let i = 0; i < 60; i++) { pr = await get(`/runs/${p.id}`); if (["done", "failed", "stopped"].includes(pr.status)) break; await sleep(1000); }
  const st = pr.items.map((x: any) => `${x.label}: ${x.status}`).join(", ");
  check("after the list moved, only the post still in its place is done; the others are left alone", pr.items[0].status === "skipped" && pr.items[1].status === "done" && pr.items[2].status === "skipped" && /list moved/.test(pr.items[0].log.at(-1).msg), st);
} finally {
  agent.kill(); site.close();
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map(([n]) => n).join(" | ")}` : ""}`);
}
