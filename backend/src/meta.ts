// Meta Model API client. Docs: https://dev.meta.ai/docs/models
// With your own MODEL_API_KEY the Agent calls Meta directly. Without one it goes through the Remuse
// proxy, which holds the key, so people who just install Remuse never handle an API key.
const DIRECT = !!process.env.MODEL_API_KEY;
const BASE = DIRECT ? "https://api.meta.ai/v1" : (process.env.SHOWRUN_PROXY ?? "https://showrun.sitsit.dev/v1");
export const SPARK = process.env.SPARK_MODEL ?? "muse-spark-1.3";

// The checker: a second model that checks the first one's work, independently (it never sees the first answer's
// reasoning). Muse Spark Open, Meta's open-weight model, when a partner key is set: Baseten by default, or any
// OpenAI-style provider (Modal, Fireworks) through OPEN_MODEL_URL. Without one, Muse Spark itself, asked fresh.
const OPEN_URL = () => (process.env.OPEN_MODEL_URL || "https://inference.baseten.co/v1").replace(/\/+$/, "");
export const OPEN_MODEL = process.env.OPEN_MODEL || "meta-models/muse-spark-open-1026";
const openKey = () => process.env.OPEN_MODEL_KEY || process.env.BASETEN_API_KEY || "";
// independent: a different model from the one doing the work. Only then is a second opinion worth asking for.
export const checker = () => (openKey() ? { name: "Muse Spark Open", model: OPEN_MODEL, independent: true } : { name: "Muse Spark", model: SPARK, independent: false });

const key = (): string => process.env.MODEL_API_KEY || process.env.SHOWRUN_TOKEN || "showrun-demo";

export type Part = { type: "input_text"; text: string } | { type: "input_image"; image_url: string };
export const text = (t: string): Part => ({ type: "input_text", text: t });
export const png = (buf: Uint8Array): Part => ({ type: "input_image", image_url: `data:image/png;base64,${Buffer.from(buf).toString("base64")}` });

// Every call is logged so the UI can show what the models did and what it cost.
export const calls: { at: number; model: string; label: string; ms: number; tokens?: number; error?: string }[] = [];

export async function respond(content: Part[], label: string, model = SPARK): Promise<string> {
  if (model === OPEN_MODEL && openKey()) return chat(content, label, model);
  const t0 = Date.now();
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: [{ type: "message", role: "user", content }] }),
    });
    const body = await res.text();
    // ponytail: one retry on rate limit / server error; a real queue if runs get parallel
    if ((res.status === 429 || res.status >= 500) && attempt < 2) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
    if (!res.ok) {
      calls.push({ at: t0, model, label, ms: Date.now() - t0, error: `HTTP ${res.status}` });
      throw new Error(`${label}: HTTP ${res.status} ${body.slice(0, 300)}`);
    }
    const d = JSON.parse(body);
    calls.push({ at: t0, model, label, ms: Date.now() - t0, tokens: d.usage?.total_tokens });
    return d.output_text ?? (d.output ?? []).flatMap((o: any) => o.content ?? []).map((c: any) => c.text ?? "").join("");
  }
}

/** Chat Completions (the format partners serve open-weight models in): same parts, as text and image_url. */
async function chat(content: Part[], label: string, model: string): Promise<string> {
  const t0 = Date.now();
  const messages = [{ role: "user", content: content.map((p) => (p.type === "input_text" ? { type: "text", text: p.text } : { type: "image_url", image_url: { url: p.image_url } })) }];
  for (let attempt = 0; ; attempt++) {
    let res: Response, body: string;
    try {
      res = await fetch(`${OPEN_URL()}/chat/completions`, {
        method: "POST", signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${openKey()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, max_tokens: 4096 }),
      });
      body = await res.text();
    } catch (e) { // network trouble or a hang: try again, then give up clearly
      if (attempt < 2) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
      calls.push({ at: t0, model, label, ms: Date.now() - t0, error: (e as Error).name });
      throw new Error(`${label}: ${model} didn't answer (${(e as Error).message})`);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 2) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue; }
    if (!res.ok) {
      calls.push({ at: t0, model, label, ms: Date.now() - t0, error: `HTTP ${res.status}` });
      throw new Error(`${label}: HTTP ${res.status} ${body.slice(0, 300)}`);
    }
    const d = JSON.parse(body);
    calls.push({ at: t0, model, label, ms: Date.now() - t0, tokens: d.usage?.total_tokens });
    const choice = d.choices?.[0];
    if (choice?.finish_reason === "length") throw new Error(`${label}: ${model} ran out of room before answering`);
    // The answer is in content; a reasoning model may leave content empty and answer in its reasoning field.
    const c = choice?.message?.content;
    const out = typeof c === "string" ? c : Array.isArray(c) ? c.map((x: any) => x.text ?? "").join("") : "";
    return out.trim() ? out : String(choice?.message?.reasoning_content ?? choice?.message?.reasoning ?? "");
  }
}

