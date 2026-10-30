// Runs tasks in this Chrome. The Agent links up over a socket and asks for tabs; each tab is driven with
// chrome.debugger, so sites see your real Chrome and your real logins. Remuse's tabs open in their own window
// that doesn't take focus, and close when the run ends. (Chrome shows "Remuse started debugging this browser"
// while it works; it can't be hidden.)
//
// Chrome stays running in the background after you close its windows (the "background" permission), so
// scheduled tasks still run; the first time that happens you get a notification saying so.
const LINK = "ws://127.0.0.1:3200/extension";
let sock = null;
const tabs = new Map(); // tabId -> targetId, the tabs Remuse drives
let runWindow = null;

const send = (m) => { if (sock?.readyState === 1) sock.send(JSON.stringify(m)); };

function link() {
  if (sock && sock.readyState <= 1) return;
  try { sock = new WebSocket(LINK); } catch { sock = null; return; }
  sock.onmessage = (ev) => onMessage(JSON.parse(ev.data));
  sock.onclose = () => { sock = null; };
  sock.onerror = () => {};
}
// Keep trying while the Agent is down (it starts with Windows; Chrome may start first).
chrome.alarms.create("remuse-link", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "remuse-link") link(); });
chrome.runtime.onStartup.addListener(link);
link();

async function attach(tabId) {
  await chrome.debugger.attach({ tabId }, "1.3");
  const t = (await chrome.debugger.getTargets()).find((x) => x.tabId === tabId);
  tabs.set(tabId, t.id);
  return { targetId: t.id, url: t.url, title: t.title };
}

const handlers = {
  ping: () => null,
  async createTab({ url }) {
    let tab;
    const win = runWindow != null && (await chrome.windows.get(runWindow).catch(() => null));
    if (win) tab = await chrome.tabs.create({ windowId: runWindow, url, active: false });
    else {
      const w = await chrome.windows.create({ url, focused: false });
      runWindow = w.id; tab = w.tabs[0];
    }
    return { tabId: tab.id, targetInfo: await attach(tab.id) };
  },
  cmd: ({ tabId, sessionId, method, params }) => chrome.debugger.sendCommand(sessionId ? { tabId, sessionId } : { tabId }, method, params ?? {}),
  closeTab: ({ tabId }) => chrome.tabs.remove(tabId).catch(() => {}),
  async closeAll() {
    const ids = [...tabs.keys()];
    tabs.clear();
    for (const id of ids) await chrome.debugger.detach({ tabId: id }).catch(() => {});
    if (runWindow != null) await chrome.windows.remove(runWindow).catch(() => {});
    else for (const id of ids) await chrome.tabs.remove(id).catch(() => {});
    runWindow = null;
  },
  async front({ tabId }) {
    const t = await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(t.windowId, { focused: true, state: "normal" });
  },
};

async function onMessage(m) {
  const fn = handlers[m.method];
  if (!fn || m.id == null) return;
  try { send({ id: m.id, result: (await fn(m.params ?? {})) ?? {} }); }
  catch (e) { send({ id: m.id, error: e?.message ?? String(e) }); }
}

chrome.debugger.onEvent.addListener((src, method, params) => {
  if (tabs.has(src.tabId)) send({ method: "event", params: { tabId: src.tabId, sessionId: src.sessionId, method, params } });
});
chrome.debugger.onDetach.addListener((src) => {
  // The tab closed, or you pressed Cancel on Chrome's debugging bar: the run sees the tab go.
  if (tabs.delete(src.tabId)) send({ method: "detached", params: { tabId: src.tabId } });
});
// A page Remuse drives opened a new tab (a target=_blank link, a popup): drive that one too.
chrome.tabs.onCreated.addListener(async (tab) => {
  if (tab.openerTabId == null || !tabs.has(tab.openerTabId)) return;
  try {
    const info = await attach(tab.id);
    send({ method: "attached", params: { tabId: tab.id, targetInfo: { ...info, openerId: tabs.get(tab.openerTabId) } } });
  } catch { /* closed already */ }
});

// The last window closed: Chrome keeps running in the background for scheduled tasks. Say so, once.
chrome.windows.onRemoved.addListener(async () => {
  if ((await chrome.windows.getAll()).length) return;
  const schedules = await fetch("http://127.0.0.1:3200/api/schedules").then((r) => r.json(), () => []);
  if (!schedules.length || (await chrome.storage.local.get("toldBackground")).toldBackground) return;
  await chrome.storage.local.set({ toldBackground: true });
  chrome.notifications.create("remuse-background", {
    type: "basic", iconUrl: "icons/icon-128.png", title: "Remuse keeps Chrome running",
    message: "Your scheduled tasks still run with your logins. To quit Chrome fully, right-click its icon in the taskbar tray and choose Exit.",
  });
});
