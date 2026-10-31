// End-to-end: a list task remembers what it already handled, so the next run (by hand or on a schedule) only
// does what's new: each email once, saved as each one finishes, never again unless you ask ("Do them again",
// "Start fresh"). An email you said no to stays settled. And a task that posts files can run by itself the
// moment a new file lands in its folder. Uses its own Agent, data folder, stand-in sites. Uses its own port (3299).
// Run: node test/handled.e2e.ts
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
const post = async (p: string, b: unknown = {}) => { const r = await fetch(API + p, { method: "POST", body: JSON.stringify(b) }); return { status: r.status, ...(await r.json()) }; };
if (await fetch(`${API}/sessions`).then(() => true, () => false)) { console.error(`Port ${PORT} is busy: another test is running.`); process.exit(1); }

// An inbox that grows, and a "create post" page.
const mails = [1, 2, 3].map((id) => ({ id, subject: `Request ${id}` }));
const replies: string[] = [];
const drafts: string[] = [];
let broken = false; // the compose page loses its Save button
const site = createServer(async (req, res) => {
  let b = ""; for await (const c of req) b += c;
  if (req.method === "POST" && req.url === "/send") { replies.push(new URLSearchParams(b).get("reply") ?? ""); res.writeHead(303, { Location: "/sent" }); return res.end(); }
  if (req.method === "POST" && req.url === "/draft") { drafts.push(JSON.parse(b).file); res.writeHead(200); return res.end("ok"); }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  if (req.url === "/inbox") return res.end(`<!doctype html><title>Inbox</title>${mails.map((m) => `<p><a class="mail" href="/mail?id=${m.id}">${m.subject}</a></p>`).join("")}`);
  if (req.url === "/sent") return res.end("<p>Reply sent</p>");
  if (req.url === "/compose") return res.end(`<!doctype html><title>Create post</title><input type="file" id="f" aria-label="Select from computer">
    <button style="${broken ? "display:none" : ""}" onclick="fetch('/draft',{method:'POST',body:JSON.stringify({file:document.getElementById('f').files[0]?.name??''})}).then(()=>document.body.insertAdjacentHTML('beforeend','<p>Draft saved</p>'))">Save draft</button>`);
  const m = mails.find((x) => req.url === `/mail?id=${x.id}`);
  res.end(m ? `<!doctype html><title>${m.subject}</title><h1>${m.subject}</h1><p>Order: 100${m.id}</p><form method="post" action="/send"><label>Reply <textarea name="reply"></textarea></label><button>Send reply</button></form>` : "<p>Not found</p>");
}).listen(0);
const SITE = `http://127.0.0.1:${(site.address() as any).port}`;

const inboxSpec = {
  title: "Answer requests", goal: "Reply to every request.", scope: "", scopeTypes: [],
  inputs: { source: "list", itemName: "email", listUrl: `${SITE}/inbox`, itemSelector: "a.mail" },
  variables: [{ name: "order", kind: "text", description: "Order", demoValue: "1001" }],
  steps: [{ id: "s1", do: "open_item", describe: "Open the email" }, { id: "s2", do: "extract", vars: ["order"], describe: "Read the order" }],
  rules: [{ if: "otherwise", then: "reply" }],
  outcomes: { reply: { describe: "Reply", demonstrated: true, steps: [
    { id: "s3", do: "fill", target: { role: "textbox", name: "Reply" }, value: "Done {{order}}", describe: "Write the reply" },
    { id: "s4", do: "click", target: { role: "button", name: "Send reply" }, describe: "Send the reply", expect: { textIncludes: "Reply sent" } },
  ] } },
};
const inboxCode = `({ extract: { order: (t) => /Order: (\\d+)/.exec(t)?.[1] ?? null }, compute: {}, decide: () => ({ outcome: "reply", rule: 0 }) })`;