// Pull the JSON object out of a model reply (it may wrap it in prose or a code fence).
export function parseJson<T = any>(reply: string): T {
  const start = reply.indexOf("{"), end = reply.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`no JSON in reply: ${reply.slice(0, 200)}`);
  return JSON.parse(reply.slice(start, end + 1));
}

export async function askJson<T = any>(content: Part[], label: string, model = SPARK): Promise<T> {
  const reply = await respond(content, label, model);
  try { return parseJson<T>(reply); }
  catch (e) {
    // One repair round: show the model its own broken output.
    const fixed = await respond([text(`This should be one valid JSON object but failed to parse (${(e as Error).message}). Return only the corrected JSON.\n\n${reply}`)], `${label}:repair`, model);
    return parseJson<T>(fixed);
  }
}

export type Box = { x_min: number; y_min: number; x_max: number; y_max: number }; // 0-1000 grid

// Muse Spark grounding: find one element on a screenshot.
export async function ground(screenshot: Uint8Array, what: string): Promise<Box | null> {
  const r = await askJson<{ found: boolean; bbox?: Box[] }>([
    text(`Find ${what} on this screenshot of a web page. Reply with only JSON: {"found":true,"bbox":[{"x_min":int,"y_min":int,"x_max":int,"y_max":int}]} on the 0-1000 grid, or {"found":false} if it is not there.`),
    png(screenshot),
  ], "ground");
  return r.found && r.bbox?.[0] ? r.bbox[0] : null;
}

// SAM 3.1: boxes for every instance of a short noun phrase. Its boxes are in pixels; we return the 0-1000 grid.
export async function sam(image: Uint8Array, phrase: string): Promise<Box[]> {
  const raw = await respond([text(phrase), png(image)], "sam", "sam-3.1");
  const boxes: Box[] = [];
  for (const m of raw.matchAll(/<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)\|>/g)) {
    const [x1, y1, x2, y2, w, h] = m.slice(1).map(Number);
    boxes.push({ x_min: Math.round((x1 / w) * 1000), y_min: Math.round((y1 / h) * 1000), x_max: Math.round((x2 / w) * 1000), y_max: Math.round((y2 / h) * 1000) });
  }
  return boxes;
}

export type Turn = { startMs: number; endMs: number; text: string };

// Muse Voice Transcribe takes WAV only: mono, 16-bit, 16 or 24 kHz. Timestamps are per turn.
export async function transcribe(wav: Uint8Array): Promise<{ transcript: string; turns: Turn[] }> {
  const t0 = Date.now();
  const form = new FormData();
  form.append("request", new Blob([JSON.stringify({ mode: "ENDPOINTING", model: "muse-voice-transcribe-1.0", audioEncoding: "WAV" })], { type: "application/json" }));
  form.append("audio", new Blob([wav], { type: "audio/wav" }), "narration.wav");
  const res = await fetch(`${BASE}/asr/transcribe`, { method: "POST", headers: { Authorization: `Bearer ${key()}` }, body: form });
  const body = await res.text();
  calls.push({ at: t0, model: "muse-voice-transcribe-1.0", label: "transcribe", ms: Date.now() - t0, error: res.ok ? undefined : `HTTP ${res.status}` });
  if (!res.ok) throw new Error(`transcribe: HTTP ${res.status} ${body.slice(0, 300)}`);
  const d = JSON.parse(body);
  const turns: Turn[] = (d.turns ?? []).map((t: any) => ({ startMs: t.startMs, endMs: t.endMs, text: t.transcript }));
  return { transcript: d.transcript ?? "", turns };
}
