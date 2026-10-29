// Meta Model API client. Docs: https://dev.meta.ai/docs/models
const BASE = "https://api.meta.ai/v1";

function key(): string {
  const k = process.env.MODEL_API_KEY;
  if (!k) throw new Error("MODEL_API_KEY is not set (run with --env-file=../.env)");
  return k;
}

export type Turn = { startMs: number; endMs: number; text: string };

// Muse Voice Transcribe takes WAV only: mono, 16-bit, 16 or 24 kHz. Timestamps are per turn.
export async function transcribe(wav: Uint8Array): Promise<{ transcript: string; turns: Turn[] }> {
  const form = new FormData();
  form.append("request", new Blob([JSON.stringify({ mode: "ENDPOINTING", model: "muse-voice-transcribe-1.0", audioEncoding: "WAV" })], { type: "application/json" }));
  form.append("audio", new Blob([wav], { type: "audio/wav" }), "narration.wav");
  const res = await fetch(`${BASE}/asr/transcribe`, { method: "POST", headers: { Authorization: `Bearer ${key()}` }, body: form });
  const body = await res.text();
  if (!res.ok) throw new Error(`transcribe: HTTP ${res.status} ${body.slice(0, 300)}`);
  const d = JSON.parse(body);
  const turns: Turn[] = (d.turns ?? []).map((t: any) => ({ startMs: t.startMs, endMs: t.endMs, text: t.transcript }));
  return { transcript: d.transcript ?? "", turns };
}
