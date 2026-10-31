// Recording controller: owns the session, takes screenshots, forwards events to the backend.
import "./drive.js"; // runs tasks in this Chrome for the Agent
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

const AFTER_DELAY = { click: 900, key: 900, page: 300, upload: 1500 }; // let the screen settle before the "after" shot

async function onEvent(ev, sender) {
  const r = await current();
  if (!r || !sender.tab) return;
  // Only the tab you're looking at: other open tabs load and refresh by themselves, and what's in them
  // (your messages, other accounts) is none of the recording's business.
  if (!sender.tab.active) return;
  const { at, kind, ...data } = ev;
  const before = kind === "click" || kind === "key" || kind === "mark" ? await screenshot(sender.tab.windowId) : null; // a mark's picture shows the ink
  const { id } = await api(`/sessions/${r.id}/events`, "POST", { t: at - r.t0, kind, ...data, tab: sender.tab.id, before });
  if (!AFTER_DELAY[kind]) return;
  await sleep(AFTER_DELAY[kind]);
  const after = await screenshot(sender.tab.windowId);
  if (after) await api(`/sessions/${r.id}/events/${id}/after`, "PUT", { after });
}

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["USER_MEDIA"], justification: "Record the user's narration of the task" });
}

// The offscreen recorder can't show Chrome's microphone prompt. Ask once in a normal tab before the first
// recording; when it's allowed, come back to the page you were on and start by itself.
async function micAllowed() {
  await ensureOffscreen();
  const a = await chrome.runtime.sendMessage({ target: "offscreen", type: "mic" }).catch(() => null);
  return a?.state === "granted";
}
let pendingStart = null; // { title, tabId } while the mic tab is open

// Tabs opened before the extension was installed or reloaded have no working recorder (Chrome cuts
// the old one off). Attach a fresh one to every open web page.
async function attachToOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  // A tab still loading, or showing a dialog, takes its recorder only once that's over, which may be never:
  // don't hold up the recording for it.
  await Promise.race([Promise.all(tabs.map((t) => chrome.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, files: ["content.js"] }).catch(() => {}))), sleep(1500)]);
}
chrome.runtime.onInstalled.addListener(() => { attachToOpenTabs(); });

// Closing the mic tab without answering cancels the pending start, so nothing stays "waiting for mic".
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const p = pendingStart ?? (await chrome.storage.session.get("pendingStart")).pendingStart;
  if (p?.micTabId === tabId) { pendingStart = null; await chrome.storage.session.remove("pendingStart"); }
});

