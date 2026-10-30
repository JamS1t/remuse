// Records the microphone while a session runs, then uploads it as WAV (16 kHz mono, 16-bit),
// the only format Muse Voice Transcribe takes.
// Raw samples are kept as they arrive (no MediaRecorder file to decode later), placed by the clock, so the
// voice stays lined up with the clicks. If the microphone drops out (a headset reconnects, Windows hands
// the mic to another app), recording picks it up again and the gap stays silent instead of losing the rest.
const API = "http://127.0.0.1:3200/api";
let ctx, stream, node, parts, t0, sessionId, drops, sent, ticker;

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.target !== "offscreen") return;
  const job = msg.type === "mic" ? navigator.permissions.query({ name: "microphone" }).then((p) => ({ state: p.state }))
    : msg.type === "start" ? start(msg.sessionId) : stop();
  job.then(reply, (e) => reply({ error: `${e.name}: ${e.message}` }));
  return true;
});

async function start(id) {
  sessionId = id; parts = []; drops = 0; sent = 0;
  ctx = new AudioContext();
  await ctx.resume();
  await ctx.audioWorklet.addModule("recorder-worklet.js");
  t0 = ctx.currentTime;
  await listen();
  ticker = setInterval(sendPiece, 8000);
  return { startedAt: Date.now() };
}

async function listen() {
  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const src = ctx.createMediaStreamSource(stream);
  node = new AudioWorkletNode(ctx, "remuse-recorder", { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: "explicit" });
  node.port.onmessage = (e) => parts.push({ at: e.data.at - t0, pcm: e.data.pcm });
  src.connect(node);
  stream.getAudioTracks()[0].onended = () => { if (!ctx) return; drops++; node.disconnect(); listen().catch(() => {}); };
}

// Every few seconds, the voice since last time goes to the Agent, so the sidebar can follow along live.
async function sendPiece() {
  const piece = parts.slice(sent);
  if (!ctx || !piece.length) return;
  sent += piece.length;
  const raw = new Float32Array(piece.reduce((n, p) => n + p.pcm.length, 0));
  let o = 0; for (const p of piece) { raw.set(p.pcm, o); o += p.pcm.length; }
  if (raw.length < ctx.sampleRate) return; // under a second: nothing worth hearing
  const wav = await toWav(raw, ctx.sampleRate);
  fetch(`${API}/sessions/${sessionId}/live?at=${Math.round(piece[0].at * 1000)}`, { method: "POST", body: wav }).catch(() => {});
}

async function stop() {
  if (!ctx) return { bytes: 0 };
  clearInterval(ticker);
  const rate = ctx.sampleRate, total = ctx.currentTime - t0;
  const c = ctx; ctx = null;
  node.disconnect(); stream.getTracks().forEach((t) => t.stop()); await c.close();
  // Lay every block at its time on one track; anything the mic missed stays silent.
  const raw = new Float32Array(Math.ceil(total * rate));
  for (const p of parts) { const i = Math.round(p.at * rate); if (i >= 0 && i < raw.length) raw.set(p.pcm.subarray(0, raw.length - i), i); }
  const wav = await toWav(raw, rate);
  const res = await fetch(`${API}/sessions/${sessionId}/audio`, { method: "PUT", body: wav });
  if (!res.ok) throw new Error(`upload failed: HTTP ${res.status}`);
  return { bytes: wav.size, seconds: Math.round(total), drops };
}

async function toWav(raw, from, rate = 16000) {
  // An offline context resamples to 16 kHz in one pass.
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil((raw.length / from) * rate)), rate);
  const b = off.createBuffer(1, Math.max(1, raw.length), from);
  b.copyToChannel(raw, 0);
  const src = off.createBufferSource();
  src.buffer = b; src.connect(off.destination); src.start();
  const pcm = (await off.startRendering()).getChannelData(0);

  const buf = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const str = (o, s) => [...s].forEach((c, i) => buf.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); buf.setUint32(4, 36 + pcm.length * 2, true); str(8, "WAVE");
  str(12, "fmt "); buf.setUint32(16, 16, true); buf.setUint16(20, 1, true); buf.setUint16(22, 1, true);
  buf.setUint32(24, rate, true); buf.setUint32(28, rate * 2, true); buf.setUint16(32, 2, true); buf.setUint16(34, 16, true);
  str(36, "data"); buf.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) buf.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return new Blob([buf], { type: "audio/wav" });
}
