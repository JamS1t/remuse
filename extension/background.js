// Recording controller: owns the session, takes screenshots, forwards events to the backend.
const API = "http://127.0.0.1:3200/api";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The worker can be stopped between events, so the live session is kept in session storage.
let rec; // undefined = not loaded yet, null = not recording
async function current() {
  if (rec === undefined) rec = (await chrome.storage.session.get("rec")).rec ?? null;
  return rec;
}
async function save(r) { rec = r; await chrome.storage.session.set({ rec: r }); }

async function api(path, method, body) {
  const res = await fetch(API + path, { method, body: typeof body === "string" || body instanceof Blob ? body : JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

// Chrome allows about 2 captureVisibleTab calls per second; queue them.
let queue = Promise.resolve();
let lastShot = 0;
function screenshot(windowId) {
  const shot = queue.then(async () => {
    const wait = lastShot + 520 - Date.now();
    if (wait > 0) await sleep(wait);
    lastShot = Date.now();
    return chrome.tabs.captureVisibleTab(windowId, { format: "png" }).catch(() => null);
  });
  queue = shot.catch(() => null);
  return shot;
}

const AFTER_DELAY = { click: 900, key: 900, page: 300 }; // let the screen settle before the "after" shot

async function onEvent(ev, sender) {
  const r = await current();
  if (!r || !sender.tab) return;
  const { at, kind, ...data } = ev;
  const before = kind === "click" || kind === "key" ? await screenshot(sender.tab.windowId) : null;
  const { id } = await api(`/sessions/${r.id}/events`, "POST", { t: at - r.t0, kind, ...data, before });
  if (!AFTER_DELAY[kind]) return;
  await sleep(AFTER_DELAY[kind]);
  const after = await screenshot(sender.tab.windowId);
  if (after) await api(`/sessions/${r.id}/events/${id}/after`, "PUT", { after });
}

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["USER_MEDIA"], justification: "Record the user's narration of the task" });
}

async function start(title) {
  if (await current()) throw new Error("already recording");
  const t0 = Date.now();
  const { id } = await api("/sessions", "POST", { title, startedAt: t0 });
  const r = { id, t0, audioOffsetMs: null, audioError: null };
  await save(r);

  await ensureOffscreen();
  const a = await chrome.runtime.sendMessage({ target: "offscreen", type: "start", sessionId: id });
  if (a?.error) {
    r.audioError = a.error;
    // Offscreen pages can't show the mic prompt; a normal tab can, once per install.
    if (a.error.startsWith("NotAllowedError")) chrome.tabs.create({ url: "mic.html" });
  } else r.audioOffsetMs = a.startedAt - t0;
  await save(r);

  // Screen at the start, before anything is clicked.
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.url?.startsWith("http")) {
    const after = await screenshot(tab.windowId);
    await api(`/sessions/${id}/events`, "POST", { t: 0, kind: "start", url: tab.url, title: tab.title, after });
  }
  return r;
}

async function stop() {
  const r = await current();
  if (!r) throw new Error("not recording");
  await save(null);
  await queue; // let pending screenshots land
  if (await chrome.offscreen.hasDocument()) {
    const a = await chrome.runtime.sendMessage({ target: "offscreen", type: "stop" });
    if (a?.error) r.audioError = a.error;
    await chrome.offscreen.closeDocument();
  }
  await sleep(1000); // last "after" shots
  const s = await api(`/sessions/${r.id}/finish`, "POST", { endedAt: Date.now(), audioOffsetMs: r.audioOffsetMs });
  const result = { id: r.id, events: s.events.length, turns: s.turns.length, transcript: s.transcript, error: r.audioError ?? s.transcribe_error };
  await chrome.storage.local.set({ last: result });
  return result;
}

async function status() {
  const r = await current();
  return { recording: !!r, rec: r, last: (await chrome.storage.local.get("last")).last ?? null };
}

// Exposed for tests and the DevTools console.
globalThis.showrun = { start, stop, status };

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === "event") { onEvent(msg.ev, sender).catch((e) => console.warn("event dropped:", e.message)); return; }
  const fn = { start: () => start(msg.title), stop, status }[msg.type];
  if (!fn || msg.target === "offscreen") return;
  fn().then(reply, (e) => reply({ error: e.message }));
  return true;
});