async function start(title, { skipMicCheck = false } = {}) {
  if (await current()) throw new Error("already recording");
  hush(); // "let me show you again" while Remuse is still talking
  if (!skipMicCheck && !(await micAllowed())) {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const mic = await chrome.tabs.create({ url: "mic.html" });
    pendingStart = { title, tabId: tab?.id, micTabId: mic.id };
    await chrome.storage.session.set({ pendingStart });
    return { needsMic: true };
  }
  await attachToOpenTabs();
  const t0 = Date.now();
  const { id } = await api("/sessions", "POST", { title, startedAt: t0 });
  const r = { id, t0, audioOffsetMs: null, audioError: null };
  await save(r);
  broadcast(true);

  await ensureOffscreen();
  const a = await chrome.runtime.sendMessage({ target: "offscreen", type: "start", sessionId: id, t0 });
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

// Stop can come from the button, the shortcut and "I'm done" at the same moment: they all share one stop.
// Cancel is a stop that throws the recording away instead of learning it.
let stopping = null;
function stop(opts) { return (stopping ??= finish(opts).finally(() => { stopping = null; })); }
const cancel = (opts) => stop({ ...opts, discard: true });
async function finish({ byVoice = false, discard = false } = {}) {
  const r = await current();
  if (!r) throw new Error("not recording");
  await save(null);
  broadcast(false);
  await queue; // let pending screenshots land
  if (await chrome.offscreen.hasDocument()) {
    const a = await chrome.runtime.sendMessage({ target: "offscreen", type: "stop" });
    if (a?.error) r.audioError = a.error;
    await chrome.offscreen.closeDocument();
  }
  if (discard) {
    await api(`/sessions/${r.id}`, "DELETE").catch(() => {});
    const result = { id: r.id, learning: false, discarded: true, cancelled: true, error: null, byVoice, at: Date.now() };
    await chrome.storage.local.set({ last: result });
    return result;
  }
  await sleep(1000); // last "after" shots
  // The Agent learns the task on its own from here: names it, writes the spec, builds and tests it.
  // The recording is over either way; a failure here is reported, not left as a stuck "recording".
  let finishError = null;
  const done = await api(`/sessions/${r.id}/finish`, "POST", { endedAt: Date.now(), audioOffsetMs: r.audioOffsetMs }).catch((e) => { finishError = e.message; return null; });
  // Nothing was done in the recording: the Agent dropped it rather than keep an empty task.
  const result = { id: r.id, learning: !finishError && !done?.discarded, discarded: !!done?.discarded, error: finishError ?? r.audioError ?? null, byVoice, at: Date.now() };
  if (result.learning) setMode("learning"); // a second press right away mustn't start another recording
  await chrome.storage.local.set({ last: result });
  return result;
}

async function status() {
  const r = await current();
  return { recording: !!r, rec: r, hearing, level: micLevel, mic, speaking: talk ? { line: talk.line, total: talk.total } : null, mode, last: (await chrome.storage.local.get("last")).last ?? null };
}

// Every page knows whether you're teaching (drawing on the page only works then).
async function broadcast(on) {
  for (const t of await chrome.tabs.query({}).catch(() => [])) chrome.tabs.sendMessage(t.id, { type: "recording", on }).catch(() => {});
}

// ---- Remuse speaks: the review reads its plan aloud. Chrome's own voices, no click needed in the page. ----
// While it talks the microphone holds off, so Remuse never hears itself as you.
let talk = null; // { line, total, end } while speaking
let voice = null; // Google US English if there is one, else the first English voice; asked again until found
async function pickVoice() {
  if (voice) return voice; // Chrome can list its voices late, right after it starts: an empty list isn't kept
  const all = await chrome.tts.getVoices();
  voice = all.find((v) => v.voiceName === "Google US English") ?? all.find((v) => (v.lang ?? "").startsWith("en")) ?? null;
  return voice;
}
const hold = (on) => chrome.runtime.sendMessage({ target: "offscreen", type: "hold", on }).catch(() => {});
async function speak(lines) {
  hush();
  const list = (lines ?? []).map(String).filter((l) => l.trim());
  const v = await pickVoice();
  if (!list.length || !v) return { spoken: 0 };
  return new Promise((resolve) => {
    let spoken = 0;
    const me = { line: 0, total: list.length, end: () => { if (talk !== me) return; talk = null; hold(false); resolve({ spoken }); } };
    talk = me;
    hold(true);
    list.forEach((text, i) => chrome.tts.speak(text, {
      voiceName: v.voiceName, enqueue: true,
      onEvent: (e) => {
        if (talk !== me) return;
        if (e.type === "start") me.line = i;
        else if (e.type === "end") { spoken = i + 1; if (i === list.length - 1) me.end(); }
        else if (e.type === "interrupted" || e.type === "cancelled" || e.type === "error") me.end();
      },
    }));
  });
}
function hush() {
  const t = talk;
  if (t) { chrome.tts.stop(); t.end(); }
  return { ok: true };
}

// What the sidebar is showing, which it says itself: "idle", "learning", "review" or "practice".
// Kept in session storage too: Chrome stops this worker after a while, and a review mustn't be lost to a key press then.
let mode = "idle";
function setMode(m) {
  mode = ["idle", "learning", "review", "practice"].includes(m) ? m : "idle";
  chrome.storage.session.set({ mode }).catch(() => {});
  return { mode };
}
const currentMode = async () => (await chrome.storage.session.get("mode").catch(() => ({}))).mode ?? mode;

// Shortcuts. Teach (Alt+Shift+R) does the obvious thing: start teaching, or stop. While Remuse is learning, reviewing
// or practicing it only opens the sidebar: a new recording would throw away the review. Pen (Alt+Shift+D): draw.
async function command(name) {
  if (name === "pen") {
    if (!(await current())) return { did: "nothing" };
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id != null) await chrome.tabs.sendMessage(tab.id, { type: "pen" }).catch(() => {});
    return { did: "pen" };
  }
  if (name !== "teach") return { did: "nothing" };
  if (talk) { hush(); return { did: "hush" }; } // Remuse is talking: the key cuts it off, and you talk
  if (await current()) { await stop(); return { did: "stop" }; }
  if ((await currentMode()) === "idle") { await start(""); return { did: "start" }; }
  return { did: "nothing" };
}
chrome.commands.onCommand.addListener((name, tab) => {
  // The side panel opens only in answer to the key press itself, so before anything is awaited.
  if (tab?.windowId != null) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  command(name).catch((e) => console.warn(`${name}:`, e.message));
});

