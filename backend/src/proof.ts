// How a step's result is judged. What the page itself shows is proof; a model looking at a screenshot can stop a
// pass ("an error dialog is showing") but never turn a failed page check into one, and a step that writes needs
// proof from the page. Pure functions, no model or browser: test/proof.check.ts.
import type { Step } from "./understand.ts";

export type Verdict = { result: "verified" | "failed" | "unverified"; proof: "page" | "screen" | "none"; by?: string; why: string };

const count = (hay: string, needle: string) => (needle ? hay.split(needle).length - 1 : 0);
/** The words are on the page because of this step: there now, and not there before (or there more times). */
export function newlyAppeared(before: string, after: string, want: string): boolean {
  const w = want.trim().toLowerCase();
  return !!w && count(after.toLowerCase(), w) > count(before.toLowerCase(), w);
}

/** The step's verdict from the page check (null: nothing on the page could tell) and the screen judge (null: no look). */
export function combine(page: Verdict | null, screen: { ok: boolean; why: string; by?: string } | null, writes: boolean): Verdict {
  if (page?.result === "failed") return page;
  if (page?.result === "verified") {
    if (screen && !screen.ok) return { result: "failed", proof: "screen", by: screen.by, why: screen.why };
    return screen ? { ...page, by: page.by ?? screen.by, why: `${page.why}; the screen agrees: ${screen.why}` } : page;
  }
  if (!screen) return page ?? { result: "unverified", proof: "none", why: "nothing on the page could confirm it" };
  if (!screen.ok) return { result: "failed", proof: "screen", by: screen.by, why: screen.why };
  if (writes) return { result: "unverified", proof: "screen", by: screen.by, why: `${screen.why} (only judged from the screen; something written needs proof from the page)` };
  return { result: "verified", proof: "screen", by: screen.by, why: screen.why };
}

/** Steps that put something into the site: what they wrote must be read back before the step counts as done. */
export const writes = (s: Pick<Step, "do">) => s.do === "fill" || s.do === "upload";

const asNumber = (s: string) => { const t = s.replace(/[₱$€£¥\s,]/g, ""); return /^[-+]?\d+(\.\d+)?$/.test(t) ? Number(t) : null; };
/** Two readings of one value agree: "₱451" and "451.00" do, "Subtotal 349" and "Total 394" don't. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a == null || b == null || String(a).trim() === "" || String(b).trim() === "") return a == null && b == null;
  const x = String(a).trim(), y = String(b).trim();
  const nx = asNumber(x), ny = asNumber(y);
  if (nx !== null && ny !== null) return nx === ny;
  return x.replace(/\s+/g, " ").toLowerCase() === y.replace(/\s+/g, " ").toLowerCase();
}
