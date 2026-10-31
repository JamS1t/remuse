// When a step fails, Remuse works out another way to the step's goal instead of giving up: the rules every try
// follows, how the model's answer is read, the memory of what already failed, and where the ladder starts.
// Runner.recover does the trying. Pure, no browser or model: test/recover.check.ts.
import type { Step } from "./understand.ts";
import { gatedStep, IRREVERSIBLE, type Verdict } from "./proof.ts";

/** Something on the page a try can use, as the model sees it: numbered from 1. */
export type Seen = { i: number; role: string; name: string; id?: string; editable: boolean; where: string; disabled?: boolean; href?: string };
export type Move = { action: "click" | "fill" | "press" | "scroll" | "wait" | "done" | "none"; el?: number; key?: string; why: string };
export type Attempt = { rung: number; strategy: string; target?: string; changed: boolean; verdict: Verdict["result"] | "refused" | "error"; why: string };
export type Diagnosis = { kind: "signin" | "overlay" | "loading" | "wrong-page" | "narrow" | "hidden" | "missing"; say: string };

/** Per failed step: different tries, time, and model calls. Then it stops and says what it tried. */
export const BUDGET = { attempts: 6, ms: 90_000, calls: 8 };

/** Steps that wait for your OK are never worked around: they wait for you. */
export const canRecover = (s: Step) => !gatedStep(s);

const ACTIONS = ["click", "fill", "press", "scroll", "wait", "done", "none"];
const host = (u: string) => { try { return new URL(u).hostname; } catch { return ""; } };
const site = (h: string) => (/^[\d.]+$/.test(h) ? h : h.split(".").slice(-2).join(".")); // classroom.google.com → google.com

/** Why a try isn't allowed, or null. `groupKeys`: the keys the step's own group presses; `to`: where a link goes. */
export function unsafe(m: Move, el: Seen | undefined, s: Step, groupKeys: string[], here: string, to?: string): string | null {
  if (!ACTIONS.includes(m.action)) return `"${m.action}" isn't something I do while working around a problem`;
  if ((m.action === "click" || m.action === "fill") && !el) return "that isn't on the page";
  if (el && IRREVERSIBLE.test(el.name)) return `“${el.name}” can't be undone, so it waits for you`;
  if (m.action === "fill" && !el!.editable) return `“${el!.name || el!.role}” doesn't take typing`;
  if (m.action === "press") {
    const k = (m.key ?? "").trim().toLowerCase();
    if (!k) return "no key named";
    if (/enter/.test(k) && !groupKeys.some((g) => g.toLowerCase() === k)) return `${m.key} could send or submit, and this step never pressed it`;
  }
  if (to && host(to) && host(here) && site(host(to)) !== site(host(here))) return `that leaves ${host(here)} for ${host(to)}`;
  return null;
}

/** The same idea on the same target is never tried twice. */
export const repeated = (tried: Attempt[], strategy: string, target?: string) => tried.some((a) => a.strategy === strategy && (a.target ?? "") === (target ?? ""));

/** What's wrong, from signals the runner reads off the page; the first thing the person sees. */
export function diagnose(sig: { signin: boolean; overlay: boolean; loading: boolean; width: number; urlMatches: boolean; targetHidden: boolean }): Diagnosis {
  if (sig.signin) return { kind: "signin", say: "A sign-in page is in the way." };
  if (sig.overlay) return { kind: "overlay", say: "Something is covering the page (a dialog or a popup)." };
  if (sig.loading) return { kind: "loading", say: "The page is still loading." };
  if (!sig.urlMatches) return { kind: "wrong-page", say: "This isn't the page the step was on." };
  if (sig.width < 900) return { kind: "narrow", say: "The window is narrow, so the page folded some buttons into icons and menus." };
  if (sig.targetHidden) return { kind: "hidden", say: "What this step uses is there, but hidden or switched off." };
  return { kind: "missing", say: "What this step used isn't on the page any more." };
}
/** Cheapest rung that fits: a still-loading page waits first, something in the way gets closed first. */
export const firstRung = (d: Diagnosis) => (d.kind === "loading" ? 1 : d.kind === "overlay" ? 2 : 3);

/** The model's move, checked: anything odd (no JSON, an unknown action, a number not on the list) is "none". */
export function parseMove(reply: string, max: number): Move {
  const none = (why: string): Move => ({ action: "none", why });
  const a = reply.indexOf("{"), b = reply.lastIndexOf("}");
  if (a < 0 || b <= a) return none("the answer wasn't readable");
  let m: any;
  try { m = JSON.parse(reply.slice(a, b + 1)); } catch { return none("the answer wasn't readable"); }
  if (!m || !ACTIONS.includes(m.action)) return none("the answer named no move I make");
  const why = String(m.why ?? "").slice(0, 300);
  if (m.action === "click" || m.action === "fill") {
    const el = Number(m.el);
    if (!Number.isInteger(el) || el < 1 || el > max) return none(`it picked something that isn't on the list (${m.el})`);
    return { action: m.action, el, why };
  }
  if (m.action === "press") return m.key ? { action: "press", key: String(m.key), why } : none("it named no key");
  return { action: m.action, why };
}

/** What Muse Spark is asked, with the screenshot: the step's goal, what failed so far, and what's on the page. */
export function movePrompt(ctx: { goal: string; why?: string; task: string; tried: Attempt[]; els: Seen[]; value?: string; diagnosis: string }): string {
  const tried = ctx.tried.length ? ctx.tried.map((t, n) => `- Idea ${n + 1} (${t.strategy}${t.target ? ` on “${t.target}”` : ""}): ${t.verdict}. ${t.why}`).join("\n") : "- Nothing yet.";
  const els = ctx.els.map((e) => `[${e.i}] ${e.role} “${e.name}”${e.id ? ` #${e.id}` : ""}${e.editable ? " (takes typing)" : ""}${e.disabled ? " (switched off)" : ""} · ${e.where}`).join("\n");
  return `You are Remuse, a careful browser assistant doing a task the person taught you once. One step just failed.

Task: ${ctx.task}
This step's goal: ${ctx.goal}
${ctx.why ? `Why it's there, in the person's words: "${ctx.why}"\n` : ""}${ctx.value != null ? `If something must be typed, it is exactly: "${ctx.value}"\n` : ""}What's wrong: ${ctx.diagnosis}
What I already tried on this step:
${tried}

What's on the page now that I can use, numbered (kind, name, id, takes typing, where):
${els || "(nothing usable found)"}
The screenshot shows the page now.

Pick ONE next move toward this step's goal. Rules:
- Only what this step is for. Never send, submit, turn in, pay, delete, publish or archive anything.
- Prefer a control that does the same job as the one that's gone: an icon button, a "+" or "More" menu, a tab.
- To open a menu, click it; you'll see its items next time.
- Don't repeat what already failed.
- If the goal already looks done on the screen, answer "done".
- If nothing here fits, answer "none". Don't guess.
Reply with only JSON: {"action": "click" | "fill" | "press" | "scroll" | "wait" | "done" | "none", "el": <number, for click or fill>, "key": "<key, for press>", "why": "one short sentence"}`;
}
