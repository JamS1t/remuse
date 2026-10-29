// Showrun backend: stores recorded sessions (events, screenshots, voice) in SQLite + files on disk.
// Run: node --env-file=../.env src/server.ts   (port 3200)
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { transcribe } from "./meta.ts";

const PORT = Number(process.env.PORT ?? 3200);
const DATA = process.env.DATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..", "data");
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
`);

const MAX_BODY = 40 * 1024 * 1024; // Transcribe caps audio at 32 MB

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

class HttpError extends Error {
  status: number;
  constructor(status: number, msg: string) { super(msg); this.status = status; }
}

function send(res: ServerResponse, status: number, data: unknown, type = "application/json") {
  res.writeHead(status, { "Content-Type": type });
  res.end(type === "application/json" ? JSON.stringify(data) : (data as Buffer));
}

const sessionDir = (id: string) => join(DATA, "sessions", id);

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
  return { ...s, events, turns };
}

async function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://x");
  const p = url.pathname.split("/").filter(Boolean); // ["api","sessions",id,...]
  const m = req.method;

  if (m === "GET" && url.pathname === "/api/sessions")
    return send(res, 200, db.prepare("SELECT id, title, started_at, ended_at FROM sessions ORDER BY started_at DESC").all());

  if (m === "POST" && url.pathname === "/api/sessions") {
    const { title, startedAt } = JSON.parse((await body(req)).toString() || "{}");
    const id = randomUUID();
    mkdirSync(sessionDir(id), { recursive: true });
    db.prepare("INSERT INTO sessions (id, title, started_at) VALUES (?, ?, ?)").run(id, title ?? null, startedAt ?? Date.now());
    return send(res, 201, { id });
  }

  if (p[0] !== "api" || p[1] !== "sessions" || !p[2]) throw new HttpError(404, "not found");
  const id = p[2];
  session(id);

  if (m === "GET" && p.length === 3) return send(res, 200, full(id));

  // One event, with the screenshot taken just before it (and optionally after).
  if (m === "POST" && p[3] === "events") {
    const { t, kind, url: pageUrl, before, after, ...data } = JSON.parse((await body(req)).toString());
    if (typeof t !== "number" || typeof kind !== "string") throw new HttpError(400, "t and kind required");
    const r = db.prepare("INSERT INTO events (session_id, t, kind, url, data) VALUES (?, ?, ?, ?, ?)")
      .run(id, t, kind, pageUrl ?? null, JSON.stringify(data));
    const eid = Number(r.lastInsertRowid);
    db.prepare("UPDATE events SET before_png = ?, after_png = ? WHERE id = ?")
      .run(savePng(id, `${eid}-before.png`, before), savePng(id, `${eid}-after.png`, after), eid);
    return send(res, 201, { id: eid });
  }

  // Screen after an event settles, sent a moment later.
  if (m === "PUT" && p[3] === "events" && p[5] === "after") {
    const eid = Number(p[4]);
    const { after } = JSON.parse((await body(req)).toString());
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

  // Stop: save timing, then transcribe the voice if there is any.
  if (m === "POST" && p[3] === "finish") {
    const { endedAt, audioOffsetMs } = JSON.parse((await body(req)).toString() || "{}");
    db.prepare("UPDATE sessions SET ended_at = ?, audio_offset_ms = ? WHERE id = ?").run(endedAt ?? Date.now(), audioOffsetMs ?? null, id);
    const wavPath = join(sessionDir(id), "voice.wav");
    if (existsSync(wavPath)) {
      try {
        const { transcript, turns } = await transcribe(readFileSync(wavPath));
        db.prepare("DELETE FROM turns WHERE session_id = ?").run(id);
        const ins = db.prepare("INSERT INTO turns (session_id, start_ms, end_ms, text) VALUES (?, ?, ?, ?)");
        // Turn times are relative to the audio; shift them onto the session clock.
        const off = audioOffsetMs ?? 0;
        for (const t of turns) ins.run(id, t.startMs + off, t.endMs + off, t.text);
        db.prepare("UPDATE sessions SET transcript = ?, transcribe_error = NULL WHERE id = ?").run(transcript, id);
      } catch (e) {
        db.prepare("UPDATE sessions SET transcribe_error = ? WHERE id = ?").run((e as Error).message, id);
      }
    }
    return send(res, 200, full(id));
  }

  if (m === "GET" && p[3] === "files" && p[4] && /^[\w.-]+\.(png|wav)$/.test(p[4])) {
    const f = join(sessionDir(id), p[4]);
    if (!existsSync(f)) throw new HttpError(404, "no such file");
    return send(res, 200, readFileSync(f), p[4].endsWith(".png") ? "image/png" : "audio/wav");
  }

  throw new HttpError(404, "not found");
}

// ponytail: no auth and no CORS headers; bound to 127.0.0.1 for local demo use only.
createServer((req, res) => {
  route(req, res).catch((e) => send(res, e instanceof HttpError ? e.status : 500, { error: e.message }));
}).listen(PORT, "127.0.0.1", () => console.log(`showrun backend on http://127.0.0.1:${PORT}`));
