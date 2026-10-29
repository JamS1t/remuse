// Showrun backend: recordings in, Task Specs and runs out. Serves the review/run UI on the same port.
// Run: npm start   (port 3200, reads MODEL_API_KEY from ../.env)
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { transcribe, calls } from "./meta.ts";
import { understand, type Spec } from "./understand.ts";
import { build } from "./build.ts";
import { Runner, type Run } from "./runner.ts";

const PORT = Number(process.env.PORT ?? 3200);
const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = process.env.DATA_DIR ?? join(HERE, "..", "data");
const PUBLIC = join(HERE, "..", "public");
const MOCK = process.env.MOCK_URL ?? "http://localhost:3100";
mkdirSync(DATA, { recursive: true });

const db = new DatabaseSync(join(DATA, "showrun.db"));
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

const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".wav": "audio/wav", ".svg": "image/svg+xml" };
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

// One run at a time: it drives one visible browser.
let active: Runner | null = null;
function saveRun(run: Run) {
  db.prepare("INSERT INTO runs (id, spec_id, json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at")
    .run(run.id, run.specId, JSON.stringify(run), Date.now());
}

async function startRun(specId: number, opts: { limit?: number; autoApprove?: boolean }) {
  if (active && !["done", "failed", "stopped"].includes(active.run.status)) throw new HttpError(409, "a run is already going");
  const row = specRow(specId);
  if (!row.code) throw new HttpError(400, "build the rules first");
  const run: Run = { id: randomUUID(), specId, status: "starting", items: [], current: 0, pending: null, autoApprove: !!opts.autoApprove, startedAt: Date.now(), heals: [], learned: [] };
  let last = 0;
  const runner = new Runner(run, row.spec, row.code, runDir(run.id), (r) => {
    if (Date.now() - last > 300 || ["done", "failed", "stopped"].includes(r.status)) { last = Date.now(); saveRun(r); }
  });
  active = runner;
  saveRun(run);
  runner.start(opts.limit).then(() => {
    saveRun(run);
    // What the run learned (new labels after a redesign, answers you gave) becomes the next spec version.
    if (run.heals.length || run.learned.length) {
      const parts = [run.heals.length && `${run.heals.length} element(s) updated after a layout change`, run.learned.length && `learned: ${run.learned.map((l) => `${l.requestType} → ${l.outcome}`).join(", ")}`].filter(Boolean);
      (run as any).newSpecId = saveSpec(row.sessionId, runner.spec, `From run: ${parts.join("; ")}`, row.code, row.tests);
      saveRun(run);
    }
  });
  return run;
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
    if (!/^[\w.-]+$/.test(name)) throw new HttpError(404, "not found");
    return file(res, join(PUBLIC, name));
  }

  if (m === "GET" && url.pathname === "/api/calls") return send(res, 200, calls.slice(-200));
  if (m === "POST" && url.pathname === "/api/mock/reset") return send(res, 200, await (await fetch(`${MOCK}/api/reset`, { method: "POST" })).json());
  if (m === "POST" && url.pathname === "/api/mock/layout") return send(res, 200, await (await fetch(`${MOCK}/api/layout?v=${url.searchParams.get("v") === "v2" ? "v2" : "v1"}`, { method: "POST" })).json());

  if (m === "GET" && url.pathname === "/api/sessions")
    return send(res, 200, db.prepare(`SELECT s.id, s.title, s.started_at, s.ended_at,
      (SELECT COUNT(*) FROM events e WHERE e.session_id = s.id) AS events,
      (SELECT MAX(id) FROM specs x WHERE x.session_id = s.id) AS latest_spec
      FROM sessions s ORDER BY started_at DESC`).all());

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
      const { endedAt, audioOffsetMs } = await json(req);
      db.prepare("UPDATE sessions SET ended_at = ?, audio_offset_ms = ? WHERE id = ?").run(endedAt ?? Date.now(), audioOffsetMs ?? null, id);
      const wavPath = join(sessionDir(id), "voice.wav");
      if (existsSync(wavPath)) {
        try {
          const { transcript, turns } = await transcribe(readFileSync(wavPath));
          db.prepare("DELETE FROM turns WHERE session_id = ?").run(id);
          const ins = db.prepare("INSERT INTO turns (session_id, start_ms, end_ms, text) VALUES (?, ?, ?, ?)");
          const off = audioOffsetMs ?? 0; // turn times are relative to the audio; shift onto the session clock
          for (const t of turns) ins.run(id, t.startMs + off, t.endMs + off, t.text);
          db.prepare("UPDATE sessions SET transcript = ?, transcribe_error = NULL WHERE id = ?").run(transcript, id);
        } catch (e) {
          db.prepare("UPDATE sessions SET transcribe_error = ? WHERE id = ?").run((e as Error).message, id);
        }
      }
      return send(res, 200, full(id));
    }
    // Understand: recording -> Task Spec (Muse Spark, about a minute)
    if (m === "POST" && p[3] === "spec") {
      const spec = await understand(full(id), sessionDir(id));
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
    // Build: rules -> tested code (Muse Spark)
    if (m === "POST" && p[3] === "build") {
      const r = await build(row.spec, pagesOf(row.sessionId), new Date(session(row.sessionId).started_at).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }));
      db.prepare("UPDATE specs SET code = ?, tests = ? WHERE id = ?").run(r.code, JSON.stringify(r.tests), sid);
      return send(res, 200, specRow(sid));
    }
    if (m === "POST" && p[3] === "runs") {
      const opts = await json(req);
      return send(res, 201, await startRun(sid, { limit: opts.limit ? Number(opts.limit) : undefined, autoApprove: !!opts.autoApprove }));
    }
  }

  if (p[0] === "api" && p[1] === "runs") {
    if (m === "GET" && p.length === 2) return send(res, 200, (db.prepare("SELECT json FROM runs ORDER BY updated_at DESC LIMIT 20").all() as any[]).map((r) => {
      const run = JSON.parse(r.json); return { id: run.id, specId: run.specId, status: run.status, startedAt: run.startedAt, items: run.items.length, score: run.score };
    }));
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

// ponytail: no auth; bound to 127.0.0.1 for local demo use only.
createServer((req, res) => {
  route(req, res).catch((e) => {
    if (!(e instanceof HttpError)) console.error(e);
    send(res, e instanceof HttpError ? e.status : 500, { error: e.message });
  });
}).listen(PORT, "127.0.0.1", () => console.log(`Showrun on http://127.0.0.1:${PORT}`));
