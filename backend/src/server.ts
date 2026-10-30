// Remuse backend: recordings in, Task Specs and runs out. Serves the review/run UI on the same port.
// Run: npm start   (port 3200, reads MODEL_API_KEY from ../.env)
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { transcribe, calls } from "./meta.ts";
import { understand, type Spec } from "./understand.ts";
import { build } from "./build.ts";
import { Runner, openBrowser, openPlainChrome, type Run } from "./runner.ts";
import type { BrowserContext } from "playwright";
import { GOOGLE, SITE, listLogins, removeLogin, saveLogin } from "./logins.ts";
import { notify } from "./notify.ts";
import { chromeReady, upgrade as chromeUpgrade } from "./chrome.ts";
import { addFolder, chooseFile, filesIn, findFolder, listFolders, pickFolder, removeFolder, usedFor } from "./folders.ts";

// What Muse Spark sees of the allowed folders: names and their newest file names.
const folderHints = () => listFolders().map((f) => { try { return { name: f.name, files: filesIn(f).slice(0, 8).map((x) => x.name) }; } catch { return { name: f.name, files: [] }; } });

const PORT = Number(process.env.PORT ?? 3200);
const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = process.env.DATA_DIR ?? join(HERE, "..", "data");
const PUBLIC = join(HERE, "..", "public");
const MOCK = process.env.MOCK_URL ?? "http://localhost:3100";
mkdirSync(DATA, { recursive: true });
// Vite's dev server (5173) proxies to us during UI work.
const ALLOWED_ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`, "http://localhost:5173", "http://127.0.0.1:5173"]);

// One Agent at a time. A second one would fight the first over the database and the browser profile,
// so it leaves before touching either.
if (await fetch(`http://127.0.0.1:${PORT}/api/sessions`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false)) {
  console.log(`Remuse Agent is already running on port ${PORT}.`);
  process.exit(0);
}

const db = new DatabaseSync(join(DATA, "showrun.db"));
db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, title TEXT, started_at INTEGER NOT NULL, ended_at INTEGER,
    audio_offset_ms INTEGER, transcript TEXT, transcribe_error TEXT
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
    t INTEGER NOT NULL, kind TEXT NOT NULL, url TEXT, data TEXT NOT NULL,
    before_png TEXT, after_png TEXT
  );
  CREATE TABLE IF NOT EXISTS turns (
    session_id TEXT NOT NULL REFERENCES sessions(id), start_ms INTEGER, end_ms INTEGER, text TEXT
  );
  CREATE TABLE IF NOT EXISTS specs (
    id INTEGER PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), version INTEGER NOT NULL,
    note TEXT, json TEXT NOT NULL, code TEXT, tests TEXT, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY, spec_id INTEGER NOT NULL REFERENCES specs(id), json TEXT NOT NULL, updated_at INTEGER NOT NULL
  );
