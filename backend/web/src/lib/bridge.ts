import { useEffect, useState } from "react";

// Inside the Chrome sidebar this page runs in a frame; the extension around it does what only an
// extension can (record, read the current tab, share logins) and answers over postMessage.
export const inPanel = window.parent !== window;

let seq = 0;
const waiting = new Map<number, (v: any) => void>();
addEventListener("message", (e) => {
  if (e.source !== window.parent) return;
  const { id, result } = e.data ?? {};
  if (typeof id === "number" && waiting.has(id)) { waiting.get(id)!(result); waiting.delete(id); }
});

export function ext<T = any>(type: string, args?: Record<string, unknown>): Promise<T> {
  if (!inPanel) return Promise.reject(new Error("Open Showrun from the Chrome toolbar to use this."));
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, (r) => (r?.error ? reject(new Error(r.error)) : resolve(r)));
    window.parent.postMessage({ id, type, args }, "*"); // only types and site names go out; no secrets
    setTimeout(() => { if (waiting.delete(id)) reject(new Error("Showrun in Chrome didn't answer.")); }, 120_000);
  });
}

/** Re-render when the person switches or loads a tab. */
export function useTabChanges() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const on = (e: MessageEvent) => { if (e.source === window.parent && e.data?.event === "tab") setN((x) => x + 1); };
    addEventListener("message", on);
    return () => removeEventListener("message", on);
  }, []);
  return n;
}