// ---- Connected sites: the Agent works with your logins for these, and only these. ----

// "www.lazada.com.ph" -> "lazada.com.ph", "m.facebook.com" -> "facebook.com"
function siteOf(url) {
  let host;
  try { host = new URL(url).hostname; } catch { return null; }
  if (!host.includes(".") || /^[\d.]+$/.test(host)) return null;
  const parts = host.split(".");
  const n = parts.length >= 3 && parts.at(-1).length === 2 && /^(com|co|net|org|gov|edu|ac)$/.test(parts.at(-2)) ? 3 : 2;
  return parts.slice(-n).join(".");
}
// Google signs the account out everywhere when its login turns up in a second browser, so Google logins are
// never copied: "Use my login" opens Remuse's own browser at Google's sign-in page instead.
const GOOGLE = /^(google[.][a-z.]+|youtube[.]com|gmail[.]com|blogger[.]com)$/;
const sites = async () => ((await chrome.storage.local.get("sites")).sites ?? []).filter((s) => !GOOGLE.test(s));

// Hand the Agent this site's current login. It stays on this computer.
async function share(site) {
  const cookies = await chrome.cookies.getAll({ domain: site });
  await api("/logins", "POST", { site, cookies });
  return cookies.length;
}

async function connect(site) {
  if (!site) throw new Error("this page can't be connected");
  if (GOOGLE.test(site)) {
    // The Google account this Chrome is signed in with, so the sign-in page starts at the passkey or phone prompt.
    const email = (await chrome.identity?.getProfileUserInfo({ accountStatus: "ANY" }).catch(() => null))?.email ?? "";
    await api(`/browser/google?site=${encodeURIComponent(site)}&email=${encodeURIComponent(email)}`, "POST");
    return { site, signin: true };
  }
  const list = await sites();
  if (!list.includes(site)) await chrome.storage.local.set({ sites: [...list, site] });
  return { site, cookies: await share(site) };
}
async function disconnect(site) {
  await chrome.storage.local.set({ sites: (await sites()).filter((s) => s !== site) });
  await api(`/logins/${encodeURIComponent(site)}`, "DELETE");
  return { ok: true };
}

// Keep the Agent's copy fresh: when you sign in again or a session renews, share it (debounced).
const pending = new Map();
chrome.cookies.onChanged.addListener(async ({ cookie }) => {
  const site = (await sites()).find((s) => cookie.domain.replace(/^\./, "").endsWith(s));
  if (!site) return;
  clearTimeout(pending.get(site));
  pending.set(site, setTimeout(() => { pending.delete(site); share(site).catch(() => {}); }, 4000));
});
// Agent may have been offline: re-share everything when Chrome starts.
chrome.runtime.onStartup.addListener(async () => { for (const s of await sites()) share(s).catch(() => {}); });

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return { url: tab?.url ?? null, title: tab?.title ?? null, site: tab?.url ? siteOf(tab.url) : null };
}

