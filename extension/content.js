// Runs in every page. Reports clicks, typing and page changes to the background worker,
// which drops them unless a recording is running.
(() => {
  const send = (kind, data = {}) => {
    try {
      chrome.runtime.sendMessage({ type: "event", ev: { at: Date.now(), kind, url: location.href, title: document.title, ...data } }).catch(() => {});
    } catch { /* extension reloaded; this page's script is orphaned */ }
  };

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
      // Same 0-1000 grid Muse Spark uses for boxes on a viewport screenshot.
      grid: { x_min: g(r.left, innerWidth), y_min: g(r.top, innerHeight), x_max: g(r.right, innerWidth), y_max: g(r.bottom, innerHeight) },
    };
  }

  const isField = (el) => el && ((el.tagName === "INPUT" && !["submit", "button", "checkbox", "radio", "hidden", "reset"].includes(el.type)) || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
  const recorded = new WeakMap();

  function typed(el) {
    if (!isField(el) || el.value === (recorded.get(el) ?? el.defaultValue)) return;
    recorded.set(el, el.value);
    send("input", { target: describe(el), value: el.type === "password" ? "[hidden]" : el.value });
  }

  // pointerdown fires before the click lands, so the "before" screenshot still shows the old screen.
  // Typing is flushed first: change only fires on blur, which comes after pointerdown.
  addEventListener("pointerdown", (e) => {
    if (!e.isPrimary || e.button !== 0) return;
    typed(document.activeElement);
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
  let href = location.href;
  send("page");
  setInterval(() => { if (location.href !== href) { href = location.href; send("page"); } }, 250);
})();
