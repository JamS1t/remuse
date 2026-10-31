// Records the microphone while a session runs, then uploads it as WAV (16 kHz mono, 16-bit),
// the only format Muse Voice Transcribe takes.
// Raw samples are kept as they arrive (no MediaRecorder file to decode later), placed by the clock, so the
// voice stays lined up with the clicks. If the microphone drops out (a headset reconnects, Windows hands
// the mic to another app), recording picks it up again and the gap stays silent instead of losing the rest.
const API = "http://127.0.0.1:3200/api";
let ctx, stream, node, parts, t0, sessionId, drops, converse = false, offsetMs = 0, held = false;

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.target !== "offscreen") return;
  const job = msg.type === "mic" ? navigator.permissions.query({ name: "microphone" }).then((p) => ({ state: p.state }))
    : msg.type === "start" ? start(msg.sessionId, false, msg.t0) : msg.type === "converse" ? start(msg.sessionId, true)
    : msg.type === "hold" ? Promise.resolve(hold(!!msg.on))
    : msg.type === "unlisten" ? (converse ? stop() : Promise.resolve({ ok: true })) : stop();
  job.then(reply, (e) => reply({ error: `${e.name}: ${e.message}` }));
  return true;
});

// t0: when the recording started (session clock), so each sentence is placed on the same clock as the clicks.
async function start(id, talk = false, sessionT0 = Date.now()) {
  if (ctx) await stop().catch(() => {}); // one microphone user at a time: a new recording ends the conversation
  sessionId = id; parts = []; drops = 0; converse = talk; speaking = false; loud = 0; quiet = 0; held = false;
  ctx = new AudioContext();
  await ctx.resume();
  await ctx.audioWorklet.addModule("recorder-worklet.js");
  t0 = ctx.currentTime;
  offsetMs = Date.now() - sessionT0;
  await listen();
  return { startedAt: Date.now() };
}

async function listen() {
  stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const src = ctx.createMediaStreamSource(stream);
  node = new AudioWorkletNode(ctx, "remuse-recorder", { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: "explicit" });
  node.port.onmessage = (e) => { const p = { at: e.data.at - t0, pcm: e.data.pcm }; parts.push(p); hearing(p); };
  src.connect(node);
  stream.getAudioTracks()[0].onended = () => { if (!ctx) return; drops++; node.disconnect(); listen().catch(() => {}); };
}

// While Remuse speaks, what the mic picks up is Remuse itself: not heard until it's done.
function hold(on) {
  held = on;
  if (on && speaking) { speaking = false; tell(false); }
  loud = 0; quiet = 0;
  return { ok: true };
}
const tell = (on) => chrome.runtime.sendMessage({ type: "hearing", on }).catch(() => {});

// Each thing you say is cut out by the pauses around it (talking = louder than the room for a moment; done =
// quiet for 1.2 s) and sent to the Agent whole. While recording, the Agent takes notes from it and listens for
// "I'm done"; the whole track is still kept for learning. After learning (a conversation), the Agent works out
// what you meant, and nothing is kept between things you say.
let speaking = false, loud = 0, quiet = 0, noise = 0.004, from = 0;
function hearing(p) {
  if (held) { if (converse && parts.length > 40) parts.splice(0, parts.length - 10); return; }
  let sum = 0; for (const v of p.pcm) sum += v * v;
  const rms = Math.sqrt(sum / p.pcm.length), dt = p.pcm.length / ctx.sampleRate, block = Math.ceil(0.4 / dt);
  // The room's level: drops at once to anything quieter, creeps up over seconds, so a voice never becomes "the room".
  if (!speaking) noise += (rms - noise) * (rms < noise ? 0.05 : 0.0005);
  const voice = rms > Math.max(0.012, noise * 3);
  // Speech has tiny gaps between sounds: they only wear the count down, they don't reset it.
  if (voice) { loud += dt; quiet = 0; } else { quiet += dt; if (!speaking) loud = Math.max(0, loud - dt); }
  // Someone who talks on and on still gets heard: after 12 s a short breath (0.3 s) ends it, and 20 s always does.
  const long = speaking ? (parts.length - from) * dt : 0;
  if (!speaking && loud > 0.15) { speaking = true; tell(true); from = Math.max(0, parts.length - block - Math.ceil(loud / dt)); }
  else if (speaking && (quiet > 1.2 || (long > 12 && quiet > 0.3) || long > 20)) {
    speaking = false; loud = 0; tell(false);
    const said = parts.slice(from);
    if (converse) parts = []; // a recording keeps every block for the whole track
    send(said).catch(() => {});
  } else if (!speaking && converse && parts.length > block * 4) parts.splice(0, parts.length - block); // keep just a moment before you speak
}
async function send(said) {
  const raw = new Float32Array(said.reduce((n, p) => n + p.pcm.length, 0));
  let o = 0; for (const p of said) { raw.set(p.pcm, o); o += p.pcm.length; }
  if (!ctx || raw.length < ctx.sampleRate * 0.6) return; // a cough, a click
  const id = sessionId, wav = await toWav(raw, ctx.sampleRate);
  if (converse) { await fetch(`${API}/sessions/${id}/say`, { method: "POST", body: wav }); return; }
  const r = await fetch(`${API}/sessions/${id}/heard?at=${Math.round(said[0].at * 1000 + offsetMs)}`, { method: "POST", body: wav }).then((x) => x.json(), () => null);
  // "Okay, that's it": the recording ends just as if Stop was pressed. "Never mind": it ends and is thrown away.
  if (r?.control === "done") chrome.runtime.sendMessage({ type: "saidDone", sessionId: id }).catch(() => {});
  if (r?.control === "cancel") chrome.runtime.sendMessage({ type: "saidCancel", sessionId: id }).catch(() => {});
}

async function stop() {
  if (!ctx) return { bytes: 0 };
  if (speaking) { speaking = false; tell(false); }
  if (converse) { converse = false; const c = ctx; ctx = null; node.disconnect(); stream.getTracks().forEach((t) => t.stop()); await c.close(); return { ok: true }; }
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
