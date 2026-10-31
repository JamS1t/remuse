// Remuse backend: recordings in, Task Specs and runs out. Serves the review/run UI on the same port.
// Run: npm start   (port 3200, reads MODEL_API_KEY from ../.env)
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, statSync, realpathSync, watch, type FSWatcher } from "node:fs";
import { join, dirname, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { silent, transcribe, calls, type Turn } from "./meta.ts";
import { failed as fixMissed, promote, worked as fixWorked, type Fix } from "./fixes.ts";
import { coverage } from "./evidence.ts";
import type { Card } from "./notes.ts";
import { readback } from "./readback.ts";
import { resolveMarks } from "./marks.ts";
import { revise, sortSaid, understand, type Spec } from "./understand.ts";
import { endLive, heard as hearLive, liveCards, liveState } from "./live.ts";
import { build } from "./build.ts";
import { Runner, itemKey, openBrowser, openPlainChrome, plainChromeOpen, type Run } from "./runner.ts";
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
  return { ...s, events, turns, specs, cards: s.cards ? JSON.parse(s.cards) : [] };
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
// A task thrown away while it was being learned: learning stops at its next step instead of writing to nothing.
const gone = (id: string) => !db.prepare("SELECT 1 FROM sessions WHERE id = ?").get(id);
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
for (const col of ["learn_stage TEXT", "learn_error TEXT", "cards TEXT"]) { try { db.exec(`ALTER TABLE sessions ADD COLUMN ${col}`); } catch { /* already there */ } }
const stage = (id: string, s: string, err: string | null = null) => db.prepare("UPDATE sessions SET learn_stage = ?, learn_error = ? WHERE id = ?").run(s, err, id);
// A recording that was mid-learning when the Agent stopped would show "thinking" forever.
db.prepare("UPDATE sessions SET learn_stage = 'failed', learn_error = 'Remuse stopped while learning this. Press Try again.' WHERE learn_stage IN ('listening', 'understanding', 'building')").run();

async function learn(id: string, offsetMs: number) {
  try {
    stage(id, "listening");
    // The notes taken while you taught (what you said you want): kept with the recording. A retry keeps the old ones.
    // Notes still being taken when you stopped: waited for 10 s at most, so learning starts promptly.
    const cards = await Promise.race([liveCards(id), new Promise<Card[]>((ok) => setTimeout(() => ok(liveState(id)?.cards ?? []), 10_000))]);
    if (cards.length) db.prepare("UPDATE sessions SET cards = ? WHERE id = ?").run(JSON.stringify(cards), id);
    await transcribeSession(id, offsetMs);
    if (gone(id)) return;
    stage(id, "understanding");
    // Marks drawn on a chart or canvas: SAM 3.1 finds what was circled, kept on the mark.
    await resolveMarks(full(id).events, sessionDir(id), (eventId, extra) => {
      const e = db.prepare("SELECT data FROM events WHERE id = ? AND session_id = ?").get(eventId, id) as any;
      if (e) db.prepare("UPDATE events SET data = ? WHERE id = ?").run(JSON.stringify({ ...JSON.parse(e.data), ...extra }), eventId);
    });
    const s = full(id);
    const spec = await understand(s, sessionDir(id), folderHints());
    // What they asked for that the task doesn't do yet: asked out loud in the review, with the steps it wasn't sure of.
    const missing = await coverage(spec, s.turns as Turn[], s.cards);
    if (missing.length) spec.questions = [...(spec.questions ?? []), ...missing];
    if (gone(id)) return;
    if (spec.title && !session(id).title) db.prepare("UPDATE sessions SET title = ? WHERE id = ?").run(spec.title, id);
    const specId = saveSpec(id, spec, "Learned by Muse Spark from your recording");
    stage(id, "building");
    const r = await build(spec, pagesOf(id), new Date(session(id).started_at).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }));
    if (gone(id)) return;
    db.prepare("UPDATE specs SET code = ?, tests = ? WHERE id = ?").run(r.code, JSON.stringify(r.tests), specId);
    stage(id, "ready");
    endLive(id);
    notify(`Remuse learned: ${session(id).title ?? spec.goal}`, r.ok ? "Ready to do it again. Open Remuse to run or schedule it." : "Some checks failed. Open Remuse to review it.", `http://127.0.0.1:${PORT}/#/spec/${specId}`);
    // ponytail: no practice by itself any more. Learning always follows teaching, and the review that follows reads the
    // plan aloud first: practice starts when you say it looks right ("Practice once" is one tap if the sidebar was closed).
  } catch (e) {
    endLive(id);
    if (gone(id)) return;
    stage(id, "failed", (e as Error).message);
    notify("Remuse couldn't learn that task", (e as Error).message, `http://127.0.0.1:${PORT}/#/session/${id}`);
  }
}

/** Feedback in plain words (typed or said): Muse Spark updates the task as a new version and says what it
 *  changed; the rules are rebuilt and checked in the background ("thinking", like after a recording). */
