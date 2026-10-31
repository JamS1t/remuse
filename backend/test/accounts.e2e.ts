// End-to-end: Google apps signed in as several accounts. The recorder notes which account each site was used as
// (from the page's account button); a run checks the page uses that account before acting, switches to it if not
// (?authuser=<email>), and stops rather than act as anyone else. Uses a stand-in site whose pages show a Google-style
// account button, its own Agent, port (3299) and browser profile.
// Run: node test/accounts.e2e.ts
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { normalize } from "../src/understand.ts";

// Its own port and browser profile, so a running Remuse Agent (and its sign-ins) is never touched.
const PORT = process.env.TEST_PORT ?? "3299";
const API = `http://127.0.0.1:${PORT}/api`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: [string, boolean, string][] = [];
const check = (n: string, ok: boolean, d = "") => { results.push([n, ok, d]); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  (${d})` : ""}`); };
const get = async (p: string) => (await fetch(API + p)).json();
const post = async (p: string, b: unknown = {}) => (await fetch(API + p, { method: "POST", body: JSON.stringify(b) })).json();
if (await fetch(`${API}/sessions`).then(() => true, () => false)) { console.error(`Port ${PORT} is busy: another test is running.`); process.exit(1); }

// A stand-in "Sheets": signed in as two accounts in this browser. /u/0/ (or none) is ana; /u/1/ is ben;
// ?authuser=<email> picks by email. On "/locked/" pages authuser is ignored (an account that isn't signed in).
const ACCOUNTS = ["ana@example.com", "ben@example.com"];
const saved: { account: string; value: string }[] = [];
const site = createServer(async (req, res) => {
  const u = new URL(req.url ?? "/", "http://x");
  let b = ""; for await (const c of req) b += c;
  const path = /\/u\/(\d+)\//.exec(u.pathname)?.[1];
  const asked = u.searchParams.get("authuser") ?? "";
  // An account number in the address wins (so a switch has to drop it); then ?authuser=<email>; then the first account.
  const who = path !== undefined ? ACCOUNTS[Number(path)] ?? ACCOUNTS[0] : !u.pathname.includes("/locked/") && ACCOUNTS.includes(asked) ? asked : ACCOUNTS[0];
  if (req.method === "POST") { saved.push({ account: new URLSearchParams(b).get("account") ?? "", value: new URLSearchParams(b).get("cell") ?? "" }); res.writeHead(303, { Location: "/done" }); return res.end(); }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  if (u.pathname === "/done") return res.end("<p>Saved</p>");
  if (u.pathname.startsWith("/yt/")) {
    // Signed in as two Google accounts: authuser=0 is account 111, 1 is account 222, which also manages brand channel
    // 999 (pageid=999). Past the last account, YouTube shows you logged out.
    const n = Number(u.searchParams.get("authuser") ?? 0);
    const id = n === 0 ? "111||" : n === 1 ? (u.searchParams.get("pageid") === "999" ? "999||222" : "222||") : "";
    return res.end(`<!doctype html><title>YouTube Studio</title><script>window.ytcfg = { data_: ${JSON.stringify({ LOGGED_IN: !!id, DATASYNC_ID: id || "Vvisitor||" })}, get(k) { return this.data_[k]; } };</script>
      <h1>Channel content</h1><form method="post" action="/save"><input type="hidden" name="account" value="${id}"><label>Cell <input name="cell"></label><button>Save</button></form>`);
  }
  const button = u.pathname.includes("/plain/") ? "" : `<a href="#" aria-label="Google Account: ${who.split("@")[0]} (${who})">${who[0].toUpperCase()}</a>`;
  res.end(`<!doctype html><title>Budget</title><header>${button}</header><h1>Budget sheet</h1>
    <form method="post" action="/save"><input type="hidden" name="account" value="${who}"><label>Cell <input name="cell"></label><button>Save</button></form>`);
}).listen(0);
const SITE = `http://127.0.0.1:${(site.address() as any).port}`;
const HOST = new URL(SITE).host;

// 1. What the recorder saw becomes the task's accounts (here: the demo was done as ben, on /u/1/ in their Chrome).
const recorded: any = { inputs: {}, steps: [], outcomes: {} };
normalize(recorded, { id: "x", events: [{ t: 0, kind: "click", url: `${SITE}/u/1/sheet`, account: "BEN@example.com" }], turns: [] });
check("the account each site was used as is kept with the task", recorded.accounts?.[HOST] === "ben@example.com", JSON.stringify(recorded.accounts));