`);

const MAX_BODY = 40 * 1024 * 1024; // Transcribe caps audio at 32 MB

class HttpError extends Error {
  status: number;
  constructor(status: number, msg: string) { super(msg); this.status = status; }
}

async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new HttpError(413, "body too large");
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
const json = async (req: IncomingMessage) => JSON.parse((await body(req)).toString() || "{}");

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".wav": "audio/wav", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff" };
function send(res: ServerResponse, status: number, data: unknown, type = "application/json") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(data) : (data as Buffer));
}
function file(res: ServerResponse, path: string) {
  if (!existsSync(path)) throw new HttpError(404, "no such file");
  send(res, 200, readFileSync(path), TYPES[extname(path)] ?? "application/octet-stream");
}

const sessionDir = (id: string) => join(DATA, "sessions", id);
const runDir = (id: string) => join(DATA, "runs", id);
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

function session(id: string) {
  // ids are UUIDs we minted; checking the row also stops path tricks in file routes
  const s = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as any;
  if (!s) throw new HttpError(404, "no such session");
  return s;
}

function savePng(id: string, name: string, dataUrl?: string): string | null {
  if (!dataUrl) return null;
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!m) throw new HttpError(400, "frames must be PNG data URLs");
  writeFileSync(join(sessionDir(id), name), Buffer.from(m[1], "base64"));
  return name;
}

function full(id: string) {
  const s = session(id);
  const events = (db.prepare("SELECT * FROM events WHERE session_id = ? ORDER BY t, id").all(id) as any[])
    .map((e) => ({ id: e.id, t: e.t, kind: e.kind, url: e.url, ...JSON.parse(e.data), before: e.before_png, after: e.after_png }));
  const turns = db.prepare("SELECT start_ms AS startMs, end_ms AS endMs, text FROM turns WHERE session_id = ? ORDER BY start_ms").all(id);
  const specs = db.prepare("SELECT id, version, note, created_at FROM specs WHERE session_id = ? ORDER BY version DESC").all(id);
  return { ...s, events, turns, specs };
}

const pagesOf = (sessionId: string) => (db.prepare("SELECT url, data FROM events WHERE session_id = ? AND kind = 'page' ORDER BY t").all(sessionId) as any[])
  .map((e) => ({ url: e.url as string, text: JSON.parse(e.data).text as string })).filter((p) => p.text);

function specRow(id: number) {
  const r = db.prepare("SELECT * FROM specs WHERE id = ?").get(id) as any;
  if (!r) throw new HttpError(404, "no such spec");
  return { id: r.id, sessionId: r.session_id, version: r.version, note: r.note, spec: JSON.parse(r.json) as Spec, code: r.code as string | null, tests: r.tests ? JSON.parse(r.tests) : null, createdAt: r.created_at };
}

function saveSpec(sessionId: string, spec: Spec, note: string, code: string | null = null, tests: unknown = null): number {
  const v = ((db.prepare("SELECT MAX(version) AS v FROM specs WHERE session_id = ?").get(sessionId) as any).v ?? 0) + 1;
  const r = db.prepare("INSERT INTO specs (session_id, version, note, json, code, tests, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(sessionId, v, note, JSON.stringify(spec), code, tests ? JSON.stringify(tests) : null, Date.now());
  return Number(r.lastInsertRowid);
}

// A recording with no actions (stopped right away, mic trouble) teaches nothing and only clutters the
// history: it is dropped on Stop, and old ones are cleared when the Agent starts.
const ACTIONS = "kind NOT IN ('start', 'tools')";
// Your voice counts: a recording where you talked it through is kept even with no clicks (more than a
// second of 16 kHz mono audio).
const hasVoice = (id: string) => { const f = join(sessionDir(id), "voice.wav"); return existsSync(f) && statSync(f).size > 44 + 32000; };
const isEmpty = (id: string) =>
  !(db.prepare(`SELECT 1 FROM events WHERE session_id = ? AND ${ACTIONS} LIMIT 1`).get(id)) &&
  !(db.prepare("SELECT 1 FROM specs WHERE session_id = ? LIMIT 1").get(id)) && !hasVoice(id);
function discard(id: string) {
  db.prepare("DELETE FROM events WHERE session_id = ?").run(id);
  db.prepare("DELETE FROM turns WHERE session_id = ?").run(id);
  db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  rmSync(sessionDir(id), { recursive: true, force: true });
}
for (const s of db.prepare("SELECT id FROM sessions WHERE ended_at IS NOT NULL OR started_at < ?").all(Date.now() - 3600_000) as any[]) {
  if (isEmpty(s.id)) discard(s.id);
}

async function transcribeSession(id: string, offsetMs: number) {
  const wavPath = join(sessionDir(id), "voice.wav");
  if (!existsSync(wavPath)) return;
  try {
    const { transcript, turns } = await transcribe(readFileSync(wavPath));
    db.prepare("DELETE FROM turns WHERE session_id = ?").run(id);
    const ins = db.prepare("INSERT INTO turns (session_id, start_ms, end_ms, text) VALUES (?, ?, ?, ?)");
    for (const t of turns) ins.run(id, t.startMs + offsetMs, t.endMs + offsetMs, t.text); // audio clock -> session clock
    db.prepare("UPDATE sessions SET transcript = ?, transcribe_error = NULL WHERE id = ?").run(transcript, id);
  } catch (e) {
    db.prepare("UPDATE sessions SET transcribe_error = ? WHERE id = ?").run((e as Error).message, id);
  }
}

// Learning a recording end to end, with no input from the person: what they said, the Task Spec (which
// also names the task), then the rules as tested code. Each stage is saved so the sidebar can show it.
for (const col of ["learn_stage TEXT", "learn_error TEXT"]) { try { db.exec(`ALTER TABLE sessions ADD COLUMN ${col}`); } catch { /* already there */ } }
const stage = (id: string, s: string, err: string | null = null) => db.prepare("UPDATE sessions SET learn_stage = ?, learn_error = ? WHERE id = ?").run(s, err, id);
// A recording that was mid-learning when the Agent stopped would show "thinking" forever.
db.prepare("UPDATE sessions SET learn_stage = 'failed', learn_error = 'Remuse stopped while learning this. Press Try again.' WHERE learn_stage IN ('listening', 'understanding', 'building')").run();

async function learn(id: string, offsetMs: number) {
  try {
    stage(id, "listening");
    await transcribeSession(id, offsetMs);
    stage(id, "understanding");
    const spec = await understand(full(id), sessionDir(id), folderHints());
    if (spec.title && !session(id).title) db.prepare("UPDATE sessions SET title = ? WHERE id = ?").run(spec.title, id);
    const specId = saveSpec(id, spec, "Learned by Muse Spark from your recording");
    stage(id, "building");
    const r = await build(spec, pagesOf(id), new Date(session(id).started_at).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }));
    db.prepare("UPDATE specs SET code = ?, tests = ? WHERE id = ?").run(r.code, JSON.stringify(r.tests), specId);
    stage(id, "ready");
    notify(`Remuse learned: ${session(id).title ?? spec.goal}`, r.ok ? "Ready to do it again. Open Remuse to run or schedule it." : "Some checks failed. Open Remuse to review it.", `http://127.0.0.1:${PORT}/#/spec/${specId}`);
  } catch (e) {
    stage(id, "failed", (e as Error).message);
    notify("Remuse couldn't learn that task", (e as Error).message, `http://127.0.0.1:${PORT}/#/session/${id}`);
  }
}

