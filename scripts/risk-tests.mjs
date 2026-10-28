// Day-1 risk tests against the Meta Model API. Run from the repo root:
//   node --env-file=.env scripts/risk-tests.mjs   (.env holds MODEL_API_KEY=...)
// Prints a verdict per risk and the token usage of every call. Docs: https://dev.meta.ai/docs/models
import { readFileSync } from "node:fs";

const KEY = process.env.MODEL_API_KEY;
if (!KEY) { console.error("Set MODEL_API_KEY first."); process.exit(1); }
const BASE = "https://api.meta.ai/v1";
const SPARK = process.env.SPARK_MODEL ?? "muse-spark-1.3";
const fx = (f) => new URL(`./fixtures/${f}`, import.meta.url);
const dataUrl = (f, mime) => `data:${mime};base64,${readFileSync(fx(f)).toString("base64")}`;
const usage = [];

async function respond(model, content, label) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: [{ type: "message", role: "user", content }] }),
  });
  const ms = Math.round(performance.now() - t0);
  const body = await res.text();
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status} ${body.slice(0, 400)}`);
  const data = JSON.parse(body);
  const text = data.output_text ?? (data.output ?? []).flatMap((o) => o.content ?? []).map((c) => c.text ?? "").join("");
  usage.push({ label, model, ms, ...data.usage });
  return { text, ms };
}

const text = (t) => ({ type: "input_text", text: t });
const image = (f) => ({ type: "input_image", image_url: dataUrl(f, "image/png") });

async function run(name, fn) {
  console.log(`\n=== ${name}`);
  try { await fn(); } catch (e) { console.log("FAIL:", e.message); }
}

// Risk 1: can Muse Spark take a screen recording as video?
await run("1. Muse Spark video input", async () => {
  const ask = "This is a screen recording of a support agent. List, in order, each web app shown and the one key fact visible in each (order number, date, delivery status).";
  const v = await respond(SPARK, [text(ask), { type: "input_video", video_url: dataUrl("session.mp4", "video/mp4") }], "video");
  console.log(`video (${v.ms} ms):\n${v.text}`);
  const f = await respond(SPARK, [text(ask), image("inbox-email.png"), image("store-order.png"), image("courier.png")], "frames");
  console.log(`\nkey frames instead (${f.ms} ms):\n${f.text}`);
  console.log("\nVerdict: compare both. Expected facts: KG-10401, 2026-10-23, Delivered.");
});

// Risk 2: can SAM 3.1 find UI buttons? And can Muse Spark box them itself (the fallback)?
// Ground truth from the DOM: Replace button at x 505-563, y 511-551 on Meta's 0-1000 grid.
const inReplace = ({ x, y }) => x >= 495 && x <= 573 && y >= 501 && y <= 561;
let latency = [];
await run("2. Element finding on a UI screenshot", async () => {
  try {
    const sam = await respond("sam-3.1", [text("button"), image("store-order.png")], "sam");
    console.log(`SAM 3.1 "button" (${sam.ms} ms), raw output start:\n${sam.text.slice(0, 600)}`);
    console.log("Verdict for SAM: expect 2 boxes (Refund, Replace). Raw format is special tokens; see docs 'reading segmentation output'.");
  } catch (e) { console.log("SAM FAIL:", e.message); }

  for (let i = 0; i < 3; i++) {
    const g = await respond(SPARK, [
      text('Find the "Replace" button. Reply with only JSON: {"bbox":[{"x_min":int,"y_min":int,"x_max":int,"y_max":int}]} on the 0-1000 grid.'),
      image("store-order.png"),
    ], `ground-${i}`);
    latency.push(g.ms);
    const box = JSON.parse(g.text.match(/\{[\s\S]*\}/)?.[0] ?? "{}").bbox?.[0];
    const center = box && { x: (box.x_min + box.x_max) / 2, y: (box.y_min + box.y_max) / 2 };
    console.log(`Spark grounding #${i + 1} (${g.ms} ms): ${JSON.stringify(box)} -> ${center && inReplace(center) ? "HIT" : "MISS"}`);
  }
});

// Risk 3: latency per step. Uses the grounding calls above (one screenshot each).
await run("3. Muse Spark latency per step", async () => {
  if (!latency.length) throw new Error("no successful grounding calls to time");
  const sorted = [...latency].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  console.log(`calls: ${latency.join(", ")} ms, median ${median} ms`);
  console.log(`Verdict: 15 emails x ~12 checked steps = ~180 calls = ~${Math.round((180 * median) / 60000)} min of model time for the batch.`);
});

// Bonus: the voice step. Docs say WAV, mono, 16-bit, 16 or 24 kHz; turn-level timestamps only.
await run("Bonus. Muse Voice Transcribe", async () => {
  const form = new FormData();
  form.append("request", new Blob([JSON.stringify({ mode: "ENDPOINTING", model: "muse-voice-transcribe-1.0", audioEncoding: "WAV" })], { type: "application/json" }));
  form.append("audio", new Blob([readFileSync(fx("narration.wav"))], { type: "audio/wav" }), "narration.wav");
  const t0 = performance.now();
  const res = await fetch(`${BASE}/asr/transcribe`, { method: "POST", headers: { Authorization: `Bearer ${KEY}` }, body: form });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${body.slice(0, 400)}`);
  const d = JSON.parse(body);
  console.log(`${Math.round(performance.now() - t0)} ms, ${d.audioDurationMs} ms audio, ${d.turns?.length ?? 0} turns`);
  console.log(d.transcript);
  for (const t of d.turns ?? []) console.log(`  [${t.startMs}-${t.endMs}] ${t.transcript}`);
});

// Risk 4: credit burn. Tokens per call; check prices at https://dev.meta.ai/docs/pricing-rate-limits
console.log("\n=== 4. Usage per call (check the Billing page too, and set a spend limit)");
console.table(usage);
