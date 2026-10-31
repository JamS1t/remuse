// What Remuse knows about particular sites, kept out of the engine. The runner, the proof checks and the healing
// loop work on any site; a plug-in only adds what a site needs on top: handles that never move, keyboard routes for
// a step's purpose, how to prove a step worked there, and where its upload control hides.
// Checked by test/plugins.check.ts; used by runner.ts (locate, upload, check) and recover.ts (the ladder).
import type { Locator, Page } from "playwright";
import type { Step } from "./understand.ts";
import { newlyAppeared, type Verdict } from "./proof.ts";

export type Plugin = {
  name: string;
  matches(url: string): boolean;
  /** Elements that never move, by the name a step uses for them. */
  handles?: { name: RegExp; selector: string }[];
  /** Keyboard routes to a step's purpose ("go to a cell" → the Name Box shortcut), tried before asking a model. */
  routes?: { purpose: RegExp; keys: string[]; why: string }[];
  /** Proof that a step worked on this site, from the page; null when the plug-in can't tell (the engine decides). */
  readBack?(page: Page, step: Step, vars: Record<string, unknown>, before?: string): Promise<Verdict | null>;
  /** The upload control, wherever the site puts it (Google's file picker is a frame of its own). */
  fileInput?(page: Page): Promise<Locator | null>;
  /** What's prepared here stays when the tab is left (a Classroom attachment, a store's cart). */
  keepsDrafts?: boolean;
};

const host = (url: string) => { try { return new URL(url).hostname; } catch { return ""; } };
const stem = (name: string) => name.replace(/\.[a-z0-9]{1,5}$/i, "");

const classroom: Plugin = {
  name: "classroom",
  matches: (url) => host(url) === "classroom.google.com",
  keepsDrafts: true,
  async fileInput(page) {
    for (const f of page.frames()) {
      const l = f.locator('input[type="file"]');
      if (await l.count().catch(() => 0)) return l.first();
    }
    return null;
  },
  // An uploaded file shows on the assignment, under your work, by its name (Drive may drop the extension).
  async readBack(page, step, vars, before = "") {
    if (step.do !== "upload" || !vars.file_name) return null;
    const name = String(vars.file_name);
    for (const deadline = Date.now() + 15_000; ;) {
      const now = await page.innerText("body").catch(() => "");
      if (newlyAppeared(before, now, name) || newlyAppeared(before, now, stem(name))) return { result: "verified", proof: "page", why: `${name} is attached, read back from the page` };
      if (Date.now() > deadline) return { result: "failed", proof: "page", why: `${name} doesn't show as attached` };
      await page.waitForTimeout(500);
    }
  },
};

const sheets: Plugin = {
  name: "sheets",
  matches: (url) => host(url) === "docs.google.com" && /^\/spreadsheets\//.test((() => { try { return new URL(url).pathname; } catch { return ""; } })()),
  // The Name Box has no label in the page, but always this id.
  handles: [{ name: /^name box$/i, selector: "#t-name-box" }],
  routes: [{ purpose: /name box|go to|cell|next empty row/i, keys: ["Control+J"], why: "Google's documented shortcut to the Name Box" }],
};

const plugins: Plugin[] = [classroom, sheets];
export function pluginFor(url: string): Plugin | null {
  return plugins.find((p) => p.matches(url)) ?? null;
}
/** A fixed handle for a target name: this site's plug-in first, else any plug-in's. The caller uses it only when
 *  exactly one such element is on the page, so another site's handle can't pick the wrong thing. */
export function handleFor(url: string, name: string): string | null {
  const mine = pluginFor(url)?.handles?.find((h) => h.name.test(name));
  return (mine ?? plugins.flatMap((p) => p.handles ?? []).find((h) => h.name.test(name)))?.selector ?? null;
}
