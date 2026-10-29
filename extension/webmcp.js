// WebMCP capture, run in the page itself before its scripts. Sites register "tools" for agents through
// navigator.modelContext (Chrome's early preview; newer builds use document.modelContext). This keeps a
// copy of every registered tool so Remuse can see and call them, and stands in where Chrome has no API.
// Shared by the Remuse extension (while recording) and the Agent's browser (while running).
(() => {
  if (window.__showrunTools) return;
  const tools = new Map();
  window.__showrunTools = tools;
  const announce = () => window.postMessage({ __showrun: "tools", tools: [...tools.values()].map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, readOnly: !!t.annotations?.readOnlyHint })) }, "*");
  const api = {
    registerTool(t) { if (t?.name) { tools.set(t.name, t); announce(); } },
    unregisterTool(name) { tools.delete(name); announce(); },
    provideContext(o) { tools.clear(); for (const t of o?.tools ?? []) tools.set(t.name, t); announce(); },
    clearContext() { tools.clear(); announce(); },
  };
  addEventListener("message", (e) => { if (e.source === window && e.data?.__showrun === "list") announce(); });
  for (const host of [navigator, document]) {
    const native = host.modelContext;
    if (!native) { try { Object.defineProperty(host, "modelContext", { value: api, configurable: true }); } catch {} continue; }
    // Chrome's own API exists: keep it working and keep our copy in step.
    for (const k of Object.keys(api)) {
      const orig = typeof native[k] === "function" ? native[k].bind(native) : null;
      try { native[k] = (...a) => { api[k](...a); return orig?.(...a); }; } catch {}
    }
  }
})();