// practice: false in the review, where practice waits until you say it's right. answered: the question this was an
// answer to; the new version keeps only the questions still open.
async function applyFeedback(row: ReturnType<typeof specRow>, said: string, opts: { practice?: boolean; answered?: string } = {}) {
  // The last real run is what the person is talking about; a practice only if there was no real run yet.
  const last = db.prepare("SELECT json FROM runs WHERE spec_id IN (SELECT id FROM specs WHERE session_id = ?) ORDER BY json_extract(json, '$.mode') IS NULL DESC, updated_at DESC LIMIT 1").get(row.sessionId) as any;
  const lastRun = last ? (JSON.parse(last.json) as Run).items.slice(0, 3).map((it) => `${it.label}: ${it.log.map((l) => (l.why ? `${l.msg} (${l.why})` : l.msg)).join(" / ")}`).join("\n").slice(0, 4000) : "";
  const { spec, changes } = await revise(full(row.sessionId), row.spec, said, lastRun);
  const open = (row.spec.questions ?? []).filter((q) => q.id !== opts.answered);
  if (open.length) spec.questions = open; else delete spec.questions;
  const specId = saveSpec(row.sessionId, spec, `You said: "${said.slice(0, 140)}"`);
  stage(row.sessionId, "building");
  build(spec, pagesOf(row.sessionId), new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }))
    .then((b) => {
      db.prepare("UPDATE specs SET code = ?, tests = ? WHERE id = ?").run(b.code, JSON.stringify(b.tests), specId); stage(row.sessionId, "ready");
      if (opts.practice !== false) autoPractice(specId); // try the changed task once
    })
    .catch((e) => stage(row.sessionId, "failed", (e as Error).message));
  // Schedules follow the task to its new version.
  db.prepare("UPDATE schedules SET spec_id = ? WHERE spec_id IN (SELECT id FROM specs WHERE session_id = ?)").run(specId, row.sessionId);
  return { specId, changes };
}

// Hands-free conversation about a learned task (the sidebar keeps listening after it's learned). Each thing
// the person says is heard, sorted (a change, "looks right", a schedule, "do it now", "let me show you
// again", or not meant for Remuse) and acted on; the sidebar shows the latest and does the rest.
// In the review, the first open question is the one Remuse is waiting on; "speak" is what it says back.
type Heard = { n: number; at: number; text: string; intent: string; specId?: number; changes?: string[]; schedule?: { everyMinutes?: number; time?: string; days?: string }; error?: string; speak?: string[]; answered?: string };
const heard = new Map<string, Heard>();
// An answer goes to Muse Spark as the question and the answer, with the step it took out when that's what it asked.
const asAnswer = (q: { text: string; step?: unknown }, said: string) => `Q: ${q.text}${q.step ? ` (the step I took out: ${JSON.stringify(q.step)})` : ""}\nA: ${said}`;
async function hearSaid(sessionId: string, wav: Uint8Array) {
  if (silent(wav)) return; // nothing said: a model would make words up
  const text = (await transcribe(wav)).transcript.trim();
  if (text) await hearText(sessionId, text);
}
// What you said or typed in the review, sorted and acted on. Typed words are always for Remuse: "not for me" becomes a change.
async function hearText(sessionId: string, text: string, typed = false): Promise<Heard> {
  const n = (heard.get(sessionId)?.n ?? 0) + 1;
  heard.set(sessionId, { n, at: Date.now(), text, intent: "thinking" });
  const latest = (db.prepare("SELECT id FROM specs WHERE session_id = ? ORDER BY version DESC LIMIT 1").get(sessionId) as any)?.id;
  if (!latest) { heard.set(sessionId, { n, at: Date.now(), text, intent: "none" }); return heard.get(sessionId)!; }
  const row = specRow(latest);
  const set = (h: Omit<Heard, "n" | "at" | "text">) => heard.set(sessionId, { n, at: Date.now(), text, ...h });
  try {
    const open = row.spec.questions?.[0];
    const r = await sortSaid(row.spec, text, open?.text);
    if (typed && r.intent === "none") r.intent = "change";
    if (r.intent === "answer" && open) {
      const { changes, specId } = await applyFeedback(row, asAnswer(open, text), { practice: false, answered: open.id });
      set({ intent: "answer", changes, specId, answered: open.id, speak: changes.length ? changes : ["Got it."] });
    } else if (r.intent === "change" || r.intent === "answer") {
      const { changes, specId } = await applyFeedback(row, text, { practice: false });
      set({ intent: "change", changes, specId, speak: changes.length ? changes : ["I changed it."] });
    } else if (r.intent === "approve" || r.intent === "run") set({ intent: r.intent, speak: ["Okay, I'll try it once on your example."] });
    else if (r.intent === "discard") set({ intent: r.intent, speak: ["Okay, I've thrown that task away."] });
    else if (r.intent === "stop") set({ intent: r.intent, speak: ["Okay, I'll stop listening."] });
    else if (r.intent === "schedule") set({ intent: r.intent, schedule: r.schedule, speak: ["Okay, it'll repeat on that schedule."] });
    else set({ intent: r.intent });
  } catch (e) { set({ intent: "none", error: (e as Error).message }); }
  return heard.get(sessionId)!;
}

// What Remuse worked out itself after a site changed, kept beside the task (never written into what you taught):
// tried first next time, dropped after two misses in a row or once it points at something irreversible.
db.exec(`CREATE TABLE IF NOT EXISTS fixes (
  id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, grp TEXT NOT NULL, move TEXT NOT NULL, state TEXT NOT NULL,
  fails INTEGER NOT NULL DEFAULT 0, proven_at INTEGER, created_at INTEGER NOT NULL
)`);
const fixesFor = (sessionId: string): Fix[] => (db.prepare("SELECT * FROM fixes WHERE session_id = ? ORDER BY id").all(sessionId) as any[])
  .map((r) => ({ id: r.id, task: r.session_id, group: r.grp, move: JSON.parse(r.move), state: r.state, fails: r.fails, provenAt: r.proven_at ?? undefined }));
/** A run's fixes, after it ends: proven on an item that finished → learned; a learned one that worked again → kept,
 *  that missed → counted (dropped at two), that turned unsafe → dropped. Practices learn nothing. */