const spec = (path: string) => ({
  title: "Update the budget", goal: "Write this week's total into the budget sheet.", scope: "", scopeTypes: [], inputs: { source: "once", itemName: "update" }, variables: [],
  accounts: { [HOST]: "ben@example.com" },
  // In Remuse's own browser the accounts were signed in the other way round, so the recorded /u/1/ opens as ana.
  steps: [{ id: "s1", do: "goto", url: `${SITE}${path}`, describe: "Open the budget sheet", expect: { urlIncludes: path.split("#")[0] } }],
  rules: [{ if: "otherwise", then: "write" }],
  outcomes: { write: { describe: "Write it", demonstrated: true, steps: [
    { id: "s2", do: "fill", target: { role: "textbox", name: "Cell" }, value: "1,250", describe: "Type the total" },
    { id: "s3", do: "click", target: { role: "button", name: "Save" }, describe: "Save", expect: { textIncludes: "Saved" } },
  ] } },
});
const code = `({ extract: {}, compute: {}, decide: () => ({ outcome: "write", rule: 0 }) })`;

const data = mkdtempSync(join(tmpdir(), "remuse-accounts-"));
const agent = spawn(process.execPath, ["--env-file-if-exists=../.env", "src/server.ts"], {
  cwd: resolve(import.meta.dirname, ".."), stdio: process.env.SHOW_AGENT ? "inherit" : "ignore",
  env: { ...process.env, DATA_DIR: data, PORT, BROWSER_PROFILE: join(data, "browser"), REMUSE_ACCOUNT_HOSTS: "^127\\.0\\.0\\.1(:\\d+)?$", HEADLESS: "1", SHOWRUN_NO_NOTIFY: "1", OPEN_MODEL_KEY: "", BASETEN_API_KEY: "" },
});
try {
  for (let i = 0; i < 40 && !(await fetch(`${API}/sessions`).then((r) => r.ok, () => false)); i++) await sleep(250);
  const db = new DatabaseSync(join(data, "showrun.db"));
  const add = async (path: string) => {
    const s = await post("/sessions", { title: "Update the budget", startedAt: Date.now() });
    return Number(db.prepare("INSERT INTO specs (session_id, version, note, json, code, tests, created_at) VALUES (?, 1, 'test', ?, ?, '[]', ?)").run(s.id, JSON.stringify(spec(path)), code, Date.now()).lastInsertRowid);
  };
  const run = async (specId: number) => {
    const r = await post(`/specs/${specId}/runs`, { autoApprove: true });
    let x: any;
    for (let i = 0; i < 90; i++) { x = await get(`/runs/${r.id}`); if (["done", "failed", "stopped"].includes(x.status)) break; await sleep(1000); }
    return x;
  };

  // 2. The page opens as the wrong account: it switches to the right one, then acts.
  let r = await run(await add("/u/0/sheet?gid=5#tab"));
  const log = r.items[0].log.map((l: any) => l.msg);
  check("it notices the page is using a different account than in your demo", log.some((m: string) => /using ana@example\.com, but you did this as ben@example\.com/.test(m)), log.join(" / "));
  check("it switches to your account, then acts as it", r.items[0].status === "done" && saved.length === 1 && saved[0].account === "ben@example.com", JSON.stringify(saved));
  check("and it says so", log.some((m: string) => m === "Now using ben@example.com."));
  check("the switch drops your Chrome's account number but keeps the rest of the address (and its check still passes)", log.some((m: string) => /^✓ Open the budget sheet/.test(m)), log.find((m: string) => /Open the budget sheet/.test(m)));

  // 3. It can't switch (that account isn't signed in here): it stops, and nothing is saved.
  r = await run(await add("/locked/sheet"));
  check("if it can't switch, it stops instead of acting as someone else", r.items[0].status === "failed" && saved.length === 1, `${r.items[0].status}, ${saved.length} saved`);
  check("…and says which account to sign in", /signed in as ana@example\.com, not ben@example\.com.*Sign in ben@example\.com/.test(r.items[0].log.map((l: any) => l.msg).join(" ")), r.items[0].log.at(-1)?.msg);

  // 4. A page that shows no account (not a Google page) isn't held up.
  r = await run(await add("/plain/sheet"));
  check("a page that shows no account isn't held up", r.items[0].status === "done" && saved.length === 2, `${r.items[0].status}, ${saved.length} saved`);

  // 5. YouTube: no account button, but YouTube's own config says who is logged in. The demo was on a brand channel
  // (999) managed by the second account; this browser opens as the first. It finds the channel and acts as it.
  const ytTask = async (want: string) => {
    const s = await post("/sessions", { title: "Post on my channel", startedAt: Date.now() });
    const sp = { ...spec("/yt/studio"), title: "Post on my channel", accounts: { [HOST]: want } };
    return Number(db.prepare("INSERT INTO specs (session_id, version, note, json, code, tests, created_at) VALUES (?, 1, 'test', ?, ?, '[]', ?)").run(s.id, JSON.stringify(sp), code, Date.now()).lastInsertRowid);
  };
  r = await run(await ytTask("yt:999||222"));
  const ylog = r.items[0].log.map((l: any) => l.msg);
  check("on YouTube it notices it's on another account or channel than in your demo", ylog.some((m: string) => /YouTube page is signed in as another account or channel/.test(m)), ylog.join(" / "));
  check("…finds your brand channel under the right account, and acts as it", r.items[0].status === "done" && saved.at(-1)?.account === "999||222" && ylog.includes("Now on your channel from the demo."), JSON.stringify(saved.at(-1)));
  const before = saved.length;
  r = await run(await ytTask("yt:777||333"));
  check("a channel no account here owns: it stops, and nothing is posted", r.items[0].status === "failed" && saved.length === before && /isn't signed in to Remuse's browser/.test(r.items[0].log.at(-1)?.msg ?? ""), r.items[0].log.at(-1)?.msg);
  const yrec: any = { inputs: {}, steps: [], outcomes: {} };
  normalize(yrec, { id: "y", events: [{ t: 0, kind: "click", url: "https://studio.youtube.com/channel/UCabcDEF/videos", account: "yt:999||222" }], turns: [] });
  check("a YouTube identity is kept exactly (IDs are case-sensitive)", yrec.accounts?.["studio.youtube.com"] === "yt:999||222", JSON.stringify(yrec.accounts));

  // 6. A site used as two accounts in the demo: each step keeps its own; where a step's isn't known, the page must at
  // least be on one of the demo's accounts.
  const mixed: any = { inputs: {}, steps: [{ id: "a", do: "goto", fromEvent: 0 }, { id: "b", do: "goto", fromEvent: 1 }], outcomes: {} };
  normalize(mixed, { id: "m", events: [{ t: 0, kind: "page", url: `${SITE}/sheet`, account: "ana@example.com" }, { t: 1, kind: "page", url: `${SITE}/sheet`, account: "ben@example.com" }], turns: [] });
  check("a site used as two accounts keeps both, and each step its own", !mixed.accounts && mixed.accountSets?.[HOST]?.length === 2 && mixed.steps[0].account === "ana@example.com" && mixed.steps[1].account === "ben@example.com", JSON.stringify({ sets: mixed.accountSets, steps: mixed.steps.map((x: any) => x.account) }));
  const setTask = async (set: string[]) => {
    const s = await post("/sessions", { title: "Copy between accounts", startedAt: Date.now() });
    const sp = { ...spec("/sheet"), title: "Copy between accounts", accounts: undefined, accountSets: { [HOST]: set } };
    return Number(db.prepare("INSERT INTO specs (session_id, version, note, json, code, tests, created_at) VALUES (?, 1, 'test', ?, ?, '[]', ?)").run(s.id, JSON.stringify(sp), code, Date.now()).lastInsertRowid);
  };
  const n0 = saved.length;
  r = await run(await setTask(["ben@example.com", "carl@example.com"]));
  check("…and a page on an account outside that set is refused", r.items[0].status === "failed" && saved.length === n0 && /isn't one of the accounts from your demo/.test(r.items[0].log.at(-1)?.msg ?? ""), r.items[0].log.at(-1)?.msg);
  r = await run(await setTask(["ana@example.com", "ben@example.com"]));
  check("…while one inside it goes ahead", r.items[0].status === "done" && saved.length === n0 + 1, r.items[0].status);

  // 7. The task page can show which account each site is used as.
  const all = await get("/tasks");
  const t = all.find((x: any) => x.title === "Update the budget" && x.accounts);
  check("the task lists the account it uses on each site", t?.accounts?.[HOST] === "ben@example.com", JSON.stringify(t?.accounts));
  const y = all.find((x: any) => x.title === "Post on my channel" && x.accounts);
  check("…and a YouTube channel as what it is", /brand channel/.test(y?.accounts?.[HOST] ?? ""), JSON.stringify(y?.accounts));
  db.close();
} finally {
  agent.kill(); site.close();
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map(([n]) => n).join(" | ")}` : ""}`);
}
