// Records the microphone while a session runs, then uploads it as WAV (16 kHz mono, 16-bit),
// the only format Muse Voice Transcribe takes.
// Raw samples are kept as they arrive (no MediaRecorder file to decode later), placed by the clock, so the
// voice stays lined up with the clicks. If the microphone drops out (a headset reconnects, Windows hands
// the mic to another app), recording picks it up again and the gap stays silent instead of losing the rest.
const API = "http://127.0.0.1:3200/api";
let ctx, stream, source, node, parts, t0, sessionId, drops, converse = false, offsetMs = 0, held = false;
let lastBlock = 0, zeros = 0, mendAt = 0;

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
  sessionId = id; parts = []; drops = 0; converse = talk; vad = makeVad(); held = false; level = 0;
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
  // Kept in a variable that lives as long as the recording: a source nothing points to can be cleaned away by Chrome,
  // and the mic goes silent mid-demo.
  source = ctx.createMediaStreamSource(stream);
  node = new AudioWorkletNode(ctx, "remuse-recorder", { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: "explicit" });
  node.port.onmessage = (e) => {
    lastBlock = Date.now();
    const p = { at: e.data.at - t0, pcm: e.data.pcm };
    zeros = p.pcm.every((v) => v === 0) ? zeros + p.pcm.length / ctx.sampleRate : 0;
    parts.push(p); hearing(p);
  };
  source.connect(node);
  const track = stream.getAudioTracks()[0];
  track.onended = () => mend("the microphone stopped");
  // Chrome or Windows muting the track is one of the possible causes: noted when it happens.
  track.onmute = () => chrome.runtime.sendMessage({ type: "mic", note: true, why: "track muted", detail: micState() }).catch(() => {});
  track.onunmute = () => chrome.runtime.sendMessage({ type: "mic", note: true, why: "track unmuted", detail: micState() }).catch(() => {});
  lastBlock = Date.now(); zeros = 0;
}

// A real mic always picks up something, even in a quiet room. No sound at all for a few seconds (no blocks, or only
// exact zeros) means the connection broke: reconnect it, and tell the sidebar, so you're never talking to nothing.
// What the mic looked like at that moment, for the log: which of the possible causes it was.
const micState = () => { const t = stream?.getAudioTracks()[0]; return { track: t?.readyState, muted: t?.muted, enabled: t?.enabled, label: t?.label, context: ctx?.state, sinceBlockMs: Date.now() - lastBlock, zerosS: +zeros.toFixed(1), recordingS: ctx ? +(ctx.currentTime - t0).toFixed(1) : null }; };
async function mend(why) {
  if (!ctx || Date.now() - mendAt < 4000) return;
  mendAt = Date.now(); drops++;
  chrome.runtime.sendMessage({ type: "mic", ok: false, why, detail: micState() }).catch(() => {});
  try { node?.disconnect(); source?.disconnect(); } catch { /* already gone */ }
  stream?.getTracks().forEach((t) => t.stop());
  try {
    if (ctx.state === "suspended") await ctx.resume();
    await listen();
    chrome.runtime.sendMessage({ type: "mic", ok: true, why: "reconnected", detail: micState() }).catch(() => {});
  } catch (e) { chrome.runtime.sendMessage({ type: "mic", ok: false, why: `${why}, and couldn't reconnect: ${e.message}` }).catch(() => {}); }
}
setInterval(() => {
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  if (Date.now() - lastBlock > 2500) mend("no sound came from the microphone");
  else if (zeros > 3) { mend("the microphone went silent"); zeros = 0; }
}, 1000);

// While Remuse speaks, what the mic picks up is Remuse itself: not heard until it's done.
function hold(on) {
  held = on;
  if (on && vad.state.speaking) tell(false);
  vad.reset();
  return { ok: true };
}
const tell = (on) => chrome.runtime.sendMessage({ type: "hearing", on }).catch(() => {});

// Each thing you say is cut out by the pauses around it (talking = louder than the room for a moment; done =
// quiet for 1.2 s) and sent to the Agent whole. While recording, the Agent takes notes from it and listens for
// "I'm done"; the whole track is still kept for learning. After learning (a conversation), the Agent works out
// what you meant, and nothing is kept between things you say.
// Speech detection is in vad.js (checked in node). Here: what each event means for the blocks kept so far.
let vad = makeVad(), from = 0, level = 0, levelAt = 0;
function hearing(p) {
  let sum = 0; for (const v of p.pcm) sum += v * v;
  const rms = Math.sqrt(sum / p.pcm.length), dt = p.pcm.length / ctx.sampleRate, block = Math.ceil(0.4 / dt);
  // The sidebar shows how loud the mic is, so you can see it hears you (a few times a second).
  level = Math.max(rms, level * 0.9);
  if (p.at - levelAt > 0.25) { levelAt = p.at; chrome.runtime.sendMessage({ type: "level", level: held ? 0 : level }).catch(() => {}); }
  if (held) { if (converse && parts.length > 40) parts.splice(0, parts.length - 10); return; }
  const e = vad.step(rms, dt);
  if (e === "start") { tell(true); from = Math.max(0, parts.length - block - Math.ceil(vad.state.loud / dt)); }
  else if (e === "end") {
    tell(false);
    const said = parts.slice(from);
    if (converse) parts = []; // a recording keeps every block for the whole track
    send(said).catch(() => {});
  } else if (e === "flush" && !converse) send(parts.slice(-Math.ceil(VAD_FLUSH / dt))).catch(() => {}); // sound that never became a sentence
  else if (!vad.state.speaking && converse && parts.length > block * 4) parts.splice(0, parts.length - block); // keep just a moment before you speak
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
  if (vad.state.speaking) { vad.reset(); tell(false); }
  if (converse) { converse = false; const c = ctx; ctx = null; node.disconnect(); stream.getTracks().forEach((t) => t.stop()); await c.close(); return { ok: true }; }
  const rate = ctx.sampleRate, total = ctx.currentTime - t0;
  const c = ctx; ctx = null;
  node.disconnect(); source?.disconnect(); stream.getTracks().forEach((t) => t.stop()); await c.close();
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