function saveFixes(sessionId: string, run: Run) {
  for (const e of run.fixes ?? []) {
    const cur = e.id ? fixesFor(sessionId).find((f) => f.id === e.id) : undefined;
    if (e.outcome === "proposed") {
      if (run.items[e.item]?.status !== "done") continue; // its step was proven, but the item didn't finish
      const f = promote({ task: sessionId, group: e.group, move: e.move, state: "proposed", fails: 0 }, true);
      db.prepare("DELETE FROM fixes WHERE session_id = ? AND grp = ?").run(sessionId, e.group);
      db.prepare("INSERT INTO fixes (session_id, grp, move, state, fails, proven_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(sessionId, e.group, JSON.stringify(f.move), f.state, f.fails, f.provenAt ?? null, Date.now());
    } else if (cur && e.outcome === "worked") { const f = fixWorked(cur); db.prepare("UPDATE fixes SET fails = ?, proven_at = ? WHERE id = ?").run(f.fails, f.provenAt ?? null, cur.id!); }
    else if (cur && e.outcome === "failed") { const f = fixMissed(cur); if (f) db.prepare("UPDATE fixes SET fails = ? WHERE id = ?").run(f.fails, cur.id!); else db.prepare("DELETE FROM fixes WHERE id = ?").run(cur.id!); }
    else if (cur && e.outcome === "dropped") db.prepare("DELETE FROM fixes WHERE id = ?").run(cur.id!);
  }
}

// What a list task has already handled, kept between runs: an hourly inbox task does each email once. Saved as
// each item finishes (not at the end), so a crash halfway can't make the next run do the same items again.
db.exec(`CREATE TABLE IF NOT EXISTS handled (
  session_id TEXT NOT NULL, item_key TEXT NOT NULL, outcome TEXT, run_id TEXT, at INTEGER NOT NULL, PRIMARY KEY (session_id, item_key)
)`);
const handledKeys = (sessionId: string) => new Set((db.prepare("SELECT item_key FROM handled WHERE session_id = ?").all(sessionId) as any[]).map((r) => r.item_key as string));
const handledCount = (sessionId: string) => (db.prepare("SELECT COUNT(*) AS n FROM handled WHERE session_id = ?").get(sessionId) as any).n as number;

// One run at a time: it drives one visible browser.
let active: Runner | null = null;
let activeDone: Promise<unknown> = Promise.resolve(); // settles when the active run has closed its browser
const busyRun = () => !!active && !["done", "failed", "stopped"].includes(active.run.status);

/** Right after learning (or a change), try the task once on the person's own example, stopping before anything
 *  irreversible, and compare with what they did. Nothing waits on them; the sidebar shows how it went. */
async function practice(specId: number): Promise<Run> {
  const row = specRow(specId);
  let example: { url?: string; label?: string } | undefined;
  if (row.spec.inputs.source === "list") {
    // The item opened in the demo: its link, else the next page it went to, else its text.
    const events = full(row.sessionId).events as any[];
    const at = row.spec.inputs.itemEvent ?? -1;
    const ev = events[at];
    if (ev) example = { url: ev.target?.href ?? events.slice(at + 1).find((e) => e.url && e.url !== ev.url)?.url, label: ev.target?.text ?? ev.target?.label };
  }
  return startRun(specId, { practice: true, example });
}
// The automatic practice (after learning or a change) is polite: it never closes a sign-in window you're using,
// and it waits for a real run to finish instead of being dropped.
let practiceNext: number | null = null;
function autoPractice(specId: number) {
  if (signIn || plainChromeOpen()) return; // ponytail: skipped while you sign in; "Practice again" is one tap
  if (busyRun() && active!.run.mode !== "practice") { practiceNext = specId; return; }
  practice(specId).catch((e) => console.warn("no practice:", (e as Error).message));
}
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
  // login_hint fills in the account, so Google goes straight to a passkey or "tap Yes on your phone". Once an account
  // is signed in, AddSession adds another instead of going straight back to the first.
  const url = `https://accounts.google.com/${google.signedIn ? "AddSession" : "ServiceLogin"}?continue=${encodeURIComponent(`https://www.${site}/`)}${email ? `&login_hint=${encodeURIComponent(email)}` : ""}`;
  googleOpenedAt = Date.now(); // the next status check looks again, once that window is closed
  if (!openPlainChrome(url)) return openSignIn(url); // ponytail: no installed Chrome, fall back to the driven window
}

// Is Remuse's own browser signed in to Google? Google logins are never copied, so you sign in there once, and the
// only place that sign-in shows is the browser profile itself: a hidden Chrome on it, and Google's session cookie.
// Remembered for 10 minutes, and looked at again after the sign-in window closes. Never while the profile is in use.
// ids: Google account id -> email, so a recorded YouTube identity can be shown as the account that owns it.
let google: { signedIn: boolean | null; accounts: string[]; ids: Record<string, string>; at: number } = { signedIn: null, accounts: [], ids: {}, at: 0 };
let googleOpenedAt = 0;
let googleLook: Promise<void> | null = null; // a run waits for it (one Chrome per profile)
async function googleStatus() {
  const stale = Date.now() - google.at > 10 * 60_000 || googleOpenedAt > google.at;
  if (!stale || busyRun() || signIn || googleLook) return google;
  if (plainChromeOpen()) return google; // still signing in
  googleLook = (async () => {
    try {
      const ctx = await openBrowser(true);
      try {
        const cookies = await ctx.cookies(["https://accounts.google.com", "https://www.youtube.com"]);
        const signedIn = cookies.some((c) => /^(SID|__Secure-1PSID|__Secure-3PSID)$/.test(c.name));
        // Which accounts: Google's own list of the accounts signed in to this browser.
        let accounts: string[] = [];
        const ids: Record<string, string> = {};
        let known = false; // Google's list was read, so it (not the cookie) says who is signed in
        if (signedIn) {
          // Asked the way Chrome asks (POST); a plain page visit gets "400 Bad Request".
          const body = await ctx.request.post("https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard", { headers: { "content-type": "application/x-www-form-urlencoded" }, data: "", timeout: 15_000 }).then((r) => (r.ok() ? r.text() : ""), () => "");
          // Each entry: [.., .., name, email, photo, valid (1), .., .., .., .., account id, .., .., .., signed out (1), ..].
          // Google also keeps accounts that were signed out of this browser (its account chooser shows them): left out.
          try {
            for (const a of JSON.parse(body.replace(/^\)\]\}'\s*/, ""))[1] ?? []) {
              const email = typeof a?.[3] === "string" ? a[3].toLowerCase() : "";
              if (!email) continue;
              known = true;
              if (typeof a[10] === "string") ids[a[10]] = email; // a recorded YouTube identity names this id
              if (a[5] === 1 && a[14] !== 1 && !accounts.includes(email)) accounts.push(email);
            }
          } catch { /* not the shape we know: no list, the cookie decides */ }
        }
        google = { signedIn: known ? accounts.length > 0 : signedIn, accounts, ids, at: Date.now() };
      } finally { await ctx.close().catch(() => {}); }
    } catch (e) { console.warn("couldn't check the Google sign-in:", (e as Error).message); }
  })();
  try { await googleLook; } finally { googleLook = null; }
  return google;
}

