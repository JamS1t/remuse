// End-to-end: a scheduled-style posting task uploads the next file from an allowed folder with its
// caption, waits for approval on "Post" (auto-approved here), saves a downloaded report into another
// allowed folder, never reposts a file, and skips quietly when nothing new is left.
// Uses its own Agent and data folder and a stand-in compose page. Uses its own port (3299).
// Run: node test/files.e2e.ts
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
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

// The person's folders: a posting queue with captions, and a reports folder.
const root = mkdtempSync(join(tmpdir(), "remuse-files-"));
const posts = join(root, "Posts"), reports = join(root, "Reports");
mkdirSync(posts); mkdirSync(reports);
writeFileSync(join(posts, "2026-11-01 0900 launch.png"), Buffer.from("89504e470d0a1a0a", "hex"));
writeFileSync(join(posts, "2026-11-01 0900 launch.txt"), "We're live! #launch");
writeFileSync(join(posts, "2026-11-02 0900 thanks.png"), Buffer.from("89504e470d0a1a0a", "hex"));

// A stand-in "create post" page: file input + caption + Post; and a report to download.
const received: { file: string; caption: string }[] = [];
const site = createServer(async (req, res) => {
  if (req.url === "/post" && req.method === "POST") {
    const chunks: Buffer[] = []; for await (const c of req) chunks.push(c);
    received.push(JSON.parse(Buffer.concat(chunks).toString()));
    res.writeHead(200); return res.end("ok");
  }
  if (req.url === "/report.csv") { res.writeHead(200, { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="weekly report.csv"' }); return res.end("views,ctr\n1639,4.3\n"); }
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`<!doctype html><title>Create post</title><h1>Create post</h1>
    <input type="file" id="f" accept="image/*" aria-label="Select from computer">
    <textarea id="c" aria-label="Write a caption"></textarea>
    <button id="post" onclick="fetch('/post',{method:'POST',body:JSON.stringify({file:document.getElementById('f').files[0]?.name??'',caption:document.getElementById('c').value})}).then(()=>{document.body.insertAdjacentHTML('beforeend','<p>Your post is shared</p>')})">Post</button>
    <p><a href="/report.csv" download>Download weekly report</a></p>`);
}).listen(0);
const SITE = `http://127.0.0.1:${(site.address() as any).port}`;

const data = mkdtempSync(join(tmpdir(), "remuse-data-"));
const agent = spawn(process.execPath, ["--env-file-if-exists=../.env", "src/server.ts"], {
  cwd: resolve(import.meta.dirname, ".."), env: { ...process.env, DATA_DIR: data, PORT, BROWSER_PROFILE: join(data, "browser"), HEADLESS: "1", SHOWRUN_NO_NOTIFY: "1", OPEN_MODEL_KEY: "", BASETEN_API_KEY: "" }, stdio: "ignore",
});
try {
  for (let i = 0; i < 40 && !(await fetch(`${API}/sessions`).then((r) => r.ok, () => false)); i++) await sleep(250);
  await post("/folders", { path: posts }); await post("/folders", { path: reports });
  check("folders can be allowed", (await get("/folders")).length === 2);

  // A learned task, as Muse Spark would write it (hand-written here so the test needs no model).
  const s = await post("/sessions", { title: "Post to my page", startedAt: Date.now() });
  const spec = {
    title: "Post to my page", goal: "Post the next image from Posts with its caption, then save the weekly report.", scope: "", scopeTypes: [],
    inputs: { source: "once", itemName: "post" }, saveDownloads: "Reports", variables: [],
    steps: [
      { id: "s1", do: "goto", url: `${SITE}/compose`, describe: "Open the create post page" },
      { id: "s2", do: "upload", target: { role: "button", name: "Select from computer" }, file: { folder: "Posts", pick: "next" }, describe: "Choose the next image" },
      { id: "s3", do: "fill", target: { role: "textbox", name: "Write a caption" }, value: "{{file_caption}}", describe: "Write the caption" },
    ],
    rules: [{ if: "otherwise", then: "share" }],
    outcomes: { share: { describe: "Share the post", demonstrated: true, steps: [
      { id: "s4", do: "click", target: { role: "button", name: "Post" }, irreversible: true, describe: "Post it", expect: { textIncludes: "Your post is shared" } },
      { id: "s5", do: "click", target: { role: "link", name: "Download weekly report" }, describe: "Download the weekly report" },
    ] } },
  };
  const db = new DatabaseSync(join(data, "showrun.db"));
  const specId = Number(db.prepare("INSERT INTO specs (session_id, version, note, json, code, tests, created_at) VALUES (?, 1, 'test', ?, ?, '[]', ?)")
    .run(s.id, JSON.stringify(spec), `({ extract: {}, compute: {}, decide: () => ({ outcome: "share", rule: 0 }) })`, Date.now()).lastInsertRowid);
  db.close();

  const runOnce = async () => {
    const r = await post(`/specs/${specId}/runs`, { autoApprove: true });
    let run: any;
    for (let i = 0; i < 60; i++) { run = await get(`/runs/${r.id}`); if (["done", "failed", "stopped"].includes(run.status)) break; await sleep(1000); }
    return run;
  };
  const r1 = await runOnce();
  console.log("   run 1:", r1.items[0]?.status, "|", r1.items[0]?.log.map((l: any) => l.msg).join(" / ").slice(0, 300));
  check("run 1 uploads the next file in line", received[0]?.file === "2026-11-01 0900 launch.png", JSON.stringify(received[0]));
  check("with the caption from its .txt twin", received[0]?.caption === "We're live! #launch", received[0]?.caption);
  await sleep(1500);
  check("the download is saved in the Reports folder", existsSync(join(reports, "weekly report.csv")), readdirSync(reports).join(", "));

  const r2 = await runOnce();
  check("run 2 posts the following file, never the same one twice", received[1]?.file === "2026-11-02 0900 thanks.png" && r2.items[0]?.status === "done", JSON.stringify(received[1]));
  check("a second download doesn't overwrite the first", readdirSync(reports).length === 2, readdirSync(reports).join(", "));

  const r3 = await runOnce();
  check("run 3 skips quietly when nothing new is left", r3.items[0]?.status === "skipped" && received.length === 2, `${r3.items[0]?.status}: ${r3.items[0]?.log.at(-1)?.msg}`);
} finally {
  agent.kill(); site.close();
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map(([n]) => n).join(" | ")}` : ""}`);
}
