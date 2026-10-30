// Your own Chrome as Remuse's browser. The Remuse extension keeps a link open to the Agent and drives tabs
// with chrome.debugger; this relay makes that look like an ordinary Chrome DevTools endpoint, so the runner
// connects with Playwright's connectOverCDP and works exactly as it does in its own browser. Sites see your
// real Chrome with your real logins: nothing is copied.
//
//   Playwright --(/cdp, secret token)--> relay --(/extension, extension origin only)--> chrome.debugger
//
// Each tab Remuse opens is one CDP session "tab-<id>"; frames and workers inside it keep their own child
// session ids, which Chrome hands the extension and we pass through untouched.
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

const { wsServer: WebSocketServer } = createRequire(import.meta.url)("playwright-core/lib/utilsBundle");
type Sock = { readyState: number; send(d: string): void; close(): void; on(e: string, f: (...a: any[]) => void): void };

const TOKEN = randomUUID(); // only this process knows it, so no web page can drive your Chrome
const wss = new WebSocketServer({ noServer: true });
let ext: Sock | null = null;
let pw: Sock | null = null;
let seq = 1;
const waiting = new Map<number, { ok: (r: any) => void; fail: (e: Error) => void }>();
const tabSession = new Map<number, string>(); // tab -> its session for Playwright
const tabOf = new Map<string, number>(); // session (tab or child) -> tab
const targetTab = new Map<string, number>(); // targetId -> tab

export const chromeReady = () => ext?.readyState === 1;
export const relayUrl = (port: number) => `ws://127.0.0.1:${port}/cdp?token=${TOKEN}`;

/** Ask the extension to do something; resolves with its answer. */
function call(method: string, params: Record<string, unknown> = {}): Promise<any> {
  if (!chromeReady()) return Promise.reject(new Error("Chrome isn't connected"));
  const id = seq++;
  ext!.send(JSON.stringify({ id, method, params }));
  return new Promise((ok, fail) => waiting.set(id, { ok, fail }));
}
const toPw = (m: object) => { if (pw?.readyState === 1) pw.send(JSON.stringify(m)); };

function attached(tabId: number, info: any) {
  const sessionId = `tab-${tabId}`;
  tabSession.set(tabId, sessionId); tabOf.set(sessionId, tabId); targetTab.set(info.targetId, tabId);
  toPw({ method: "Target.attachedToTarget", params: { sessionId, waitingForDebugger: false, targetInfo: { ...info, type: "page", attached: true, canAccessOpener: false, browserContextId: "remuse" } } }); // any id: unknown ones land in the default context
}
function detached(tabId: number) {
  const sessionId = tabSession.get(tabId);
  if (!sessionId) return;
  tabSession.delete(tabId); tabOf.delete(sessionId);
  for (const [t, id] of targetTab) if (id === tabId) { targetTab.delete(t); toPw({ method: "Target.detachedFromTarget", params: { sessionId, targetId: t } }); }
}

function onExtension(ws: Sock) {
  ext?.close();
  ext = ws;
  ws.on("message", (raw: Buffer) => {
    const m = JSON.parse(String(raw));
    if (m.id && waiting.has(m.id)) {
      const w = waiting.get(m.id)!; waiting.delete(m.id);
      return m.error ? w.fail(new Error(m.error)) : w.ok(m.result);
    }
    if (m.method === "event") {
      const { tabId, sessionId, method, params } = m.params;
      if (method === "Target.attachedToTarget") tabOf.set(params.sessionId, tabId); // a frame or worker inside the tab
      toPw({ method, params, sessionId: sessionId ?? tabSession.get(tabId) });
    } else if (m.method === "attached") attached(m.params.tabId, m.params.targetInfo); // a tab the page opened
    else if (m.method === "detached") detached(m.params.tabId);
  });
  // A ping every 20 s keeps the extension's service worker awake while it's linked.
  const ping = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ method: "ping" })), 20_000);
  ws.on("close", () => {
    clearInterval(ping);
    if (ext !== ws) return;
    ext = null;
    for (const [, w] of waiting) w.fail(new Error("Chrome disconnected"));
    waiting.clear();
    pw?.close();
  });
}

async function browserCommand(method: string, params: any) {
  switch (method) {
    case "Browser.getVersion": return { protocolVersion: "1.3", product: "Chrome", revision: "", userAgent: "", jsVersion: "" };
    case "Target.createTarget": {
      const { tabId, targetInfo } = await call("createTab", { url: params.url ?? "about:blank" });
      attached(tabId, targetInfo);
      return { targetId: targetInfo.targetId };
    }
    case "Target.closeTarget": {
      const tabId = targetTab.get(params.targetId);
      if (tabId != null) await call("closeTab", { tabId });
      return { success: true };
    }
    case "Target.getTargets": return { targetInfos: [] };
    case "Target.getBrowserContexts": return { browserContextIds: [] };
    // ponytail: Browser.setDownloadBehavior and the rest are accepted and ignored; tasks that save
    // downloads or upload files run in Remuse's own browser instead (see runner.useChrome).
    default: return {};
  }
}

function onPlaywright(ws: Sock) {
  pw?.close();
  pw = ws;
  ws.on("message", async (raw: Buffer) => {
    const { id, method, params, sessionId } = JSON.parse(String(raw));
    try {
      let result;
      if (!sessionId) result = await browserCommand(method, params ?? {});
      else {
        const tabId = tabOf.get(sessionId);
        if (tabId == null) throw new Error(`no such session ${sessionId}`);
        const child = tabSession.get(tabId) === sessionId ? undefined : sessionId;
        result = await call("cmd", { tabId, sessionId: child, method, params });
      }
      ws.send(JSON.stringify({ id, sessionId, result: result ?? {} }));
    } catch (e) {
      ws.send(JSON.stringify({ id, sessionId, error: { code: -32000, message: (e as Error).message } }));
    }
  });
  // The run is over (or the Agent let go): close the tabs Remuse opened, and their window.
  ws.on("close", () => {
    if (pw !== ws) return;
    pw = null;
    for (const s of tabSession.values()) tabOf.delete(s);
    tabSession.clear(); targetTab.clear();
    call("closeAll").catch(() => {});
  });
}

/** Hook for the Agent's HTTP server. Returns false if the request isn't ours. */
export function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
  const u = new URL(req.url ?? "/", "http://127.0.0.1");
  const origin = String(req.headers.origin ?? "");
  if (u.pathname === "/extension") {
    // Web pages can open sockets to localhost too; only an extension may link up.
    if (!origin.startsWith("chrome-extension://")) { socket.destroy(); return true; }
    wss.handleUpgrade(req, socket, head, onExtension);
    return true;
  }
  if (u.pathname === "/cdp") {
    if (u.searchParams.get("token") !== TOKEN || origin) { socket.destroy(); return true; }
    wss.handleUpgrade(req, socket, head, onPlaywright);
    return true;
  }
  return false;
}

/** Show the run's window (Run and watch, or when it needs you). */
export const focusTab = (targetId: string) => { const tabId = targetTab.get(targetId); return tabId == null ? Promise.resolve() : call("front", { tabId }); };