const root = mkdtempSync(join(tmpdir(), "remuse-drop-"));
const drop = join(root, "Drop");
mkdirSync(drop);
const postSpec = {
  title: "Post new clips", goal: "Post each new clip as a draft.", scope: "", scopeTypes: [], inputs: { source: "once", itemName: "clip" }, variables: [],
  steps: [
    { id: "s1", do: "goto", url: `${SITE}/compose`, describe: "Open the create post page" },
    { id: "s2", do: "upload", target: { role: "button", name: "Select from computer" }, file: { folder: "Drop", pick: "next" }, describe: "Choose the next clip" },
  ],
  rules: [{ if: "otherwise", then: "save" }],
  outcomes: { save: { describe: "Save it", demonstrated: true, steps: [{ id: "s3", do: "click", target: { role: "button", name: "Save draft" }, describe: "Save the draft", expect: { textIncludes: "Draft saved" } }] } },
};

const data = mkdtempSync(join(tmpdir(), "remuse-handled-"));
const agent = spawn(process.execPath, ["--env-file-if-exists=../.env", "src/server.ts"], {
  cwd: resolve(import.meta.dirname, ".."), env: { ...process.env, DATA_DIR: data, PORT, BROWSER_PROFILE: join(data, "browser"), HEADLESS: "1", SHOWRUN_NO_NOTIFY: "1", OPEN_MODEL_KEY: "", BASETEN_API_KEY: "" }, stdio: process.env.SHOW_AGENT ? "inherit" : "ignore",
});
const finished = async (id: string, until: (r: any) => boolean = () => false, secs = 90) => {
  let run: any;
  for (let i = 0; i < secs * 2; i++) { run = await get(`/runs/${id}`); if (until(run) || ["done", "failed", "stopped"].includes(run.status)) break; await sleep(500); }
  return run;
};
try {
  for (let i = 0; i < 40 && !(await fetch(`${API}/sessions`).then((r) => r.ok, () => false)); i++) await sleep(250);
  const db = new DatabaseSync(join(data, "showrun.db"));
  const task = async (title: string, spec: object, code: string) => {
    const s = await post("/sessions", { title, startedAt: Date.now() });
    const id = Number(db.prepare("INSERT INTO specs (session_id, version, note, json, code, tests, created_at) VALUES (?, 1, 'test', ?, ?, '[]', ?)").run(s.id, JSON.stringify(spec), code, Date.now()).lastInsertRowid);
    return { sessionId: s.id as string, specId: id };
  };
  const inbox = await task("Answer requests", inboxSpec, inboxCode);
  const run = async (b: object = { autoApprove: true }) => finished((await post(`/specs/${inbox.specId}/runs`, b)).id);
  const handled = async () => (await get("/tasks")).find((t: any) => t.sessionId === inbox.sessionId)?.handled;

  // 1. Each email once.
  let r = await run();
  check("the first run does every email", r.status === "done" && replies.length === 3, `${replies.length} replies`);
  r = await run();
  check("the next run finds nothing new and does nothing", r.status === "done" && r.items.length === 0 && r.alreadyDone === 3 && replies.length === 3, `${r.items.length} items, ${r.alreadyDone} done before, ${replies.length} replies`);
  const row = (await get(`/runs?task=${inbox.sessionId}`)).find((x: any) => x.id === r.id);
  check("Activity can tell it was nothing new", row?.items === 0 && row.alreadyDone === 3);
  mails.push({ id: 4, subject: "Request 4" });
  r = await run();
  check("a new email is the only one done", r.items.length === 1 && r.items[0].label === "Request 4" && JSON.stringify(replies.slice(3)) === JSON.stringify(["Done 1004"]), JSON.stringify(replies.slice(3)));
  check("the task says how many it remembers", (await handled()) === 4, String(await handled()));

  // 2. Saved as each one finishes; one you say no to stays settled.
  mails.push({ id: 5, subject: "Request 5" }, { id: 6, subject: "Request 6" });
  const asking = await post(`/specs/${inbox.specId}/runs`, {});
  let w = await finished(asking.id, (x) => x.pending?.kind === "approval");
  await post(`/runs/${asking.id}/answer`, { decision: "approve" });
  w = await finished(asking.id, (x) => x.pending?.kind === "approval" && x.pending.item === 1);
  check("an email is remembered as soon as it's done, before the run ends", (await handled()) === 5, `${await handled()} remembered while email 6 waits`);
  await post(`/runs/${asking.id}/answer`, { decision: "reject" });
  w = await finished(asking.id);
  r = await run();
  check("an email you said no to isn't asked about again", r.items.length === 0 && r.alreadyDone === 6, `${r.items.length} items, ${r.alreadyDone} done before`);

  // Stopping while it waits on an email isn't "no": that email is still done next time.
  mails.push({ id: 7, subject: "Request 7" });
  const stopping = await post(`/specs/${inbox.specId}/runs`, {});
  await finished(stopping.id, (x) => x.pending?.kind === "approval");
  await post(`/runs/${stopping.id}/stop`);
  await finished(stopping.id);
  r = await run();
  check("an email it was waiting on when you pressed Stop is done next time", r.items.length === 1 && r.items[0].label === "Request 7" && r.items[0].status === "done", r.items.map((i: any) => `${i.label}: ${i.status}`).join(", "));

  // 3. Only when you ask: do them again, or start fresh.
  const sent = replies.length;
  r = await run({ autoApprove: true, redo: true, limit: 2 });
  check("Do them again: it redoes the ones it had done", r.items.length === 2 && replies.length === sent + 2, `${r.items.length} items, ${replies.length - sent} replies`);
  await post(`/sessions/${inbox.sessionId}/forget`);
  check("Start fresh forgets them", (await handled()) === 0, String(await handled()));
  r = await run({ autoApprove: true, limit: 1 });
  check("after starting fresh, the first email is done again", r.items[0]?.label === "Request 1", r.items[0]?.label);

  // Time saved: every email done in a real run, times how long the demo took (2 minutes here).
  db.prepare("UPDATE sessions SET ended_at = started_at + 120000 WHERE id = ?").run(inbox.sessionId);
  const real = await Promise.all((await get(`/runs?task=${inbox.sessionId}`)).filter((x: any) => x.mode !== "practice").map((x: any) => get(`/runs/${x.id}`)));
  // Each email counted once a day, however many times it was done (Do them again, Start fresh).
  const doneN = new Set(real.flatMap((x: any) => x.items.filter((i: any) => i.status === "done").map((i: any) => i.url))).size;
  const timesDone = real.reduce((n: number, x: any) => n + x.items.filter((i: any) => i.status === "done").length, 0);
  const tt = (await get("/tasks")).find((t: any) => t.sessionId === inbox.sessionId);
  check("the task estimates time saved: each email done counted once a day, × how long the demo took", tt.doneCount === doneN && doneN < timesDone && tt.demoMs === 120000 && tt.savedMs === doneN * 120000, `${tt.doneCount} counted (${doneN} different emails, done ${timesDone} times), ${tt.savedMs} ms`);

  // 4. A practice still uses your example, handled or not.
  db.prepare("INSERT INTO events (session_id, t, kind, url, data) VALUES (?, 1, 'click', ?, ?)").run(inbox.sessionId, `${SITE}/inbox`, JSON.stringify({ target: { role: "link", text: "Request 1", href: `${SITE}/mail?id=1` } }));
  db.prepare("UPDATE specs SET json = ? WHERE id = ?").run(JSON.stringify({ ...inboxSpec, inputs: { ...inboxSpec.inputs, itemEvent: 0 } }), inbox.specId);
  const pr = await finished((await post(`/specs/${inbox.specId}/practice`)).id);
  check("a practice uses your example even though it was done", pr.items[0]?.label === "Request 1" && pr.practice?.sameItem, pr.items[0]?.label);
  const after = (await get("/tasks")).find((t: any) => t.sessionId === inbox.sessionId);
  check("a practice doesn't count as time saved", after.doneCount === doneN, `${after.doneCount} vs ${doneN}`);

  // 5. Whenever a new file lands in the folder, it posts that file (each once).
  await post("/folders", { path: drop });
  const poster = await task("Post new clips", postSpec, `({ extract: {}, compute: {}, decide: () => ({ outcome: "save", rule: 0 }) })`);
  const bad = await post("/schedules", { specId: inbox.specId, watchFolder: "Drop" });
  check("only a task that posts from that folder can watch it", bad.status === 400, bad.error);
  writeFileSync(join(drop, "old.png"), Buffer.from("89504e470d0a1a0a", "hex"));
  await sleep(1500);
  await post("/schedules", { specId: poster.specId, watchFolder: "Drop" });
  const sched = (await get("/schedules")).find((x: any) => x.specId === poster.specId);
  check("the schedule says it watches the folder", sched?.watchFolder === "Drop" && sched.everyMinutes === null, JSON.stringify(sched));
  await sleep(1000);
  writeFileSync(join(drop, "clip1.png"), Buffer.from("89504e470d0a1a0a", "hex"));
  for (let i = 0; i < 60 && drafts.length < 1; i++) await sleep(500);
  check("a new file in the folder starts the task by itself", JSON.stringify(drafts) === JSON.stringify(["clip1.png"]), JSON.stringify(drafts));
  for (let i = 0; i < 40 && (await get(`/runs?task=${poster.sessionId}`)).some((x: any) => ["starting", "running"].includes(x.status)); i++) await sleep(500);
  writeFileSync(join(drop, "clip2.png"), Buffer.from("89504e470d0a1a0a", "hex"));
  for (let i = 0; i < 60 && drafts.length < 2; i++) await sleep(500);
  check("the next file posts the next one, never the first again", JSON.stringify(drafts) === JSON.stringify(["clip1.png", "clip2.png"]), JSON.stringify(drafts));
  for (let i = 0; i < 40 && (await get(`/runs?task=${poster.sessionId}`)).some((x: any) => ["starting", "running"].includes(x.status)); i++) await sleep(500);
  const runs = await get(`/runs?task=${poster.sessionId}`);
  const full = await Promise.all(runs.map((x: any) => get(`/runs/${x.id}`)));
  check("each was started by its schedule", runs.length === 2 && full.every((x: any) => x.status === "done" && x.trigger === "schedule"), full.map((x: any) => `${x.status}/${x.trigger}`).join(","));

  // A batch dropped at once: one run, every file posted in it (one item each), without another file having to arrive.
  for (let i = 0; i < 40 && (await get(`/runs?task=${poster.sessionId}`)).some((x: any) => ["starting", "running"].includes(x.status)); i++) await sleep(500);
  writeFileSync(join(drop, "clip3.png"), Buffer.from("89504e470d0a1a0a", "hex"));
  writeFileSync(join(drop, "clip4.png"), Buffer.from("89504e470d0a1a0a", "hex"));
  writeFileSync(join(drop, "clip3.txt"), "a caption is not a clip");
  for (let i = 0; i < 120 && drafts.length < 4; i++) await sleep(500);
  check("a batch dropped at once is all posted, each once", JSON.stringify(drafts) === JSON.stringify(["clip1.png", "clip2.png", "clip3.png", "clip4.png"]), JSON.stringify(drafts));
  await sleep(15_000);
  check("a caption file alone doesn't start a run", (await get(`/runs?task=${poster.sessionId}`)).length === 3 && drafts.length === 4, `${(await get(`/runs?task=${poster.sessionId}`)).length} runs`);

  check("a file that was already there when you set it up isn't posted", !drafts.includes("old.png"), JSON.stringify(drafts));

  // A post that fails isn't retried over and over; the next new file still goes.
  broken = true;
  writeFileSync(join(drop, "clip9.png"), Buffer.from("89504e470d0a1a0a", "hex"));
  for (let i = 0; i < 60 && (await get(`/runs?task=${poster.sessionId}`)).length < 4; i++) await sleep(500);
  for (let i = 0; i < 60 && (await get(`/runs?task=${poster.sessionId}`)).some((x: any) => ["starting", "running"].includes(x.status)); i++) await sleep(500);
  await sleep(20_000);
  const afterFail = await get(`/runs?task=${poster.sessionId}`);
  check("a post that failed is tried once, not over and over", afterFail.length === 4 && drafts.length === 4, `${afterFail.length} runs, ${drafts.length} drafts`);
  broken = false;

  // Stop the schedule: a new file then does nothing.
  await fetch(`${API}/schedules/${sched.id}`, { method: "DELETE" });
  writeFileSync(join(drop, "clip5.png"), Buffer.from("89504e470d0a1a0a", "hex"));
  await sleep(16_000);
  check("after you stop the schedule, a new file does nothing", drafts.length === 4 && (await get(`/runs?task=${poster.sessionId}`)).length === 4, JSON.stringify(drafts));
  db.close();
} finally {
  agent.kill(); site.close();
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map(([n]) => n).join(" | ")}` : ""}`);
}
