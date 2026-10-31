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

  // ---- Drawing: while teaching, drag with the right mouse button (or turn on the pen with Alt+Shift+D and drag) to
  // circle or underline what you mean. The ink shows for a moment; Remuse gets what's under it, a picture with the
  // ink, and what you said while drawing. A plain right-click still opens the menu.
  let teaching = false, pen = false, stroke = null, menuOff = false, ink = null;
  try { chrome.runtime.sendMessage({ type: "status" }).then((s) => { teaching = !!s?.recording; }, () => {}); } catch { /* orphaned */ }
  try {
    chrome.runtime.onMessage.addListener((m) => {
      if (m?.type === "recording") { teaching = !!m.on; if (!teaching) setPen(false); }
      else if (m?.type === "pen" && teaching) setPen(!pen);
    });
  } catch { /* orphaned */ }

  function sheet() { // a full-page canvas in its own shadow root, above everything
    if (ink) return ink;
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none";
    const c = document.createElement("canvas");
    c.style.cssText = "width:100%;height:100%;display:block;transition:opacity .3s ease-out";
    host.attachShadow({ mode: "closed" }).append(c);
    document.documentElement.append(host);
    const dpr = devicePixelRatio || 1;
    c.width = innerWidth * dpr; c.height = innerHeight * dpr;
    const g = c.getContext("2d");
    g.scale(dpr, dpr); g.lineWidth = 4; g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = "#ff3b30";
    return (ink = { host, c, g, fade: 0 });
  }
  function dropSheet() { if (ink) { clearTimeout(ink.fade); ink.host.remove(); ink = null; } }
  function setPen(on) {
    pen = on;
    if (on) { const s = sheet(); s.host.style.pointerEvents = "auto"; s.host.style.cursor = "crosshair"; }
    else if (ink && !stroke) dropSheet();
  }
  const draw = (x, y) => {
    const s = sheet(), last = stroke.at(-1);
    stroke.push({ x, y });
    s.g.beginPath(); s.g.moveTo(last.x, last.y); s.g.lineTo(x, y); s.g.stroke();
  };
  // What a circle goes around: elements mostly inside it, smallest (and with words) first.
  function inside(box) {
    const area = (r) => Math.max(0, r.width) * Math.max(0, r.height);
    const boxArea = (box.right - box.left) * (box.bottom - box.top);
    const seen = new Set();
    for (let i = 1; i <= 5; i++) for (let j = 1; j <= 5; j++) {
      for (const el of document.elementsFromPoint(box.left + ((box.right - box.left) * i) / 6, box.top + ((box.bottom - box.top) * j) / 6)) seen.add(el);
    }
    return [...seen].filter((el) => {
      if (el === ink?.host || el === document.body || el === document.documentElement) return false;
      const r = el.getBoundingClientRect(), a = area(r);
      const over = Math.max(0, Math.min(r.right, box.right) - Math.max(r.left, box.left)) * Math.max(0, Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top));
      return a > 0 && over >= 0.6 * a && a < 1.5 * boxArea;
    }).sort((a, b) => (!!b.innerText?.trim() - !!a.innerText?.trim()) || area(a.getBoundingClientRect()) - area(b.getBoundingClientRect()));
  }
  // What an underline is under: the smallest thing with words just above the line.
  function above(pts) {
    const found = [];
    for (const p of pts.filter((_, i) => i % Math.max(1, Math.floor(pts.length / 8)) === 0)) {
      for (const el of document.elementsFromPoint(p.x, p.y - 8)) if (el !== ink?.host && el !== document.body && el !== document.documentElement && el.innerText?.trim() && !found.includes(el)) found.push(el);
    }
    const a = (el) => { const r = el.getBoundingClientRect(); return r.width * r.height; };
    return found.sort((x, y) => a(x) - a(y));
  }
  const ends = (pts) => [pts[0], pts.at(-1)].map((p) => document.elementsFromPoint(p.x, p.y).find((el) => el !== ink?.host)).filter(Boolean);
  function endStroke() {
    const pts = stroke; stroke = null;
    const length = pts.reduce((n, p, i) => (i ? n + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);
    if (length < 20) { if (!pen) dropSheet(); return false; } // a click, not a drawing
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const box = { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
    const w = box.right - box.left, h = box.bottom - box.top;
    const shape = h < 40 && h < 0.2 * w ? "underline" : Math.hypot(pts[0].x - pts.at(-1).x, pts[0].y - pts.at(-1).y) < 0.25 * Math.max(w, h) ? "circle" : "line";
    // Smallest first; a box around one already kept (its paragraph, its row) adds nothing.
    const targets = [...new Set(shape === "circle" ? inside(box) : shape === "underline" ? above(pts) : ends(pts))].filter((el, i, all) => !all.slice(0, i).some((k) => el.contains(k))).slice(0, 3);
    const g = (v, max) => Math.round((v / max) * 1000);
    const step = Math.max(1, Math.ceil(pts.length / 32));
    send("mark", {
      shape, grid: { x_min: g(box.left, innerWidth), y_min: g(box.top, innerHeight), x_max: g(box.right, innerWidth), y_max: g(box.bottom, innerHeight) },
      path: pts.filter((_, i) => i % step === 0).map((p) => ({ x: g(p.x, innerWidth), y: g(p.y, innerHeight) })), targets: targets.map(describe),
    });
    // The ink stays while the picture is taken, then fades.
    const s = ink;
    clearTimeout(s.fade);
    s.fade = setTimeout(() => { s.c.style.opacity = "0"; s.fade = setTimeout(() => { if (pen && ink === s) { s.g.clearRect(0, 0, innerWidth, innerHeight); s.c.style.opacity = "1"; } else if (ink === s) dropSheet(); }, 300); }, 1500);
    return true;
  }
  addEventListener("pointerdown", (e) => {
    if (!teaching || e.pointerType !== "mouse") return;
    if (e.button === 2 || (pen && e.button === 0)) {
      if (pen) { e.preventDefault(); e.stopImmediatePropagation(); } // the pen's press is ink, not a click on the page
      const s = sheet(); clearTimeout(s.fade); s.c.style.opacity = "1";
      stroke = [{ x: e.clientX, y: e.clientY }];
    }
  }, true);
  addEventListener("pointermove", (e) => { if (stroke) draw(e.clientX, e.clientY); }, true);
  addEventListener("pointerup", (e) => {
    if (!stroke) return;
    const drew = endStroke();
    if (drew && e.button === 2) menuOff = true; // a right-button drawing doesn't open the menu
    if (pen) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  addEventListener("contextmenu", (e) => { if (menuOff) { menuOff = false; e.preventDefault(); } }, true);
  addEventListener("click", (e) => { if (pen) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);

  // pointerdown fires before the click lands, so the "before" screenshot still shows the old screen.
  // Typing is flushed first: change only fires on blur, which comes after pointerdown.
  addEventListener("pointerdown", (e) => {
    if (!e.isPrimary || e.button !== 0 || pen) return; // the pen draws; it never clicks
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
