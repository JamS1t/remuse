// The sidebar shows the Agent's own remote page and lends it the browser powers only the extension has
// (recording, the current tab, connected sites) through a small message bridge.
const AGENT = "http://127.0.0.1:3200";
const frame = document.getElementById("ui");
const down = document.getElementById("down");

async function load() {
  const up = await fetch(`${AGENT}/api/sessions`).then((r) => r.ok, () => false);
  down.style.display = up ? "none" : "block";
  frame.style.display = up ? "block" : "none";
  if (up) frame.src = `${AGENT}/#/remote`;
}
document.getElementById("retry").onclick = load;
load();
// While this is open the review may listen and talk; when it closes, the extension stops both.
chrome.runtime.connect({ name: "panel" });

const ALLOWED = ["start", "stop", "status", "sites", "connect", "disconnect", "currentTab", "openTab", "listen", "unlisten", "mode", "keys", "speak", "hush", "cancel"];
addEventListener("message", async (e) => {
  if (e.source !== frame.contentWindow || e.origin !== AGENT) return;
  const { id, type, args } = e.data ?? {};
  if (!ALLOWED.includes(type)) return;
  const result = await chrome.runtime.sendMessage({ type, ...(args ?? {}) }).catch((err) => ({ error: err.message }));
  frame.contentWindow.postMessage({ id, result }, AGENT);
});

// Tell the page when the tab changes, so "Connect this site" follows you around.
const ping = () => frame.contentWindow?.postMessage({ event: "tab" }, AGENT);
chrome.tabs.onActivated.addListener(ping);
chrome.tabs.onUpdated.addListener((_, info) => { if (info.url || info.status === "complete") ping(); });