// One run at a time: it drives one visible browser.
let active: Runner | null = null;
function saveRun(run: Run) {
  db.prepare("INSERT INTO runs (id, spec_id, json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at")
    .run(run.id, run.specId, JSON.stringify(run), Date.now());
}

// The sign-in window: the same Chrome profile runs use, opened so the person can log in to sites once.
let signIn: BrowserContext | null = null;
async function openSignIn(url: string) {
  if (active && !["done", "failed", "stopped"].includes(active.run.status)) throw new HttpError(409, "wait for the run to finish first");
  if (!signIn) {
    signIn = await openBrowser(false);
    signIn.on("close", () => { signIn = null; });
  }
  const page = signIn.pages()[0] ?? (await signIn.newPage());
  await page.goto(url).catch(() => {});
  await page.bringToFront();
}

// Google sign-in: plain Chrome on Remuse's profile, not driven by anything, so Google sees an ordinary
// browser and lets you sign in. The sign-in stays in the profile that runs use.
async function openGoogleSignIn(site: string, email = "") {
  if (active && !["done", "failed", "stopped"].includes(active.run.status)) throw new HttpError(409, "wait for the run to finish first");
  if (signIn) { await signIn.close().catch(() => {}); signIn = null; }
  // login_hint fills in the account, so Google goes straight to a passkey or "tap Yes on your phone".
  const url = `https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(`https://www.${site}/`)}${email ? `&login_hint=${encodeURIComponent(email)}` : ""}`;
  if (!openPlainChrome(url)) return openSignIn(url); // ponytail: no installed Chrome, fall back to the driven window
}

// A run that was going when the Agent stopped (shutdown, crash) can't resume: mark it stopped.
for (const r of db.prepare("SELECT id, json FROM runs").all() as any[]) {
  const run = JSON.parse(r.json) as Run;
  if (run.status !== "starting" && run.status !== "running") continue;
  Object.assign(run, { status: "stopped", pending: null, endedAt: run.endedAt ?? Date.now(), error: run.error ?? "The Remuse Agent stopped during this run." });
  saveRun(run);
}

// ---- Schedules: the Agent repeats a task by itself, Chrome open or not. ----
db.exec(`CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY, spec_id INTEGER NOT NULL REFERENCES specs(id), time TEXT NOT NULL, days TEXT NOT NULL,
  rows TEXT, run_limit INTEGER, enabled INTEGER NOT NULL DEFAULT 1, last_run TEXT
)`);
// Two kinds: every N minutes ("every hour"), or on chosen days at a time ("weekdays at 9:00").
for (const col of ["every_minutes INTEGER", "last_at INTEGER"]) { try { db.exec(`ALTER TABLE schedules ADD COLUMN ${col}`); } catch { /* already there */ } }
type Schedule = { id: number; specId: number; sessionId: string; time: string; days: string; everyMinutes: number | null; rows: Record<string, string>[] | null; limit: number | null; enabled: boolean; lastRun: string | null; lastAt: number | null };
// sessionId names the task, so a schedule stays attached to it across new spec versions.
const schedules = (): Schedule[] => (db.prepare("SELECT s.*, x.session_id FROM schedules s JOIN specs x ON x.id = s.spec_id ORDER BY s.id").all() as any[]).map((s) => ({
  id: s.id, specId: s.spec_id, sessionId: s.session_id, time: s.time, days: s.days, everyMinutes: s.every_minutes, rows: s.rows ? JSON.parse(s.rows) : null,
  limit: s.run_limit, enabled: !!s.enabled, lastRun: s.last_run, lastAt: s.last_at,
}));
// A schedule follows its task: it always runs the task's newest Task Spec, including versions learned since.
// Only built versions can run: an edited-but-not-rebuilt version must not silence the schedule.
const latestSpec = (specId: number) => (db.prepare("SELECT MAX(id) AS id FROM specs WHERE code IS NOT NULL AND session_id = (SELECT session_id FROM specs WHERE id = ?)").get(specId) as any)?.id ?? specId;
// Manila clock: "HH:MM", ISO weekday 1 (Mon) .. 7 (Sun), and the date.
function manilaNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { time: `${parts.hour}:${parts.minute}`, day: String(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday) + 1), date: today() };
}
setInterval(async () => {
  const now = manilaNow();
  for (const s of schedules()) {
    if (!s.enabled) continue;
    const due = s.everyMinutes ? Date.now() - (s.lastAt ?? 0) >= s.everyMinutes * 60_000
      : s.lastRun !== now.date && s.days.includes(now.day) && s.time <= now.time;
    if (!due) continue;
    if (active && !["done", "failed", "stopped"].includes(active.run.status)) return; // try again next tick
    db.prepare("UPDATE schedules SET last_run = ?, last_at = ? WHERE id = ?").run(now.date, Date.now(), s.id);
    try { await startRun(latestSpec(s.specId), { rows: s.rows ?? undefined, limit: s.limit ?? undefined, scheduled: true }); }
    catch (e) { notify("Remuse couldn't start a scheduled task", (e as Error).message, `http://127.0.0.1:${PORT}/#/spec/${s.specId}`); }
  }
}, 30_000).unref();

