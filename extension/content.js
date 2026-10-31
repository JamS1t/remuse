// Runs in every page. Reports clicks, typing and page changes to the background worker,
// which drops them unless a recording is running.
// The background also injects this into tabs that were open before the extension (re)loaded, whose
// first copy is cut off. Run once per live extension: a copy from before a reload is dead and doesn't count.
(() => {
  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  if (window.__remuseRecorder?.alive()) return;
  window.__remuseRecorder = { alive };
  // Inside a frame (Google Sheets types through a hidden one), report the page the person sees.
  const sub = window !== top;
  // Which Google account the page is using: every Google app names it on its account button ("Google Account: Name
  // (email)"). A run makes sure it acts as the same account on that site.
  const account = (d) => {
    try {
      const label = [...d.querySelectorAll('[aria-label*="Google"]')].map((e) => e.getAttribute("aria-label") || "").find((a) => /\([^()\s]+@[^()\s]+\)/.test(a));
      return label ? /\(([^()\s]+@[^()\s]+)\)/.exec(label)[1].toLowerCase() : undefined;
    } catch { return undefined; }
  };
  // YouTube names no account on its pages, but its startup data says who is logged in: DATASYNC_ID is the Google
  // account, and for a brand channel the channel too ("channel||account"). Studio's address names the channel.
  // Read once per page load (it doesn't change without one).
  let yt;
  const youtube = (d, url) => {
    if (yt !== undefined) return yt;
    yt = null;
    try {
      const host = new URL(url).host;
      if (!/(^|\.)youtube\.com$/.test(host)) return yt;
      const s = [...d.scripts].map((x) => x.textContent || "").find((t) => t.includes('"DATASYNC_ID"'));
      if (s && /"LOGGED_IN":\s*true/.test(s)) { const id = /"DATASYNC_ID":"([^"]+)"/.exec(s)?.[1]; if (id) yt = `yt:${id}`; }
      if (!yt && host.startsWith("studio.")) { const c = /\/channel\/(UC[\w-]+)/.exec(new URL(url).pathname)?.[1]; if (c) yt = `ytc:${c}`; }
    } catch { /* not readable */ }
    return yt;
  };
  const page = () => {
    try {
      const d = sub ? top.document : document, url = sub ? top.location.href : location.href;
      // Only Google and YouTube pages: another site's labels never count as a Google account.
      const google = /(^|\.)(google|youtube)\.com$/.test(new URL(url).host);
      return { url, title: d.title, account: google ? youtube(d, url) ?? account(d) : undefined };
    } catch { return { url: location.href, title: document.title }; }
  };
  const send = (kind, data = {}) => {
    try {
      chrome.runtime.sendMessage({ type: "event", ev: { at: Date.now(), kind, ...page(), ...data } }).catch(() => {});
    } catch { /* extension reloaded; this page's script is orphaned */ }
  };

  // WebMCP tools the page offers (seen by webmcp.js in the page's own world), recorded once per change.
  let lastTools = "";
  addEventListener("message", (e) => {
    if (e.source !== window || e.data?.__showrun !== "tools") return;
    const key = JSON.stringify(e.data.tools.map((t) => t.name));
    if (key === lastTools || !e.data.tools.length) return;
    lastTools = key;
    send("tools", { tools: e.data.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, readOnly: t.readOnly })) });
  });
  window.postMessage({ __showrun: "list" }, "*"); // tools registered before this script loaded

  const IMPLICIT = { button: "button", a: "link", select: "combobox", textarea: "textbox" };
  const INPUT_ROLE = { submit: "button", button: "button", reset: "button", checkbox: "checkbox", radio: "radio" };
  const clean = (s) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || undefined;

  function role(el) {
    if (el.getAttribute("role")) return el.getAttribute("role");
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return el.hasAttribute("href") ? "link" : undefined;
    if (tag === "input") return INPUT_ROLE[el.type] ?? "textbox";
    return IMPLICIT[tag];
  }

  // Accessible name, close enough to what Playwright's getByRole(name) matches.
  function name(el) {
    const by = el.getAttribute("aria-labelledby");
    return clean(
      el.getAttribute("aria-label") ||
      (by && document.getElementById(by)?.innerText) ||
      (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText) ||
      el.closest("label")?.innerText ||
      el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("alt") ||
      (["button", "link"].includes(role(el)) ? el.innerText || el.value : "")
    );
  }

  function cssPath(el) {
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && parts.length < 5; e = e.parentElement) {
      if (e.id) { parts.unshift(`#${CSS.escape(e.id)}`); break; }
      const tag = e.tagName.toLowerCase();
      const same = e.parentElement ? [...e.parentElement.children].filter((c) => c.tagName === e.tagName) : [];
      parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(e) + 1})` : tag);
    }
    return parts.join(" > ");
  }

  function describe(el) {
    const r = el.getBoundingClientRect();
    const g = (v, max) => Math.round((v / max) * 1000);
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      name: el.getAttribute("name") || undefined,
      role: role(el),
      label: name(el),
      text: clean(el.innerText),
      selector: cssPath(el),
      // The link's address lets the runner find sibling results by URL shape on any site.
      href: el.closest("a[href]")?.href || undefined,
      // Same 0-1000 grid Muse Spark uses for boxes on a viewport screenshot.
      grid: { x_min: g(r.left, innerWidth), y_min: g(r.top, innerHeight), x_max: g(r.right, innerWidth), y_max: g(r.bottom, innerHeight) },
    };
  }

  const isField = (el) => el && ((el.tagName === "INPUT" && !["submit", "button", "checkbox", "radio", "hidden", "reset", "file"].includes(el.type)) || el.tagName === "TEXTAREA" || el.tagName === "SELECT");

  // Choosing a file to upload: the browser only shares the file's name, which is enough for Remuse to
  // match it to one of your allowed folders and learn which file to pick next time.
  addEventListener("change", (e) => {
    const el = e.target;
    if (el?.tagName !== "INPUT" || el.type !== "file" || !el.files?.length) return;
    send("upload", { target: describe(el), files: [...el.files].map((f) => ({ name: f.name, size: f.size, type: f.type, modified: f.lastModified })) });
  }, true);
  const recorded = new WeakMap();

  function typed(el) {
    if (!isField(el) || el.value === (recorded.get(el) ?? el.defaultValue)) return;
    recorded.set(el, el.value);
    send("input", { target: describe(el), value: el.type === "password" ? "[hidden]" : el.value });
  }

  // Typing outside form fields: Google Sheets and Docs, editors drawn on a canvas, rich text boxes.
  // Keys are collected into text and sent when the person moves on (Enter, Tab, an arrow, a click).
  // In Google Sheets the Name Box says which cell it went into.
  let buf = "", bufEl = null;
  const cell = () => { try { return top.document.querySelector("#t-name-box")?.value || undefined; } catch { return undefined; } };
  const flush = () => {
    if (buf) send("input", { target: bufEl ? describe(bufEl) : undefined, value: buf, cell: cell() });
    buf = ""; bufEl = null;
  };
  const MOVE = /^(Enter|Tab|Escape|Arrow(Up|Down|Left|Right)|Home|End|PageUp|PageDown)$/;
  addEventListener("keydown", (e) => {
    if (isField(e.target) || e.isComposing) return;
    const mods = (e.ctrlKey ? "Control+" : "") + (e.metaKey ? "Meta+" : "") + (e.altKey ? "Alt+" : "");
    if (!mods && e.key.length === 1) { if (!buf) bufEl = e.target; buf += e.key; return; }
    if (!mods && e.key === "Backspace") { buf = buf.slice(0, -1); return; }
    if (MOVE.test(e.key) || (mods && /^[a-z]$/i.test(e.key) && /[vxz]/i.test(e.key))) {
      const at = cell(); flush();
      send("key", { key: mods + (e.shiftKey && MOVE.test(e.key) ? "Shift+" : "") + e.key, cell: at });
    }
  }, true);
  if (sub) return; // frames only carry typing; clicks and pages come from the page itself

  // Where the mouse rests is not recorded: hovering while talking made Remuse learn things nobody did or said.
  // To point at something on purpose, draw on the page instead (a mark).

  // pointerdown fires before the click lands, so the "before" screenshot still shows the old screen.
  // Typing is flushed first: change only fires on blur, which comes after pointerdown.
  addEventListener("pointerdown", (e) => {
    if (!e.isPrimary || e.button !== 0) return;
    typed(document.activeElement); flush();
    const t = e.target.closest("button, a, input, select, textarea, label, summary, [role], [onclick]") ?? e.target;
    send("click", { target: describe(t) });
  }, true);

  addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !isField(e.target) || e.target.tagName === "TEXTAREA") return;
    typed(e.target);
    send("key", { key: "Enter", target: describe(e.target) });
  }, true);

  addEventListener("change", (e) => typed(e.target), true);

  // ponytail: polls for client-side navigation (Next.js Link); webNavigation API if this ever misses one.
  // Page text lets the Build stage write extractors against what was really on screen.
  const snapshot = () => ({
    text: document.body.innerText.slice(0, 4000),
    images: [...document.images].slice(0, 5).map((i) => ({ src: i.src, alt: i.alt || undefined })),
  });
  let href = location.href;
  send("page", snapshot());
  setInterval(() => {
    if (location.href === href) return;
    href = location.href;
    setTimeout(() => send("page", snapshot()), 400); // client-side nav: let the new page render
  }, 250);
})();
