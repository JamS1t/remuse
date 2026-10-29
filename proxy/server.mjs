// Remuse model proxy: holds the Meta API key so people who install Remuse never handle one.
// Forwards only the two endpoints the Agent uses, with per-address limits so the key can't be drained.
// Env: META_API_KEY (required), PROXY_TOKEN (default "showrun-demo"), PORT (default 8787),
//      PER_MINUTE (default 60), PER_DAY (default 1500).
import { createServer } from "node:http";

const KEY = process.env.META_API_KEY;
if (!KEY) { console.error("META_API_KEY is not set"); process.exit(1); }
const TOKEN = process.env.PROXY_TOKEN ?? "showrun-demo";
const PORT = Number(process.env.PORT ?? 8787);
const PER_MINUTE = Number(process.env.PER_MINUTE ?? 60);
const PER_DAY = Number(process.env.PER_DAY ?? 1500);
const MAX_BODY = 40 * 1024 * 1024; // audio for transcription can be large
const ROUTES = new Set(["/v1/responses", "/v1/asr/transcribe"]);

// ponytail: in-memory counters, reset on restart; fine for one small box, Redis if this ever scales out.
const hits = new Map(); // ip -> { minute, minuteCount, day, dayCount }
function allowed(ip) {
  const now = Date.now(), minute = Math.floor(now / 60000), day = Math.floor(now / 86400000);
  const h = hits.get(ip) ?? { minute, minuteCount: 0, day, dayCount: 0 };
  if (h.minute !== minute) { h.minute = minute; h.minuteCount = 0; }
  if (h.day !== day) { h.day = day; h.dayCount = 0; }
  if (h.minuteCount >= PER_MINUTE || h.dayCount >= PER_DAY) return false;
  h.minuteCount++; h.dayCount++;
  hits.set(ip, h);
  return true;
}

const fail = (res, status, error) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error })); };

createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") return fail(res, 200, null);
    if (req.method !== "POST" || !ROUTES.has(req.url)) return fail(res, 404, "not found");
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return fail(res, 401, "not a Remuse Agent");
    const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim();
    if (!allowed(ip)) return fail(res, 429, "Remuse's shared model allowance is used up for now. Try again later, or add your own MODEL_API_KEY.");

    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > MAX_BODY) return fail(res, 413, "request too large"); chunks.push(c); }
    const upstream = await fetch(`https://api.meta.ai${req.url}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": req.headers["content-type"] ?? "application/json" },
      body: Buffer.concat(chunks),
    });
    res.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") ?? "application/json" });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (e) {
    console.error(e);
    if (!res.headersSent) fail(res, 502, "the model service didn't answer");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Remuse proxy on 127.0.0.1:${PORT}`));