async function startRun(specId: number, opts: { limit?: number; autoApprove?: boolean; rows?: Record<string, string>[]; scheduled?: boolean; watch?: boolean }) {
  if (active && !["done", "failed", "stopped"].includes(active.run.status)) throw new HttpError(409, "a run is already going");
  const row = specRow(specId);
  if (!row.code) throw new HttpError(400, "build the rules first");
  // Both use the one Chrome profile, which only one window can hold.
  if (signIn) { await signIn.close().catch(() => {}); signIn = null; }
  const run: Run = { id: randomUUID(), specId, status: "starting", items: [], current: 0, pending: null, autoApprove: !!opts.autoApprove, startedAt: Date.now(), heals: [], learned: [], rows: opts.rows,
    visible: !!opts.watch && !opts.scheduled, trigger: opts.scheduled ? "schedule" : "you" };
  let last = 0;
  let asked = "";
  const link = `http://127.0.0.1:${PORT}/#/run/${run.id}`;
  const runner = new Runner(run, row.spec, row.code, runDir(run.id), (r) => {
    if (Date.now() - last > 300 || ["done", "failed", "stopped"].includes(r.status)) { last = Date.now(); saveRun(r); }
    // Anything waiting on the person becomes a Windows notification, once.
    const p = r.pending;
    const key = p ? `${p.kind}-${p.item}-${p.shot}` : "";
    if (p && key !== asked) {
      const label = r.items[p.item]?.label ?? "";
      if (p.kind === "approval") notify("Remuse needs your OK", `${p.step}: ${label}`, link);
      else if (p.kind === "ask") notify("Remuse has a question", p.question, link);
      else notify("Remuse needs you in the browser", `Stuck on "${p.step}". Sign in or clear the check, then press Try again.`, link);
    }
    asked = key;
  });
  runner.prev = lastValues(row.sessionId);
  runner.taskKey = row.sessionId;
  active = runner;
  saveRun(run);
  runner.start(opts.limit).then(() => {
    saveRun(run);
    if (opts.scheduled) notify(`Remuse finished: ${row.spec.goal}`.slice(0, 120), `${run.items.filter((i) => i.status === "done").length} of ${run.items.length} done${run.error ? `. Problem: ${run.error}` : ""}`, link);
    // What the run learned (new labels after a redesign, answers you gave) becomes the next spec version.
    if (run.heals.length || run.learned.length) {
      const parts = [run.heals.length && `${run.heals.length} element(s) updated after a layout change`, run.learned.length && `learned: ${run.learned.map((l) => `${l.requestType} → ${l.outcome}`).join(", ")}`].filter(Boolean);
      (run as any).newSpecId = saveSpec(row.sessionId, runner.spec, `From run: ${parts.join("; ")}`, row.code, row.tests);
      saveRun(run);
    }
  });
  return run;
}

// Parsed runs, kept while their row is unchanged: the sidebar asks for these every couple of seconds.
const parsed = new Map<string, { at: number; run: Run }>();
function recentRuns(sessionId: string): Run[] {
  const rows = db.prepare(`SELECT r.id, r.updated_at, r.json FROM runs r JOIN specs x ON x.id = r.spec_id WHERE x.session_id = ? ORDER BY r.updated_at DESC LIMIT 10`).all(sessionId) as any[];
  return rows.map((r) => {
    const hit = parsed.get(r.id);
    if (hit && hit.at === r.updated_at) return hit.run;
    const run = JSON.parse(r.json) as Run;
    parsed.set(r.id, { at: r.updated_at, run });
    return run;
  });
}

/** The newest update a "report" step gave for this task, if any. */
function lastReport(sessionId: string): { text: string; at: number; runId: string } | null {
  for (const run of recentRuns(sessionId)) {
    const it = [...run.items].reverse().find((i) => i.report);
    if (it) return { text: it.report!, at: run.endedAt ?? run.startedAt, runId: run.id };
  }
  return null;
}