// Sign Remuse's own browser out of Google. Google signs a browser out of all its accounts at once (there is no
// signing out of just one); your own Chrome isn't touched, it's another browser to Google.
async function googleSignOut() {
  if (busyRun()) throw new HttpError(409, "wait for the run to finish first");
  if (signIn || plainChromeOpen()) throw new HttpError(409, "close the Google sign-in window first");
  if (googleLook) await googleLook.catch(() => {});
  googleLook = (async () => {
    const ctx = await openBrowser(true);
    try {
      const p = await ctx.newPage();
      await p.goto("https://accounts.google.com/Logout", { timeout: 30_000 });
      await p.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {}); // it signs out YouTube too, on the way
    } finally { await ctx.close().catch(() => {}); }
  })();
  try { await googleLook; } finally { googleLook = null; }
  google.at = 0; // look again
  const after = await googleStatus();
  if (after.signedIn) throw new HttpError(502, "Google didn't sign out. Try again");
  return after;
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
// A third kind: whenever a new file lands in an allowed folder (watch_folder, for tasks that upload from it).
for (const col of ["every_minutes INTEGER", "last_at INTEGER", "watch_folder TEXT", "since INTEGER"]) { try { db.exec(`ALTER TABLE schedules ADD COLUMN ${col}`); } catch { /* already there */ } }
type Schedule = { id: number; specId: number; sessionId: string; time: string; days: string; everyMinutes: number | null; rows: Record<string, string>[] | null; limit: number | null; enabled: boolean; lastRun: string | null; lastAt: number | null; watchFolder: string | null; since: number | null };
// sessionId names the task, so a schedule stays attached to it across new spec versions.
const schedules = (): Schedule[] => (db.prepare("SELECT s.*, x.session_id FROM schedules s JOIN specs x ON x.id = s.spec_id ORDER BY s.id").all() as any[]).map((s) => ({
  id: s.id, specId: s.spec_id, sessionId: s.session_id, time: s.time, days: s.days, everyMinutes: s.every_minutes, rows: s.rows ? JSON.parse(s.rows) : null,
  limit: s.run_limit, enabled: !!s.enabled, lastRun: s.last_run, lastAt: s.last_at, watchFolder: s.watch_folder ?? null, since: s.since ?? null,
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
  watchFolders(); folderTick();
  const now = manilaNow();
  for (const s of schedules()) {
    if (!s.enabled) continue;
    // Folder schedules run when a file lands (see watchFolders); here only one that had to wait for a busy run.
    if (s.watchFolder) continue; // see folderTick
    const due = s.everyMinutes ? Date.now() - (s.lastAt ?? 0) >= s.everyMinutes * 60_000
      : s.lastRun !== now.date && s.days.includes(now.day) && s.time <= now.time;
    if (!due) continue;
    if (active && !["done", "failed", "stopped"].includes(active.run.status)) return; // try again next tick
    db.prepare("UPDATE schedules SET last_run = ?, last_at = ? WHERE id = ?").run(now.date, Date.now(), s.id);
    try { await startRun(latestSpec(s.specId), { rows: s.rows ?? undefined, limit: s.limit ?? undefined, scheduled: true }); }
    catch (e) { notify("Remuse couldn't start a scheduled task", (e as Error).message, `http://127.0.0.1:${PORT}/#/spec/${s.specId}`); }
  }
}, 30_000).unref();

async function startRun(specId: number, opts: { limit?: number; autoApprove?: boolean; rows?: Record<string, string>[]; scheduled?: boolean; watch?: boolean; practice?: boolean; plan?: boolean; redo?: boolean; fromFolder?: number; files?: { folder: string; name: string }[]; example?: { url?: string; label?: string } }) {
  const row = specRow(specId);
  if (!row.code) throw new HttpError(400, "build the rules first");
  if (googleLook) await googleLook; // the Google sign-in check has the browser profile for a moment
  // A practice gives way to real work, and to a newer practice: it stops, and the new run starts once the old
  // one has closed its browser. A real run is never interrupted.
  // A loop: another practice may have slipped in while we waited for the last one to close.
  for (let n = 0; n < 5 && busyRun() && active!.run.mode === "practice"; n++) { active!.stop(); await activeDone; }
  if (!busyRun()) await activeDone;
  // Both use the one Chrome profile, which only one window can hold.
  if (signIn) { await signIn.close().catch(() => {}); signIn = null; }
  // Checked last, after every wait, so two starts at once can't both get through (nothing below awaits).
  if (busyRun()) throw new HttpError(409, "a run is already going");
  const run: Run = { id: randomUUID(), specId, status: "starting", items: [], current: 0, pending: null, autoApprove: !!opts.autoApprove, startedAt: Date.now(), heals: [], learned: [], rows: opts.rows,
    visible: !!opts.watch && !opts.scheduled && !opts.practice, trigger: opts.scheduled ? "schedule" : "you",
    // Plan first only when someone is there to see the plan: never on a schedule or a practice.
    // and not when you chose to run without being asked (that choice was its own confirmation).
    plan: !!opts.plan && !opts.scheduled && !opts.practice && !opts.autoApprove,
    ...(opts.practice ? { mode: "practice" as const, practice: { sameItem: false, values: [], checked: 0, ok: false } } : {}) };
  let last = 0;
  let asked = "";
  const link = `http://127.0.0.1:${PORT}/#/run/${run.id}`;
  const remembered = new Set<number>();
  const runner = new Runner(run, row.spec, row.code, runDir(run.id), (r) => {
    // Each list item done (or settled by you) is remembered right away. Not by a practice, which only looks.
    if (row.spec.inputs.source === "list" && r.mode !== "practice") r.items.forEach((it, n) => {
      if (remembered.has(n) || !(it.status === "done" || (it.status === "skipped" && it.byYou))) return;
      remembered.add(n);
      db.prepare("INSERT OR REPLACE INTO handled (session_id, item_key, outcome, run_id, at) VALUES (?, ?, ?, ?, ?)").run(row.sessionId, it.key ?? itemKey(it), it.status === "done" ? it.outcome ?? null : "skipped", r.id, Date.now());
    });
    if (Date.now() - last > 300 || ["done", "failed", "stopped"].includes(r.status)) { last = Date.now(); saveRun(r); }
    // Anything waiting on the person becomes a Windows notification, once.
    const p = r.pending;
    const key = p ? `${p.kind}-${p.item}-${p.shot}` : "";
    if (p && key !== asked) {
      const label = r.items[p.item]?.label ?? "";
      if (p.kind === "approval") notify("Remuse needs your OK", `${p.step}: ${label}`, link);
      else if (p.kind === "ask") notify("Remuse has a question", p.question, link);
      else if (p.kind === "ready") notify(`${p.items.length} ready for your OK`, `${p.items.map((i) => r.items[i]?.label).join(", ")}: prepared and checked. Open Remuse to approve.`, link);
      else if (p.kind === "plan") notify("Remuse has a plan", `${Object.entries(p.counts).map(([o, n]) => `${n} ${o.replaceAll("_", " ")}`).join(", ")}. Open Remuse and press Go.`, link);
      else notify("Remuse needs you in the browser", `Stuck on "${p.step}". Sign in or clear the check, then press Try again.`, link);
    }
    asked = key;
  });
  runner.prev = lastValues(row.sessionId);
  runner.taskKey = row.sessionId;
  runner.example = opts.example;
  runner.files = opts.files;
  runner.fixes = fixesFor(row.sessionId).filter((f) => f.state === "learned");
  // List tasks leave alone what earlier runs handled, unless you asked to do them again.
  if (row.spec.inputs.source === "list" && !opts.practice && !opts.redo) runner.handled = handledKeys(row.sessionId);
  active = runner;
  saveRun(run);
  activeDone = runner.start(opts.limit).then(() => {
    saveRun(run);
    // Nothing new since last time (no new items, or no new file to post): a scheduled run stays quiet.
    const nothingNew = !run.error && ((run.items.length === 0 && (run.alreadyDone ?? 0) > 0) || (run.items.length > 0 && run.items.every((i) => i.status === "skipped" && /^Nothing new to upload/.test(i.log.at(-1)?.msg ?? ""))));
    // A folder run that posted something checks for the next file right away (a batch drops in at once).
    if (opts.fromFolder !== undefined && run.status === "done" && !nothingNew && run.items.every((i) => i.status === "done")) setTimeout(() => folderTick(), 1000);
    if (opts.scheduled && !nothingNew) notify(`Remuse finished: ${row.spec.goal}`.slice(0, 120), `${run.items.filter((i) => i.status === "done").length} of ${run.items.length} done${run.error ? `. Problem: ${run.error}` : ""}`, link);
    if (run.mode !== "practice") saveFixes(row.sessionId, run);
    if (run.mode === "practice") {
      // A practice that went wrong is worth a word; one that matched shows in the sidebar.
      // ponytail: a practice's heals aren't saved as a new version; the first real run re-finds them
      if (run.status === "done" && run.practice && !run.practice.ok) notify(`Remuse practiced ${row.spec.title ?? "your task"}`, "Something didn't match what you did. Open Remuse to see what.", link);
    } else if (run.heals.length || run.learned.length) {
      // What the run learned (new labels after a redesign, answers you gave) becomes the next spec version.
      const parts = [run.heals.length && `${run.heals.length} element(s) updated after a layout change`, run.learned.length && `learned: ${run.learned.map((l) => `${l.requestType} → ${l.outcome}`).join(", ")}`].filter(Boolean);
      (run as any).newSpecId = saveSpec(row.sessionId, runner.spec, `From run: ${parts.join("; ")}`, row.code, row.tests);
      saveRun(run);
    }
    // A practice that waited for this run goes now, on the newest version (including what this run learned).
    if (run.mode !== "practice" && practiceNext !== null) { const next = practiceNext; practiceNext = null; autoPractice(latestSpec(next)); }
  }).catch((e) => console.error("run ended badly:", e)); // never rejects, so whoever waits on it can go on
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

/** An estimate of the time Remuse has saved on a task: the items it really did something for in real runs (not a
 *  practice, not one it left for you), each counted once a day (redoing it, or a check that runs every hour, isn't
 *  more work saved), times how long your demo took (capped at 15 min; it includes your talking it through). */
const outcomeActs = new Map<number, Record<string, boolean>>(); // per spec version: which outcomes do something
const runDid = new Map<string, { at: number; did: string[] }>(); // per run: "day|item" it did something for
function timeSaved(sessionId: string, startedAt: number, endedAt: number | null) {
  const did = new Set<string>();
  for (const r of db.prepare("SELECT r.id, r.spec_id, r.updated_at, r.json FROM runs r JOIN specs x ON x.id = r.spec_id WHERE x.session_id = ?").all(sessionId) as any[]) {
    let hit = runDid.get(r.id);
    if (!hit || hit.at !== r.updated_at) {
      const run = JSON.parse(r.json) as Run;
      let acts = outcomeActs.get(r.spec_id);
      if (!acts) { acts = Object.fromEntries(Object.entries(specRow(r.spec_id).spec.outcomes).map(([k, o]) => [k, o.steps.length > 0])); outcomeActs.set(r.spec_id, acts); }
      const day = new Date(run.startedAt).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
      hit = { at: r.updated_at, did: run.mode === "practice" ? [] : run.items.filter((i) => i.status === "done" && i.outcome && acts![i.outcome]).map((i) => `${day}|${i.key ?? i.url ?? i.label}`) };
      runDid.set(r.id, hit);
    }
    for (const k of hit.did) did.add(k);
  }
  // The demo's length: up to its last recorded action (a recording left running doesn't count), at most 15 minutes.
  const lastAction = (db.prepare("SELECT MAX(t) AS t FROM events WHERE session_id = ?").get(sessionId) as any)?.t as number | null;
  const length = lastAction && lastAction > 0 ? lastAction : endedAt && endedAt > startedAt ? endedAt - startedAt : null;
  const demoMs = length ? Math.min(length, 15 * 60_000) : null;
  return { doneCount: did.size, demoMs, savedMs: demoMs ? did.size * demoMs : null };
}

/** An account as a person reads it: an email as is; a YouTube identity as the account that owns it, if known. */
function accountLabel(who: string) {
  if (!/^ytc?:/.test(who)) return who;
  if (who.startsWith("ytc:")) return "the YouTube channel from your demo";
  const [first, second] = who.slice(3).split("||");
  const owner = google.ids[second || first];
  return `${second ? "a brand channel" : "the YouTube channel"} of ${owner ?? "your demo's Google account"}`;
}

/** The practice of this task's newest version, if there was one: going, or how it went. */
function latestPractice(sessionId: string, specId: number | null) {
  const run = recentRuns(sessionId).find((r) => r.mode === "practice" && r.specId === specId);
  return run ? { runId: run.id, status: run.status, label: run.items[0]?.label ?? null, result: isLiveStatus(run.status) ? null : run.practice ?? null } : null;
}
const isLiveStatus = (s: Run["status"]) => s === "starting" || s === "running";

/** The item variables of this task's most recent finished run, by item label. */
function lastValues(sessionId: string): Record<string, Record<string, unknown>> {
  for (const run of recentRuns(sessionId)) {
    if (run.mode === "practice") continue; // a practice reads the demo item again, not the real last values
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
  if (url.pathname === "/api/logins/google" && m === "GET") return send(res, 200, await googleStatus());

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
    // "Whenever a new file lands in <folder>": only for a task that uploads from that folder.
    const watchFolder = b.watchFolder ? findFolder(String(b.watchFolder)) : null;
    if (b.watchFolder && !watchFolder) throw new HttpError(400, "that folder isn't allowed; add it on the Folders page");
    if (watchFolder && !uploadsFrom(specRow(specId).spec, watchFolder.name)) throw new HttpError(400, `this task doesn't post files from ${watchFolder.name}`);
    const every = watchFolder ? null : b.everyMinutes ? Math.round(Number(b.everyMinutes)) : null;
    if (every !== null && !(every >= 15 && every <= 1440)) throw new HttpError(400, "repeat between every 15 minutes and once a day");
    if (!every && !watchFolder && !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.time ?? "")) throw new HttpError(400, "time must be HH:MM");
    const days = String(b.days ?? "1234567").replace(/[^1-7]/g, "");
    if (!days) throw new HttpError(400, "pick at least one day");
    const rows = Array.isArray(b.rows) ? JSON.stringify(b.rows) : null;
    // One schedule per task: saving again replaces it. Re-saving a folder schedule for the same folder keeps when it
    // started watching, so files that arrived since then still count as new.
    const before = schedules().find((x) => x.sessionId === specRow(specId).sessionId);
    const since = watchFolder && before?.watchFolder === watchFolder.name && before.since ? before.since : Date.now();
    db.prepare("DELETE FROM schedules WHERE spec_id IN (SELECT id FROM specs WHERE session_id = (SELECT session_id FROM specs WHERE id = ?))").run(specId);
    // An interval schedule starts counting now; the first run is one interval away.
    db.prepare("INSERT INTO schedules (spec_id, time, days, rows, run_limit, enabled, every_minutes, last_at, watch_folder, since) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)")
      .run(specId, watchFolder ? "00:00" : b.time ?? "00:00", days, rows, b.limit ? Number(b.limit) : null, every, every ? Date.now() : null, watchFolder?.name ?? null, since);
    watchFolders();
    return send(res, 200, schedules());
  }
  if (p[1] === "fixes" && p[2] && m === "DELETE") { db.prepare("DELETE FROM fixes WHERE id = ?").run(Number(p[2])); return send(res, 200, { ok: true }); }
  if (p[1] === "schedules" && p[2] && m === "DELETE") { db.prepare("DELETE FROM schedules WHERE id = ?").run(Number(p[2])); watchFolders(); return send(res, 200, schedules()); }
  // Saved tasks for the sidebar: every recording with its latest Task Spec.
  // The extension writes down every mic drop and reconnect, with the mic's state then (see offscreen.js mend()).
  if (url.pathname === "/api/mic-log" && m === "POST") {
    const b = await json(req);
    appendFileSync(join(DATA, "mic.log"), `${JSON.stringify({ at: new Date().toISOString(), session: b.session ?? null, ok: b.ok ?? null, note: !!b.note, why: String(b.why ?? "").slice(0, 300), detail: b.detail ?? null })}\n`);
    return send(res, 200, { ok: true });
  }
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
          saveDownloads: spec?.saveDownloads ?? null, practice: latestPractice(t.sessionId, t.specId), handled: handledCount(t.sessionId), ...timeSaved(t.sessionId, t.startedAt, t.endedAt), accounts: spec?.accounts ? Object.fromEntries(Object.entries(spec.accounts).map(([site, who]) => [site, accountLabel(who)])) : null };
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
  if (m === "POST" && url.pathname === "/api/browser/google/signout") return send(res, 200, await googleSignOut());
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
    // What Remuse worked out itself for this task (shown on the task page, each with Undo).
    if (m === "GET" && p[3] === "fixes") return send(res, 200, fixesFor(id));
    // Start fresh: forget which items this task already handled (the next run does the whole list again).
    if (m === "POST" && p[3] === "forget") { db.prepare("DELETE FROM handled WHERE session_id = ?").run(id); return send(res, 200, { forgotten: true }); }
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
    // While you teach: one thing you said, whole. Notes are taken from it; "control: done" means you said you're done.
    if (m === "POST" && p[3] === "heard") {
      const wav = await body(req);
      if (wav.subarray(0, 4).toString() !== "RIFF") throw new HttpError(400, "audio must be WAV");
      const atMs = Number(url.searchParams.get("at") ?? 0), t0 = Date.now();
      const r = await hearLive(id, wav, atMs, () => full(id));
      // What each sentence was heard as, and whether it ended the recording: a missed "I'm done" can be checked later.
      if (r.text) appendFileSync(join(DATA, "voice.log"), `${JSON.stringify({ at: new Date().toISOString(), session: id, atS: +(atMs / 1000).toFixed(1), text: r.text, control: r.control, ms: Date.now() - t0 })}
`);
      return send(res, 200, r);
    }
    // Hands-free: something said about a learned task (sorted and acted on in the background), and the latest.
    if (m === "POST" && p[3] === "say") {
      const wav = await body(req);
      if (wav.subarray(0, 4).toString() !== "RIFF") throw new HttpError(400, "audio must be WAV");
      hearSaid(id, wav).catch((e) => console.warn("couldn't hear that:", (e as Error).message));
      return send(res, 202, { ok: true });
    }
    if (m === "GET" && p[3] === "say") return send(res, 200, heard.get(id) ?? null);
    // Typed in the review ("Type instead"): understood like speech, and answered right away.
    if (m === "POST" && p[3] === "say-text") {
      const text = String((await json(req)).text ?? "").trim().slice(0, 2000);
      if (!text) throw new HttpError(400, "type something");
      return send(res, 200, await hearText(id, text, true));
    }
    if (m === "GET" && p[3] === "live") return send(res, 200, liveState(id) ?? { turns: [], cards: [], thinking: false, error: null, ending: null });
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
      if (auto !== false) {
        // Nothing done and nothing understood (a misclick, a start by mistake, words it couldn't make out): ask
        // whether that was a task instead of learning something made up.
        const cards = await liveCards(id);
        const acted = (db.prepare("SELECT COUNT(*) AS n FROM events WHERE session_id = ? AND kind IN ('click', 'input', 'key', 'upload', 'mark')").get(id) as any).n as number;
        if (!cards.length && acted <= 1) {
          endLive(id);
          stage(id, "unsure", acted ? "I saw one click and couldn't make out what you wanted." : "I didn't see you do anything, and I couldn't make out what you wanted.");
          return send(res, 200, { id, unsure: true });
        }
        // Proactive: learn the whole task in the background (name, spec, tested code). The sidebar follows along.
        learn(id, audioOffsetMs ?? 0);
        return send(res, 202, { id, learning: true });
      }
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
    // Feedback in plain words: Muse Spark updates the task (a new version) and says what it changed; the
    // rules are then rebuilt and checked in the background, shown as "thinking" like after a recording.
    if (m === "POST" && p[3] === "feedback") {
      const b = await json(req);
      const said = String(b.text ?? "").trim().slice(0, 2000);
      if (!said) throw new HttpError(400, "say what should change");
      // Typed in the review: no practice until it's right, and an answer to the question it asked.
      const q = b.answered ? row.spec.questions?.find((x) => x.id === b.answered) : undefined;
      return send(res, 201, await applyFeedback(row, q ? asAnswer(q, said) : said, { practice: b.practice !== false, answered: q?.id }));
    }
    // What Remuse says when it reads this task back: the plan, then its questions (asked one at a time).
    if (m === "GET" && p[3] === "readback") return send(res, 200, { specId: row.id, ...readback(row.spec) }); // which version: the review asks the next question from the new one
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
    // Practice again: try it once on the demo item, stopping before anything irreversible.
    if (m === "POST" && p[3] === "practice") {
      if (!row.code) throw new HttpError(400, "build the rules first");
      return send(res, 201, await practice(sid));
    }
    if (m === "POST" && p[3] === "runs") {
      const opts = await json(req);
      const rows = Array.isArray(opts.rows) ? opts.rows.filter((r: unknown) => r && typeof r === "object").map((r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [String(k), String(v ?? "")]))) : undefined;
      return send(res, 201, await startRun(sid, { limit: opts.limit ? Number(opts.limit) : undefined, autoApprove: !!opts.autoApprove, rows, watch: !!opts.watch, plan: !!opts.plan, redo: !!opts.redo }));
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
        return { id: run.id, specId: run.specId, sessionId: r.session_id, task: titles.get(r.session_id) ?? null, status: run.status, mode: run.mode ?? null, practiceOk: run.practice?.ok ?? null,
          startedAt: run.startedAt, endedAt: run.endedAt ?? null, items: run.items.length, done, error: run.error ?? null,
          waiting: !!run.pending, report: run.items.find((i) => i.report)?.report ?? null, score: run.score, alreadyDone: run.alreadyDone ?? 0 };
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

// ---- Folder schedules: a task that posts files runs when a new one lands in its folder. ----
// What an upload may pick: not a caption, and of the kinds the task asked for, if any.
const isPostable = (name: string, ext?: string[]) => extname(name).toLowerCase() !== ".txt" && (!ext?.length || ext.map((e) => e.replace(/^\./, "").toLowerCase()).includes(extname(name).slice(1).toLowerCase()));
const uploadsFrom = (spec: Spec, folder: string) => [...spec.steps, ...Object.values(spec.outcomes).flatMap((o) => o.steps)]
  .some((s) => s.do === "upload" && findFolder(s.file?.folder)?.name === folder);
// One watcher per folder schedule, keyed by schedule and folder (an id can be reused after a schedule is replaced).
const watchers = new Map<string, { w: FSWatcher; timer?: ReturnType<typeof setTimeout> }>();
const warned = new Set<string>();
const watchKey = (s: Schedule) => `${s.id}:${findFolder(s.watchFolder)?.path ?? ""}`;
// Files a folder run was started for (schedule:file:modified time). Each is tried once; a failed or refused post
// isn't retried until the file changes or the Agent restarts, so a broken page can't start runs over and over.
const tried = new Set<string>();
/** The files a folder schedule would post now, in the task's order: arrived after the schedule was set up (files
 *  already there aren't "new"), finished arriving (untouched for 10 s), never posted, and not already tried as they
 *  are now. Files that land together are one run, one item each. */
function nextFiles(s: Schedule): { name: string; key: string }[] {
  const folder = findFolder(s.watchFolder);
  if (!folder) return [];
  const row = specRow(latestSpec(s.specId));
  const step = [...row.spec.steps, ...Object.values(row.spec.outcomes).flatMap((o) => o.steps)].find((x) => x.do === "upload" && findFolder(x.file?.folder)?.name === folder.name);
  if (!step?.file) return [];
  try {
    const used = usedFor(row.sessionId);
    // Only files that arrived after the schedule are candidates. Arrival is the latest of: modified (new file),
    // created (a copy keeps its old modified time), changed (a move keeps both, but NTFS updates the change time).
    const arrived = new Map<string, number>();
    for (const f of filesIn(folder)) {
      const st = statSync(join(folder.path, f.name));
      const at = Math.max(st.mtimeMs, st.birthtimeMs, st.ctimeMs);
      if (at > (s.since ?? 0) && Date.now() - st.mtimeMs > 10_000 && !used.has(f.name) && !tried.has(`${s.id}:${f.name}:${st.mtimeMs}`)) arrived.set(f.name, at);
    }
    // In the task's own order: "newest" is the last to arrive among them; "next" and "dated" follow chooseFile.
    const skip = new Set(filesIn(folder).map((f) => f.name).filter((n) => !arrived.has(n)));
    const key = (name: string) => ({ name, key: `${s.id}:${name}:${statSync(join(folder.path, name)).mtimeMs}` });
    if (step.file.pick === "newest") {
      const newest = [...arrived].filter(([n]) => isPostable(n, step.file!.ext)).sort((x, y) => y[1] - x[1])[0]?.[0];
      return newest ? [key(newest)] : [];
    }
    const out: { name: string; key: string }[] = [];
    for (let name = chooseFile(folder, step.file, skip); name && arrived.has(name) && !skip.has(name); name = chooseFile(folder, step.file, skip)) { out.push(key(name)); skip.add(name); }
    return out;
  } catch { return []; }
}
/** Run each folder schedule that has a new file waiting, one at a time; the rest go on the next tick. A caption,
 *  a deleted or hidden file never starts a run, since there's nothing to post. */
function folderTick() {
  for (const s of schedules()) {
    if (!s.enabled || !s.watchFolder || busyRun()) continue;
    let files: ReturnType<typeof nextFiles> = [];
    try { files = nextFiles(s); } catch { continue; } // e.g. its task was deleted
    if (!files.length) continue;
    for (const f of files) tried.add(f.key);
    db.prepare("UPDATE schedules SET last_at = ? WHERE id = ?").run(Date.now(), s.id);
    startRun(latestSpec(s.specId), { scheduled: true, rows: s.rows ?? undefined, limit: s.limit ?? undefined, fromFolder: s.id, files: files.map((f) => ({ folder: s.watchFolder!, name: f.name })) })
      .catch((e) => { for (const f of files) tried.delete(f.key); notify("Remuse couldn't start a task", (e as Error).message, `http://127.0.0.1:${PORT}/#/spec/${s.specId}`); });
    return;
  }
}
function watchFolders() {
  const want = new Map(schedules().filter((s) => s.enabled && s.watchFolder && findFolder(s.watchFolder)).map((s) => [watchKey(s), s]));
  for (const [k, x] of watchers) if (!want.has(k)) { clearTimeout(x.timer); x.w.close(); watchers.delete(k); }
  for (const [k, s] of want) {
    if (watchers.has(k)) continue;
    try {
      // A change starts the check 11 s later (a file must sit still 10 s, so one that is still copying waits).
      // The full long path: Windows' file watcher aborts the whole process on a short (8.3, "JAMESC~1") one.
      const x: { w: FSWatcher; timer?: ReturnType<typeof setTimeout> } = { w: watch(realpathSync.native(findFolder(s.watchFolder)!.path), () => {
        clearTimeout(x.timer); x.timer = setTimeout(folderTick, 11_000);
      }) };
      x.w.on("error", () => { clearTimeout(x.timer); x.w.close(); watchers.delete(k); }); // re-attached on the next tick
      watchers.set(k, x);
    } catch (e) { if (!warned.has(k)) { warned.add(k); console.warn(`can't watch ${s.watchFolder}:`, (e as Error).message); } }
  }
}
watchFolders();
folderTick(); // files that arrived while the Agent was off

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
