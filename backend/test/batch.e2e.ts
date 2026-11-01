// End-to-end: files dropped into a watched folder together become one run, one item per file. Each is prepared and
// proven (attached), and every irreversible "Turn in" waits for one OK at the end: "N ready for your OK", Approve all.
// Own Agent on port 3293. Run: node test/batch.e2e.ts
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const PORT = "3293";
const API = `http://127.0.0.1:${PORT}/api`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: [string, boolean, string][] = [];
const check = (n: string, ok: boolean, d = "") => { results.push([n, ok, d]); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  (${d})` : ""}`); };
const get = async (p: string) => (await fetch(API + p)).json();
const post = async (p: string, b: unknown = {}) => (await fetch(API + p, { method: "POST", body: JSON.stringify(b) })).json();
if (await fetch(`${API}/sessions`).then(() => true, () => false)) { console.error(`Port ${PORT} is busy.`); process.exit(1); }

// A class: one page per assignment, named after its file for now. Attaching shows the file under "Your work";
// Turn in is recorded here, and can be made to fail.
const turnedIn: string[] = [];
const confirmed: string[] = [];
let renameTurnIn = false; // the page renames its Turn in button while items wait for the OK
const broken = new Set<string>();
const page = (body: string) => `<!doctype html><meta charset="utf-8"><title>Class</title><body style="font:16px sans-serif;padding:24px">${body}</body>`;
const site = createServer((req, res) => {
  const u = new URL(req.url!, "http://x");
  if (u.pathname === "/confirm") { confirmed.push(u.searchParams.get("f")!); res.writeHead(200); return res.end("ok"); }
  if (u.pathname === "/state") { res.writeHead(200); return res.end(renameTurnIn ? "renamed" : ""); }
  if (u.pathname === "/turnin") { const n = u.searchParams.get("f")!; res.writeHead(200); if (broken.has(n)) return res.end("no"); turnedIn.push(n); return res.end("ok"); }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  // Assignments by their real titles; the file names don't match them word for word. Lab Report 10 is in two sections.
  if (u.pathname === "/class") return res.end(page(`<h1>Class</h1>${[5, 6, 7, 8, 9].map((n) => `<p><a href="/a?f=Lab${n}.pdf">Lab Report ${n}</a></p>`).join("")}
    <p><a href="/a?f=Lab10A">Lab Report 10 (Section A)</a></p><p><a href="/a?f=Lab10B">Lab Report 10 (Section B)</a></p>`));
  const f = u.searchParams.get("f") ?? "";
  // Two irreversible steps on one page (Turn in, then Send confirmation); the Turn in button can be renamed live.
  if (u.pathname === "/a2") return res.end(page(`<h1>Assignment ${f}</h1><h2>Your work</h2><div id="att"></div>
    <input type="file" id="up" onchange="setTimeout(() => att.textContent = this.files[0].name, 300)">
    <button id="ti" onclick="fetch('/turnin?f=${f}').then(() => out.textContent = 'Turned in')">Turn in</button>
    <button onclick="fetch('/confirm?f=${f}').then(() => out2.textContent = 'Confirmation sent')">Send confirmation</button><p id="out"></p><p id="out2"></p>
    <script>setInterval(() => fetch('/state').then((r) => r.text()).then((t) => { if (t === 'renamed') ti.textContent = 'Hand in work'; }), 300)</script>`));
  return res.end(page(`<h1>Assignment ${f}</h1><h2>Your work</h2><div id="att"></div>
    <input type="file" id="up" onchange="setTimeout(() => att.textContent = this.files[0].name, 300)">
    <button onclick="fetch('/turnin?f=${f}').then((r) => r.text()).then((t) => out.textContent = t === 'ok' ? 'Turned in' : 'Something went wrong')">Turn in</button><p id="out"></p>`));
}).listen(0);
const SITE = `http://127.0.0.1:${(site.address() as any).port}`;
const data = mkdtempSync(join(tmpdir(), "remuse-batch-"));
const drop = join(data, "Ready");
mkdirSync(drop);
const agent = spawn(process.execPath, ["--env-file-if-exists=../.env", "src/server.ts"], {
  cwd: resolve(import.meta.dirname, ".."), env: { ...process.env, PORT, DATA_DIR: data, BROWSER_PROFILE: join(data, "browser"), HEADLESS: "1", SHOWRUN_NO_NOTIFY: "1", OPEN_MODEL_KEY: "", BASETEN_API_KEY: "" }, stdio: process.env.SHOW_AGENT ? "inherit" : "ignore",
});
const pdf = (name: string) => writeFileSync(join(drop, name), "%PDF-1.4\n%remuse test\n");
const runsOf = async (task: string) => (await get(`/runs?task=${task}`)) as any[];
const until = async (f: () => Promise<boolean>, s = 120) => { for (let i = 0; i < s * 2; i++) { if (await f()) return true; await sleep(500); } return false; };
try {
  for (let i = 0; i < 40 && !(await fetch(`${API}/sessions`).then((r) => r.ok, () => false)); i++) await sleep(250);
  await post("/folders", { path: drop });
  const s = await post("/sessions", { title: "Submit labs", startedAt: Date.now() });
  const spec = {
    title: "Submit labs", goal: "Attach each finished lab to its assignment and turn it in", scope: "", scopeTypes: [], inputs: { source: "once", itemName: "lab" }, variables: [],
    steps: [
      { id: "s1", do: "goto", url: `${SITE}/class`, describe: "Open the class" },
      { id: "s2", do: "match", target: { role: "link" }, said: "match the file to the assignment by the lab number in its name", describe: "Open the assignment for this file" },
      { id: "s3", do: "upload", file: { folder: "Ready", pick: "next" }, describe: "Attach the file" },
    ],
    rules: [{ if: "otherwise", then: "submit" }],
    outcomes: { submit: { describe: "Turn it in", demonstrated: true, steps: [{ id: "o1", do: "click", target: { role: "button", name: "Turn in" }, describe: "Turn it in", expect: { textIncludes: "Turned in" } }] } },
  };
  const db = new DatabaseSync(join(data, "showrun.db"));
  const specId = Number(db.prepare("INSERT INTO specs (session_id, version, note, json, code, tests, created_at) VALUES (?, 1, 'test', ?, ?, '[]', ?)")
    .run(s.id, JSON.stringify(spec), `({ extract: {}, compute: {}, decide: () => ({ outcome: "submit", rule: 0 }) })`, Date.now()).lastInsertRowid);
  db.close();
  await post("/schedules", { specId, watchFolder: "Ready" });
  await sleep(1500);

  // Two files at once: one run, both prepared and proven, nothing turned in until the one OK.
  pdf("Lab5.pdf"); pdf("Lab6.pdf"); pdf("Essay2.pdf");
  let run: any = null;
  await until(async () => { const rs = await runsOf(s.id); run = rs[0] && (await get(`/runs/${rs[0].id}`)); return run?.pending?.kind === "ready" || ["done", "failed", "stopped"].includes(run?.status); });
  const labs = run?.items?.filter((i: any) => i.label !== "Essay2.pdf") ?? [];
  const essay = run?.items?.find((i: any) => i.label === "Essay2.pdf");
  check("files dropped together are one run, one item each", (await runsOf(s.id)).length === 1 && run?.items?.length === 3, `${(await runsOf(s.id)).length} runs; items ${JSON.stringify(run?.items?.map((i: any) => `${i.label}:${i.status}`))}`);
  check("each lab is matched to its assignment by your rule", labs.every((i: any) => i.log.some((l: any) => new RegExp(`^Matched “${i.label.replace(".", "\\.")}” to “Lab Report ${i.label.match(/\d+/)[0]}”`).test(l.msg))), JSON.stringify(labs.map((i: any) => i.log.find((l: any) => /^Matched/.test(l.msg))?.msg)));
  check("a file that fits no assignment asks instead of guessing, and the rest carry on", essay?.status === "failed" && essay.log.some((l: any) => /No assignment fits “Essay2\.pdf”/.test(l.msg)) && labs.length === 2, JSON.stringify(essay?.log?.slice(-2)));
  check("both labs are prepared, each proven attached", labs.length === 2 && labs.every((i: any) => i.status === "ready" && i.log.some((l: any) => /holds|attached/i.test(l.why ?? "") && l.how === "page")), JSON.stringify(labs.map((i: any) => i.log.slice(-2).map((l: any) => `${l.msg} ${l.why ?? ""}`))).slice(0, 500));
  check("nothing is turned in before your OK, and one OK covers both", turnedIn.length === 0 && run?.pending?.kind === "ready" && run.pending.items?.length === 2, `${turnedIn} ${JSON.stringify(run?.pending)}`.slice(0, 300));
  await post(`/runs/${run.id}/answer`, { decision: "approve_all" });
  await until(async () => ["done", "failed", "stopped"].includes((await get(`/runs/${run.id}`)).status), 60);
  run = await get(`/runs/${run.id}`);
  check("Approve all turns both in", [...turnedIn].sort().join() === "Lab5.pdf,Lab6.pdf" && run.items.filter((i: any) => i.label !== "Essay2.pdf").every((i: any) => i.status === "done"), `${turnedIn} ${run.items.map((i: any) => i.status)}`);

  // A file that was already turned in isn't part of the next batch, even when touched again.
  pdf("Lab5.pdf"); pdf("Lab7.pdf");
  await until(async () => (await runsOf(s.id)).length === 2 && (await get(`/runs/${(await runsOf(s.id))[0].id}`)).items?.length > 0);
  const second = await get(`/runs/${(await runsOf(s.id))[0].id}`);
  check("a file already used isn't in the batch", second.items.length === 1 && second.items[0].label === "Lab7.pdf", JSON.stringify(second.items?.map((i: any) => i.label)));
  await post(`/runs/${second.id}/stop`).catch(() => {});
  await until(async () => ["done", "failed", "stopped"].includes((await get(`/runs/${second.id}`)).status), 60);

  // One item's Turn in fails at the OK: the other is still turned in, and the failed one says why.
  broken.add("Lab9.pdf");
  pdf("Lab8.pdf"); pdf("Lab9.pdf");
  let third: any = null;
  await until(async () => { const rs = await runsOf(s.id); third = rs.length === 3 && (await get(`/runs/${rs[0].id}`)); return third?.pending?.kind === "ready"; });
  await post(`/runs/${third.id}/answer`, { decision: "approve_all" });
  await until(async () => ["done", "failed", "stopped"].includes((await get(`/runs/${third.id}`)).status), 60);
  third = await get(`/runs/${third.id}`);
  const nine = third.items.find((i: any) => i.label === "Lab9.pdf");
  check("when one fails at the OK, the others are still done", turnedIn.includes("Lab8.pdf") && third.items.find((i: any) => i.label === "Lab8.pdf")?.status === "done" && nine?.status === "failed" && nine.log.some((l: any) => /Turn it in/.test(l.msg) && l.level === "error"), JSON.stringify(third.items.map((i: any) => [i.label, i.status, i.log.slice(-1)[0]?.msg])).slice(0, 400));

  // A file that fits two assignments (Lab Report 10 in two sections): it asks which, never takes the first.
  pdf("Lab10.pdf");
  let fourth: any = null;
  await until(async () => { const rs = await runsOf(s.id); fourth = rs.length === 4 && (await get(`/runs/${rs[0].id}`)); return ["done", "failed", "stopped"].includes(fourth?.status); });
  const ten = fourth?.items?.[0];
  check("a file that fits two assignments asks which, and turns nothing in", ten?.status === "failed" && ten.log.some((l: any) => /Section A/.test(l.msg) && /Section B/.test(l.msg)) && !turnedIn.some((f) => /Lab10/.test(f)), JSON.stringify(ten?.log?.slice(-2)));

  // Two irreversible steps in one item: the OK for the first doesn't cover the second; it asks again.
  const drop2 = join(data, "Ready2");
  mkdirSync(drop2);
  await post("/folders", { path: drop2 });
  const two = async (title: string, folder: string, outcome: object[]) => {
    const t = await post("/sessions", { title, startedAt: Date.now() });
    const sp = { title, goal: title, scope: "", scopeTypes: [], inputs: { source: "once", itemName: "lab" }, variables: [],
      steps: [{ id: "s1", do: "goto", url: `${SITE}/a2?f={{file_name}}`, describe: "Open the assignment" }, { id: "s2", do: "upload", file: { folder, pick: "next" }, describe: "Attach the file" }],
      rules: [{ if: "otherwise", then: "submit" }], outcomes: { submit: { describe: "Turn it in", demonstrated: true, steps: outcome } } };
    const db = new DatabaseSync(join(data, "showrun.db"));
    const id = Number(db.prepare("INSERT INTO specs (session_id, version, note, json, code, tests, created_at) VALUES (?, 1, 'test', ?, ?, '[]', ?)")
      .run(t.id, JSON.stringify(sp), `({ extract: {}, compute: {}, decide: () => ({ outcome: "submit", rule: 0 }) })`, Date.now()).lastInsertRowid);
    db.close();
    await post("/schedules", { specId: id, watchFolder: folder });
    return t.id;
  };
  const turnIn = { id: "o1", do: "click", target: { role: "button", name: "Turn in" }, describe: "Turn it in", expect: { textIncludes: "Turned in" } };
  const t2 = await two("Submit and confirm", "Ready2", [turnIn, { id: "o2", do: "click", target: { role: "button", name: "Send confirmation" }, describe: "Send the confirmation", expect: { textIncludes: "Confirmation sent" } }]);
  await sleep(1500);
  writeFileSync(join(drop2, "Lab11.pdf"), "%PDF-1.4\n"); writeFileSync(join(drop2, "Lab12.pdf"), "%PDF-1.4\n");
  let r5: any = null;
  await until(async () => { const rs = await runsOf(t2); r5 = rs[0] && (await get(`/runs/${rs[0].id}`)); return r5?.pending?.kind === "ready"; });
  await post(`/runs/${r5.id}/answer`, { decision: "approve_all" });
  let again = false;
  await until(async () => { r5 = await get(`/runs/${r5.id}`); again = r5.pending?.kind === "ready"; return again || ["done", "failed", "stopped"].includes(r5.status); }, 90);
  check("a second irreversible step in the same item asks again; the first OK didn't cover it", again && confirmed.length === 0 && turnedIn.includes("Lab11.pdf"), `again=${again} confirmed=${confirmed} ${JSON.stringify(r5.pending)}`);
  if (again) await post(`/runs/${r5.id}/answer`, { decision: "approve_all" });
  await until(async () => ["done", "failed", "stopped"].includes((await get(`/runs/${r5.id}`)).status), 90);
  check("and the second OK does it", confirmed.sort().join() === "Lab11.pdf,Lab12.pdf", JSON.stringify(confirmed));

  // The Turn in button is renamed while the items wait: at the OK, a button found by looking is shown, never just pressed.
  const drop3 = join(data, "Ready3");
  mkdirSync(drop3);
  await post("/folders", { path: drop3 });
  const t3 = await two("Submit renamed", "Ready3", [turnIn]);
  await sleep(1500);
  writeFileSync(join(drop3, "Lab13.pdf"), "%PDF-1.4\n"); writeFileSync(join(drop3, "Lab14.pdf"), "%PDF-1.4\n");
  let r6: any = null;
  await until(async () => { const rs = await runsOf(t3); r6 = rs[0] && (await get(`/runs/${rs[0].id}`)); return r6?.pending?.kind === "ready"; });
  renameTurnIn = true;
  await sleep(1500);
  const asked: any[] = [];
  await post(`/runs/${r6.id}/answer`, { decision: "approve_all" });
  await until(async () => {
    r6 = await get(`/runs/${r6.id}`);
    if (r6.pending?.kind === "approval") { asked.push(r6.pending); await post(`/runs/${r6.id}/answer`, { decision: "reject" }); }
    return ["done", "failed", "stopped"].includes(r6.status);
  }, 120);
  renameTurnIn = false;
  check("at the OK, a renamed button is shown to you before anything is pressed", !turnedIn.some((x) => /Lab1[34]/.test(x)) && (asked.length > 0 || r6.items.every((i: any) => i.status !== "done")), `asked=${asked.length} turnedIn=${turnedIn} ${r6.items.map((i: any) => i.status)}`);
} catch (e) {
  check("the test ran to the end", false, (e as Error).stack ?? String(e));
} finally {
  agent.kill(); site.close();
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map(([n]) => n).join(" | ")}` : ""}`);
  process.exit(failed.length ? 1 : 0);
}