/** The item variables of this task's most recent finished run, by item label. */
function lastValues(sessionId: string): Record<string, Record<string, unknown>> {
  for (const run of recentRuns(sessionId)) {
    const done = run.items.filter((i) => i.status === "done");
    if (done.length) return Object.fromEntries(done.map((i) => [i.label, Object.fromEntries(Object.entries(i.vars).filter(([k]) => !k.startsWith("prev_")))]));
  }
  return {};
}

function getRun(id: string): Run {
  if (active?.run.id === id) return active.run;
  const r = db.prepare("SELECT json FROM runs WHERE id = ?").get(id) as any;
  if (!r) throw new HttpError(404, "no such run");
  return JSON.parse(r.json);
}

async function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://x");
  const p = url.pathname.split("/").filter(Boolean);
  const m = req.method;

  // UI
  if (m === "GET" && p[0] !== "api") {
    const name = p.length ? p.join("/") : "index.html";
    if (!/^(assets\/)?[\w-][\w.-]*$/.test(name)) throw new HttpError(404, "not found");
    return file(res, join(PUBLIC, name));
  }

  if (m === "GET" && url.pathname === "/api/calls") return send(res, 200, calls.slice(-200));
  // Only the Agent's own pages and the Remuse extension may call the API; any other website is refused,
  // so a page you visit can't read your runs or hand the Agent fake logins.
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin) && !origin.startsWith("chrome-extension://")) throw new HttpError(403, "not allowed from this page");

  if (url.pathname === "/api/logins" && m === "GET") return send(res, 200, listLogins());

  // Folders the person allows: the Windows folder picker adds one; each lists its newest files.
  if (url.pathname === "/api/folders" && m === "GET")
    return send(res, 200, listFolders().map((f) => { try { const files = filesIn(f); return { ...f, count: files.length, latest: files[0] ?? null, ok: true }; } catch { return { ...f, count: 0, latest: null, ok: false }; } }));
  if (url.pathname === "/api/folders/pick" && m === "POST") {
    const path = await pickFolder();
    if (!path) return send(res, 200, { cancelled: true });
    return send(res, 200, addFolder(path));
  }
  if (url.pathname === "/api/folders" && m === "POST") { const b = await json(req); return send(res, 200, addFolder(String(b.path ?? ""), b.name)); }
  if (p[1] === "folders" && p[2] && m === "DELETE") { removeFolder(p[2]); return send(res, 200, { ok: true }); }
  if (url.pathname === "/api/schedules" && m === "GET") return send(res, 200, schedules());
  if (url.pathname === "/api/schedules" && m === "POST") {
    const b = await json(req);
    const specId = Number(b.specId);
    specRow(specId); // 404 if it doesn't exist
    const every = b.everyMinutes ? Math.round(Number(b.everyMinutes)) : null;
    if (every !== null && !(every >= 15 && every <= 1440)) throw new HttpError(400, "repeat between every 15 minutes and once a day");
    if (!every && !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time ?? "")) throw new HttpError(400, "time must be HH:MM");
    const days = String(b.days ?? "1234567").replace(/[^1-7]/g, "");
    if (!days) throw new HttpError(400, "pick at least one day");
    const rows = Array.isArray(b.rows) ? JSON.stringify(b.rows) : null;
    // One schedule per task: saving again replaces it.
    db.prepare("DELETE FROM schedules WHERE spec_id IN (SELECT id FROM specs WHERE session_id = (SELECT session_id FROM specs WHERE id = ?))").run(specId);
    // An interval schedule starts counting now; the first run is one interval away.
    db.prepare("INSERT INTO schedules (spec_id, time, days, rows, run_limit, enabled, every_minutes, last_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)")
      .run(specId, b.time ?? "00:00", days, rows, b.limit ? Number(b.limit) : null, every, every ? Date.now() : null);
    return send(res, 200, schedules());
  }
  if (p[1] === "schedules" && p[2] && m === "DELETE") { db.prepare("DELETE FROM schedules WHERE id = ?").run(Number(p[2])); return send(res, 200, schedules()); }
  // Saved tasks for the sidebar: every recording with its latest Task Spec.
  if (url.pathname === "/api/tasks" && m === "GET")
    return send(res, 200, (db.prepare(`SELECT s.id AS sessionId, s.title, s.started_at AS startedAt, s.ended_at AS endedAt, s.learn_stage AS learnStage, s.learn_error AS learnError,
      x.id AS specId, x.version, x.json, x.tests, x.code IS NOT NULL AS built
      FROM sessions s LEFT JOIN specs x ON x.id = (SELECT MAX(id) FROM specs WHERE session_id = s.id) WHERE EXISTS (SELECT 1 FROM events e WHERE e.session_id = s.id AND e.kind NOT IN ('start', 'tools')) OR EXISTS (SELECT 1 FROM specs y WHERE y.session_id = s.id) OR (s.transcript IS NOT NULL AND s.transcript != '') OR s.learn_stage IS NOT NULL ORDER BY s.started_at DESC`).all() as any[])
      .map(({ json: j, tests: tj, built, ...t }) => {
        const spec = j ? (JSON.parse(j) as Spec) : null;
        const tests = tj ? (JSON.parse(tj) as { ok: boolean }[]) : [];
        return { ...t, title: t.title ?? spec?.title ?? null, built: !!built, goal: spec?.goal ?? null, itemName: spec?.inputs.itemName ?? null,
          source: spec?.inputs.source ?? (spec ? "list" : null), columns: spec?.inputs.columns ?? [],
          // What the "I learned" card shows: the person's own rules, what was guessed, how the checks went.
          rules: spec?.rules.map((r) => ({ if: r.if, then: r.then, said: r.said })) ?? [],
          guessed: spec ? Object.entries(spec.outcomes).filter(([, o]) => !o.demonstrated).map(([k]) => k) : [],
          steps: spec?.steps.length ?? 0, compares: spec?.steps.some((s) => s.do === "compare") ?? false,
          checks: { passed: tests.filter((x) => x.ok).length, total: tests.length },
          askedSchedule: spec?.schedule ?? null, lastReport: lastReport(t.sessionId),
          uploads: spec ? [...spec.steps, ...Object.values(spec.outcomes).flatMap((o) => o.steps)].filter((x) => x.do === "upload").map((x) => ({ folder: x.file?.folder ?? null, pick: x.file?.pick ?? "next" })) : [],
          saveDownloads: spec?.saveDownloads ?? null };
      }));
  if (url.pathname === "/api/logins" && m === "POST") {
    const b = await json(req);
    const site = String(b.site ?? "").toLowerCase();
    if (!SITE.test(site) || !Array.isArray(b.cookies)) throw new HttpError(400, "send {site, cookies}");
    if (GOOGLE.test(site)) { removeLogin(site); return send(res, 200, { site, cookies: 0, skipped: true }); } // never copied, see GOOGLE
    saveLogin(site, b.cookies);
    return send(res, 200, { site, cookies: b.cookies.length });
  }
  if (p[1] === "logins" && p[2] && m === "DELETE") { removeLogin(p[2].toLowerCase()); return send(res, 200, { ok: true }); }

  if (m === "POST" && url.pathname === "/api/browser/google") {
    const site = (url.searchParams.get("site") ?? "google.com").toLowerCase();
    if (!GOOGLE.test(site)) throw new HttpError(400, "not a Google site");
    const email = url.searchParams.get("email") ?? "";
    await openGoogleSignIn(site, /^[^@\s]+@[^@\s]+$/.test(email) ? email : "");
    return send(res, 200, { open: true });
  }
  if (m === "POST" && url.pathname === "/api/browser/open") {
    const target = url.searchParams.get("url") || "https://www.google.com";
    if (!/^https?:\/\//.test(target)) throw new HttpError(400, "give a web address starting with http");
    await openSignIn(target);
    return send(res, 200, { open: true });
  }
  if (m === "GET" && url.pathname === "/api/mock/status")
    return send(res, 200, { up: await fetch(`${MOCK}/api/state`, { signal: AbortSignal.timeout(800) }).then((r) => r.ok, () => false) });
  if (m === "POST" && url.pathname === "/api/mock/reset") return send(res, 200, await (await fetch(`${MOCK}/api/reset`, { method: "POST" })).json());
  if (m === "POST" && url.pathname === "/api/mock/layout") return send(res, 200, await (await fetch(`${MOCK}/api/layout?v=${url.searchParams.get("v") === "v2" ? "v2" : "v1"}`, { method: "POST" })).json());

  if (m === "GET" && url.pathname === "/api/sessions")
    return send(res, 200, db.prepare(`SELECT s.id, s.title, s.started_at, s.ended_at,
      (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id) AS events,
      (SELECT MAX(id) FROM specs x WHERE x.session_id = s.id) AS latest_spec
      FROM sessions s WHERE EXISTS (SELECT 1 FROM events e WHERE e.session_id = s.id AND e.kind NOT IN ('start', 'tools')) OR EXISTS (SELECT 1 FROM specs y WHERE y.session_id = s.id) OR (s.transcript IS NOT NULL AND s.transcript != '') OR s.learn_stage IS NOT NULL ORDER BY started_at DESC`).all());

  if (m === "POST" && url.pathname === "/api/sessions") {
    const { title, startedAt } = await json(req);
    const id = randomUUID();
    mkdirSync(sessionDir(id), { recursive: true });
    db.prepare("INSERT INTO sessions (id, title, started_at) VALUES (?, ?, ?)").run(id, title ?? null, startedAt ?? Date.now());
    return send(res, 201, { id });
  }

  if (p[0] === "api" && p[1] === "sessions" && p[2]) {
    const id = p[2];
    session(id);
    if (m === "GET" && p.length === 3) return send(res, 200, full(id));
    // Delete a task: its recording, every spec version, runs and schedule. The UI asks first.
    if (m === "DELETE" && p.length === 3) {
      session(id);
      if (active && !["done", "failed", "stopped"].includes(active.run.status) && specRow(active.run.specId).sessionId === id) throw new HttpError(409, "stop its run first");
      const specIds = (db.prepare("SELECT id FROM specs WHERE session_id = ?").all(id) as any[]).map((x) => x.id);
      for (const sid of specIds) {
        for (const r of db.prepare("SELECT id FROM runs WHERE spec_id = ?").all(sid) as any[]) rmSync(runDir(r.id), { recursive: true, force: true });
        db.prepare("DELETE FROM runs WHERE spec_id = ?").run(sid);
        db.prepare("DELETE FROM schedules WHERE spec_id = ?").run(sid);
      }
      db.prepare("DELETE FROM specs WHERE session_id = ?").run(id);
      discard(id);
      return send(res, 200, { deleted: true });
    }

    if (m === "POST" && p[3] === "events" && p.length === 4) {
      const { t, kind, url: pageUrl, before, after, ...data } = await json(req);
      if (typeof t !== "number" || typeof kind !== "string") throw new HttpError(400, "t and kind required");
      const r = db.prepare("INSERT INTO events (session_id, t, kind, url, data) VALUES (?, ?, ?, ?, ?)").run(id, t, kind, pageUrl ?? null, JSON.stringify(data));
      const eid = Number(r.lastInsertRowid);
      db.prepare("UPDATE events SET before_png = ?, after_png = ? WHERE id = ?").run(savePng(id, `${eid}-before.png`, before), savePng(id, `${eid}-after.png`, after), eid);
      return send(res, 201, { id: eid });
    }
    if (m === "PUT" && p[3] === "events" && p[5] === "after") {
      const eid = Number(p[4]);
      const { after } = await json(req);
      const r = db.prepare("UPDATE events SET after_png = ? WHERE id = ? AND session_id = ?").run(savePng(id, `${eid}-after.png`, after), eid, id);
      if (!r.changes) throw new HttpError(404, "no such event");
      return send(res, 200, { ok: true });
    }
    if (m === "PUT" && p[3] === "audio") {
      const wav = await body(req);
      if (wav.subarray(0, 4).toString() !== "RIFF") throw new HttpError(400, "audio must be WAV");
      writeFileSync(join(sessionDir(id), "voice.wav"), wav);
      return send(res, 200, { bytes: wav.length });
    }
    if (m === "POST" && p[3] === "finish") {
      const { endedAt, audioOffsetMs, learn: auto } = await json(req);
      db.prepare("UPDATE sessions SET ended_at = ?, audio_offset_ms = ? WHERE id = ?").run(endedAt ?? Date.now(), audioOffsetMs ?? null, id);
      if (isEmpty(id)) { discard(id); return send(res, 200, { id, discarded: true }); }
      // Proactive: learn the whole task in the background (name, spec, tested code). The sidebar follows along.
      if (auto !== false) { learn(id, audioOffsetMs ?? 0); return send(res, 202, { id, learning: true }); }
      await transcribeSession(id, audioOffsetMs ?? 0);
      return send(res, 200, full(id));
    }
    // Learn again (after a failure): the same background pipeline.
    if (m === "POST" && p[3] === "learn") { learn(id, session(id).audio_offset_ms ?? 0); return send(res, 202, { id, learning: true }); }
    // Understand: recording -> Task Spec (Muse Spark, about a minute)
    if (m === "POST" && p[3] === "spec") {
      const spec = await understand(full(id), sessionDir(id), folderHints());
      return send(res, 201, specRow(saveSpec(id, spec, "Written by Muse Spark from your recording")));
    }
    if (m === "GET" && p[3] === "files" && p[4] && /^[\w.-]+\.(png|wav)$/.test(p[4])) return file(res, join(sessionDir(id), p[4]));
  }

  if (p[0] === "api" && p[1] === "specs" && p[2]) {
    const sid = Number(p[2]);
    const row = specRow(sid);
    if (m === "GET" && p.length === 3) return send(res, 200, row);
    // Your edits on the review screen become a new version; the rules need building again.
    if (m === "PUT" && p.length === 3) {
      const { spec, note } = await json(req);
      if (!spec?.steps || !spec?.rules || !spec?.outcomes) throw new HttpError(400, "spec needs steps, rules and outcomes");
      return send(res, 201, specRow(saveSpec(row.sessionId, spec, note ?? "Edited by you")));
    }
    // The task's file settings (which folder and rule each upload uses; where downloads go). Saved as a new
    // version that keeps the built code, since the rules didn't change.
    if (m === "POST" && p[3] === "files") {
      const b = await json(req);
      const spec = structuredClone(row.spec);
      const steps = [...spec.steps, ...Object.values(spec.outcomes).flatMap((o) => o.steps)];
      for (const st of steps.filter((x) => x.do === "upload")) {
        if (b.uploadFolder !== undefined) st.file = { ...(st.file ?? { folder: null }), folder: b.uploadFolder ? findFolder(b.uploadFolder)?.name ?? null : null };
        if (b.pick) st.file = { ...(st.file ?? { folder: null }), pick: b.pick };
      }
      if (b.saveDownloads !== undefined) spec.saveDownloads = b.saveDownloads ? findFolder(b.saveDownloads)?.name ?? null : null;
      return send(res, 201, specRow(saveSpec(row.sessionId, spec, "File settings changed", row.code, row.tests)));
    }
    // Which file the next upload would pick, for the task page.
    if (m === "GET" && p[3] === "next-file") {
      const st = [...row.spec.steps, ...Object.values(row.spec.outcomes).flatMap((o) => o.steps)].find((x) => x.do === "upload");
      const folder = findFolder(st?.file?.folder);
      return send(res, 200, { folder: folder?.name ?? null, file: folder && st?.file ? chooseFile(folder, st.file, usedFor(row.sessionId)) : null });
    }
    // Build: rules -> tested code (Muse Spark)
    if (m === "POST" && p[3] === "build") {
      const r = await build(row.spec, pagesOf(row.sessionId), new Date(session(row.sessionId).started_at).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }));
      db.prepare("UPDATE specs SET code = ?, tests = ? WHERE id = ?").run(r.code, JSON.stringify(r.tests), sid);
      return send(res, 200, specRow(sid));
    }
    if (m === "POST" && p[3] === "runs") {
      const opts = await json(req);
      const rows = Array.isArray(opts.rows) ? opts.rows.filter((r: unknown) => r && typeof r === "object").map((r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [String(k), String(v ?? "")]))) : undefined;
      return send(res, 201, await startRun(sid, { limit: opts.limit ? Number(opts.limit) : undefined, autoApprove: !!opts.autoApprove, rows, watch: !!opts.watch }));
    }
  }

  if (p[0] === "api" && p[1] === "runs") {
    // Activity: the latest runs, each with its task, how it went and its update. ?task=<sessionId> narrows to one task.
    if (m === "GET" && p.length === 2) {
      const task = url.searchParams.get("task");
      const rows = (task
        ? db.prepare("SELECT r.json, x.session_id FROM runs r JOIN specs x ON x.id = r.spec_id WHERE x.session_id = ? ORDER BY r.updated_at DESC LIMIT 50").all(task)
        : db.prepare("SELECT r.json, x.session_id FROM runs r JOIN specs x ON x.id = r.spec_id ORDER BY r.updated_at DESC LIMIT 50").all()) as any[];
      const titles = new Map((db.prepare("SELECT id, title FROM sessions").all() as any[]).map((x) => [x.id, x.title]));
      return send(res, 200, rows.map((r) => {
        const run = JSON.parse(r.json) as Run;
        const done = run.items.filter((i) => i.status === "done").length;
        return { id: run.id, specId: run.specId, sessionId: r.session_id, task: titles.get(r.session_id) ?? null, status: run.status,
          startedAt: run.startedAt, endedAt: run.endedAt ?? null, items: run.items.length, done, error: run.error ?? null,
          waiting: !!run.pending, report: run.items.find((i) => i.report)?.report ?? null, score: run.score };
      }));
    }
    const id = p[2];
    if (m === "GET" && p.length === 3) return send(res, 200, getRun(id));
    if (m === "POST" && (p[3] === "answer" || p[3] === "stop")) {
      if (active?.run.id !== id) throw new HttpError(409, "that run is not active");
      if (p[3] === "stop") active.stop(); else active.answer(await json(req));
      return send(res, 200, { ok: true });
    }
    if (m === "GET" && p[3] === "files" && p[4] && /^\d+\.png$/.test(p[4])) { getRun(id); return file(res, join(runDir(id), p[4])); }
  }

  throw new HttpError(404, "not found");
}

// One broken page or browser link must not take the whole Agent (and every schedule) down with it.
process.on("uncaughtException", (e) => console.error("uncaught:", e));

// ponytail: no auth; bound to 127.0.0.1 for local demo use only.
createServer((req, res) => {
  route(req, res).catch((e) => {
    if (!(e instanceof HttpError)) console.error(e);
    send(res, e instanceof HttpError ? e.status : 500, { error: e.message });
  });
}).on("upgrade", (req, socket, head) => { if (!chromeUpgrade(req, socket, head)) socket.destroy(); })
  .listen(PORT, "127.0.0.1", () => console.log(`Remuse on http://127.0.0.1:${PORT}`));