// The sidebar holds a port open while it's showing. Closing it ends the review's listening and talking, so nothing
// said in the room afterwards changes a task.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "panel") return;
  port.onDisconnect.addListener(() => { hush(); chrome.runtime.sendMessage({ target: "offscreen", type: "unlisten" }).catch(() => {}); });
});

// The toolbar icon opens the sidebar.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// Exposed for tests and the DevTools console.
globalThis.showrun = { start, stop, cancel, status, connect, disconnect, command, setMode, speak, hush };

// Whether you are talking right now (the offscreen recorder hears it first), for the sidebar to show.
let hearing = false, micLevel = 0, mic = null; // mic: why it isn't working right now, or null

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === "event") { onEvent(msg.ev, sender).catch((e) => console.warn("event dropped:", e.message)); return; }
  if (msg.type === "hearing") { hearing = !!msg.on; return; }
  if (msg.type === "level") { micLevel = msg.level; return; }
  if (msg.type === "mic") { mic = msg.ok ? null : msg.why ?? "the microphone stopped"; return; } // null: working
  // You said you're done. Only for the recording that is still running: a late one (Stop was pressed) is ignored.
  if (msg.type === "saidDone") {
    current().then((r) => { if (r?.id === msg.sessionId) return stop({ byVoice: true }); }).catch((e) => console.warn("couldn't stop:", e.message));
    return;
  }
  if (msg.type === "saidCancel") {
    current().then((r) => { if (r?.id === msg.sessionId) return cancel({ byVoice: true }); }).catch((e) => console.warn("couldn't cancel:", e.message));
    return;
  }
  if (msg.type === "micGranted") {
    // Back to the page the person was on, then start the recording they asked for.
    (async () => {
      const p = pendingStart ?? (await chrome.storage.session.get("pendingStart")).pendingStart;
      if (sender.tab?.id) chrome.tabs.remove(sender.tab.id).catch(() => {});
      // Only the mic tab this start opened may resume it; any other grant just closes its tab.
      if (!p || p.micTabId !== sender.tab?.id) return;
      pendingStart = null; await chrome.storage.session.remove("pendingStart");
      if (p.tabId) await chrome.tabs.update(p.tabId, { active: true }).catch(() => {});
      // The person just allowed it: don't re-check and risk reopening the mic tab in a loop.
      await start(p.title, { skipMicCheck: true }).catch((e) => console.warn("couldn't start after the mic was allowed:", e.message));
    })();
    return;
  }
  const fn = {
    start: () => start(msg.title), stop, cancel: () => cancel(), status: async () => ({ ...(await status()), waitingForMic: !!(pendingStart ?? (await chrome.storage.session.get("pendingStart")).pendingStart) }),
    sites: async () => ({ sites: await sites() }),
    connect: async () => connect(msg.site ?? (await currentTab()).site),
    disconnect: () => disconnect(msg.site),
    currentTab,
    mode: async () => setMode(msg.mode),
    speak: () => speak(msg.lines),
    hush: async () => hush(),
    keys: async () => Object.fromEntries((await chrome.commands.getAll()).map((c) => [c.name, c.shortcut || ""])),
    // Hands-free conversation about a learned task: listen until told to stop (see offscreen.js).
    listen: async () => {
      if (await current()) return { ok: false };
      if (!(await micAllowed())) throw new Error("Allow the microphone first: press Watch me do a task once.");
      const a = await chrome.runtime.sendMessage({ target: "offscreen", type: "converse", sessionId: msg.sessionId });
      if (a?.error) throw new Error(a.error);
      if (talk) hold(true); // opened while Remuse is still talking: it waits until it's done
      return { ok: true };
    },
    unlisten: async () => {
      if (await chrome.offscreen.hasDocument()) await chrome.runtime.sendMessage({ target: "offscreen", type: "unlisten" }).catch(() => {});
      return { ok: true };
    },
    openTab: async () => { if (/^https?:\/\//.test(msg.url ?? "")) await chrome.tabs.create({ url: msg.url }); return { ok: true }; },
  }[msg.type];
  if (!fn || msg.target === "offscreen") return;
  fn().then(reply, (e) => reply({ error: e.message }));
  return true;
});
