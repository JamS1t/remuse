// Run: plays a Task Spec on every item in the list with Playwright. DOM first, Muse Spark + SAM 3.1 when
// the page changed. Checks every step, pauses for approval before anything irreversible, asks when unsure.
import { chromium, type BrowserContext, type Page, type Locator } from "playwright";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { askJson, checker, ground, sam, text, png, type Box, type Part } from "./meta.ts";
import { load, same, type Rules } from "./build.ts";
import type { Spec, Step, Target } from "./understand.ts";
import { applyLogins } from "./logins.ts";
import { notify } from "./notify.ts";
import { chromeReady, relayUrl } from "./chrome.ts";
import { captionFor, chooseFile, findFolder, freeName, markUsed, pathIn, usedFor } from "./folders.ts";

/** Ends the item quietly as skipped (e.g. nothing new to upload yet), not as a failure. */
class Skip extends Error {}
/** A practice run reached the point where a real run would need the person (an OK or a question): it ends there. */
class PracticeEnd extends Error {}

// why: the reason in plain words (what it checked and found, or what a decision rested on).
// how: "page" = checked on the page itself; "screen" = Muse Spark (and SAM 3.1) looked at a screenshot.
// by: which model gave the reason, when it was the checker (the second model).
export type LogLine = { at: number; msg: string; level: "info" | "ok" | "warn" | "error"; shot?: string; why?: string; how?: "page" | "screen"; by?: string };
export type Candidate = { url: string; title: string; vars: Record<string, unknown>; score: number | null; shot?: string; best?: boolean };
export type Item = {
  url: string; label: string; index?: number; // index: position in the list, for items that open by clicking
  status: "waiting" | "running" | "approval" | "asking" | "planned" | "done" | "skipped" | "failed";
  vars: Record<string, unknown>; outcome?: string; because?: string; expected?: string; decidedBy?: "rules" | "you" | "learned"; log: LogLine[];
  candidates?: Candidate[];
  report?: string; // the update a "report" step gave the person
  key?: string; // how it is remembered between runs (itemKey, numbered when two items read the same)
  byYou?: boolean; // skipped because the person said so (no to a step, or skip on a question): settled, not retried
};
export type Pending =
  | { kind: "approval"; item: number; step: string; target?: string; outcome?: string; because?: string; shot: string; healed?: string }
  | { kind: "ask"; item: number; question: string; options: string[]; shot: string; requestType?: string }
  | { kind: "handoff"; item: number; step: string; problem: string; shot: string }
  // Every item read and decided, nothing done yet: what it will do, for the person's Go.
  | { kind: "plan"; item: number; counts: Record<string, number>; needsOk: number; skipped: number; failed: number; shot?: undefined };
export type Answer = { decision?: "approve" | "reject" | "approve_all" | "retry" | "skip"; outcome?: string; note?: string; reply?: string; learn?: boolean };
export type Run = {
  id: string; specId: number; status: "starting" | "running" | "done" | "failed" | "stopped";
  items: Item[]; current: number; pending: Pending | null; autoApprove: boolean;
  browser?: "chrome" | "own"; // your Chrome (through the extension) or Remuse's own browser
  rows?: Record<string, string>[];
  // Runs work hidden in the background unless the person chose to watch; who started it.
  visible?: boolean; trigger?: "you" | "schedule";
  startedAt: number; endedAt?: number; error?: string; shot?: string;
  heals: { step: string; from: string; to: string }[];
  learned: { requestType: string; outcome: string; note?: string; reply?: string }[];
  // Items in the list it had already handled in earlier runs, left alone this time (a list task remembers).
  alreadyDone?: number;
  score?: { matched: number; total: number };
  // "practice": right after learning, Remuse tries the task once on the person's own example and stops
  // before anything irreversible, then compares what it read and chose with what the person did.
  mode?: "practice";
  practice?: Practice;
  // Plan first (runs you start on several items): read and decide every item, asking anything up front, show
  // the plan, and act only after your Go. `phase` says which pass it's in.
  plan?: boolean; phase?: "plan" | "act";
  checker?: string; // the second model that checks this run's work (Muse Spark Open with a partner key)
};
export type Practice = {
  sameItem: boolean; // found the very item from the demo (else the first one, so values may differ)
  outcome?: string; expected?: string; // what it chose; what the person did in the demo
  values: { name: string; got: unknown; want: unknown; ok: boolean }[];
  checked: number; // steps it did and checked before stopping
  stoppedBefore?: string; stoppedForOk?: boolean; // where it stopped; whether a real run would ask you there
  asked?: string; problem?: string;
  ok: boolean;
};

const VIEW = { width: 1440, height: 900 };
const MOCK = process.env.MOCK_URL ?? "http://localhost:3100";
const IRREVERSIBLE = /\b(refund|replace|send|pay|submit|ship|confirm|delete|place order|issue|buy|checkout|check out|purchase|book|transfer|message seller|post|share|publish|approve|merge|archive|resolve)\b/i;
// The browser profile runs use (its sign-ins live here). Tests point BROWSER_PROFILE at a throwaway one.
export const PROFILE = process.env.BROWSER_PROFILE ? resolve(process.env.BROWSER_PROFILE) : fileURLToPath(new URL("../data/browser", import.meta.url));

/** The Remuse browser: the person's installed Chrome with its own profile, so sign-ins stick between runs. */
// Hidden Chrome calls itself "HeadlessChrome", which sites like Google treat as a bot. Learn the real
// user agent once and present that instead, so a hidden run looks like the person's normal Chrome.
let realUA: string | null = null;
// Chrome opens a profile only once. If the Google sign-in window (plain Chrome on this profile) is still
// open, a run's browser would close at once; close that window first, politely, so the sign-in is saved.
const sameProfile = () => {
  if (process.platform !== "win32") return [];
  const ps = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ? { $_.CommandLine -like '*${PROFILE}*' -and $_.CommandLine -notlike '*--type=*' -and $_.CommandLine -notlike '*remote-debugging*' } | % { $_.ProcessId }`;
  try { return execFileSync("powershell.exe", ["-NoProfile", "-Command", ps], { encoding: "utf8", timeout: 15_000 }).split(/\s+/).filter(Boolean); } catch { return []; }
};
async function closeSignInWindow() {
  const pids = sameProfile();
  if (!pids.length) return;
  for (const pid of pids) try { execFileSync("taskkill", ["/PID", pid]); } catch { /* already gone */ }
  for (let i = 0; i < 20 && sameProfile().length; i++) await new Promise((r) => setTimeout(r, 500));
  for (const pid of sameProfile()) try { execFileSync("taskkill", ["/F", "/PID", pid]); } catch { /* gone */ }
}
/** Plain Chrome on Remuse's profile, not driven by anything: Google and other sites see an ordinary browser,
 *  so signing in works. The sign-in stays in the profile runs use. */
const CHROME = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]
  .map((d) => d && join(d, "Google", "Chrome", "Application", "chrome.exe")).find((p) => p && existsSync(p));
export function openPlainChrome(url: string) {
  if (!CHROME) return false;
  spawn(CHROME, [`--user-data-dir=${PROFILE}`, "--no-first-run", "--no-default-browser-check", url], { detached: true, stdio: "ignore" }).unref();
  return true;
}
export const plainChromeOpen = () => sameProfile().length > 0;
const SIGN_IN = /accounts\.google\.com|\/(log-?in|sign-?in|sign_in|auth|sso)\b/i;

const launch = async (opts: Parameters<typeof chromium.launchPersistentContext>[1]) => {
  await closeSignInWindow();
  try { return await chromium.launchPersistentContext(PROFILE, { ...opts, channel: "chrome" }); }
  catch { return chromium.launchPersistentContext(PROFILE, opts); } // ponytail: no Chrome installed, bundled Chromium
};

/** The person's own Chrome, through the extension (see chrome.ts). */
export async function openChrome(): Promise<BrowserContext> {
  const browser = await chromium.connectOverCDP(relayUrl(Number(process.env.PORT ?? 3200)));
  const ctx = browser.contexts()[0];
  // ponytail: a CDP-connected default context can't be closed; letting go of Chrome closes Remuse's tabs (relay).
  ctx.close = () => browser.close();
  await ctx.addInitScript({ path: fileURLToPath(new URL("../../extension/webmcp.js", import.meta.url)) });
  return ctx;
}

export async function openBrowser(headless: boolean): Promise<BrowserContext> {
  // Without the "controlled by automation" flags, sites that refuse automated browsers (Google's
  // "this browser may not be secure") treat Remuse's browser like any other Chrome.
  const opts = {
    headless, viewport: VIEW, ignoreDefaultArgs: ["--enable-automation"],
    args: ["--disable-blink-features=AutomationControlled", ...(headless ? [] : [`--window-size=${VIEW.width},${VIEW.height + 120}`])],
  };
  if (headless && !realUA) {
    const probe = await launch(opts);
    const ua = await (probe.pages()[0] ?? (await probe.newPage())).evaluate(() => navigator.userAgent).catch(() => "");
    await probe.close();
    realUA = ua.replace("HeadlessChrome", "Chrome") || null;
  }
  const ctx = await launch(headless && realUA ? { ...opts, userAgent: realUA } : opts);
  // See the WebMCP tools pages register (same script the extension uses while recording).
  await ctx.addInitScript({ path: fileURLToPath(new URL("../../extension/webmcp.js", import.meta.url)) });
  // The person's logins for connected sites, shared by the Chrome helper.
  await applyLogins(ctx).catch((e) => console.warn("couldn't apply shared logins:", e.message));
  return ctx;
}
const urlShape = (u: string) => {
  try { const p = new URL(u); return [p.host, ...p.pathname.split("/").filter(Boolean).map((s) => (/\d/.test(s) || s.length > 24 ? "*" : s))].join("/"); }
  catch { return ""; }
};

// A value shown in a reason: one line, not too long.
const short = (s?: string | null) => { const t = (s ?? "").replace(/\s+/g, " ").trim(); return t.length > 60 ? `${t.slice(0, 57)}…` : t; };

/** How a list item is remembered between runs: its address, or (items opened by clicking) its text. */
const TRACKING = /^(utm_\w+|fbclid|gclid|igsh|igshid|si|mc_cid|mc_eid|ref_src|_hsenc|_hsmi)$/i;
export function itemKey(i: { url: string; label: string }) {
  if (i.url) {
    try { const u = new URL(i.url); for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k); return u.href.replace(/\/$/, ""); }
    catch { return i.url.replace(/\/$/, ""); }
  }
  // Items opened by clicking are known by their text, minus the parts that change on their own ("2m ago", "9:42 PM").
  return `text:${i.label.replace(/\b(\d+\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|s|m|h|d|w|y)\b(\s+ago)?|just now|today|yesterday|\d{1,2}:\d{2}(\s*[ap]m)?)/gi, "").replace(/\s+/g, " ").trim()}`;
}

/** A step that waits for the person's OK in a real run: marked irreversible, a word like "refund", or such a site tool. */
const gatedStep = (s: Step) => !!s.irreversible || (s.do === "click" && IRREVERSIBLE.test(s.target?.name ?? "")) || (!!s.tool && IRREVERSIBLE.test(s.tool.name.replace(/_/g, " ")));

/** Test sites only: an outcome by what it means ("send_replacement" is "replace", "refund_lost" is "lost_refund"),
 *  so a run can be scored whatever names the model gave the outcomes. */
export const meaning = (o?: string) => (!o ? o : /lost/i.test(o) ? "lost_refund" : /declin/i.test(o) ? "decline" : /replac/i.test(o) ? "replace" : /refund/i.test(o) ? "refund" : o);

// Only Google and YouTube pages have their account checked (and their address changed to switch). Tests widen it.
const ACCOUNT_HOSTS = new RegExp(process.env.REMUSE_ACCOUNT_HOSTS ?? "(^|\\.)(google|youtube)\\.com$");
/** In the page: YouTube Studio's channel, from its address ("ytc:UC…"), or null. */
const studioChannel = () => { const c = /\/channel\/(UC[\w-]+)/.exec(location.pathname)?.[1]; return c ? `ytc:${c}` : null; };

/** In the page: who YouTube says is logged in ("yt:<channel>||<account>" or "yt:<account>||"), else Studio's channel
 *  from its address ("ytc:UC…"), else null. Runs in the page itself, where YouTube's own config lives. */
const youTubeIdentity = () => {
  const cfg = (window as any).ytcfg;
  const get = (k: string) => { try { return cfg?.get?.(k) ?? cfg?.data_?.[k]; } catch { return undefined; } };
  const id = get("DATASYNC_ID");
  if (get("LOGGED_IN") === true && id) return `yt:${id}`;
  const c = /\/channel\/(UC[\w-]+)/.exec(location.pathname)?.[1];
  return location.host.startsWith("studio.") && c ? `ytc:${c}` : null;
};

/** In the page: the Google account it is using, from its account button, or null when it shows none. */
const pageAccount = () => {
  const label = [...document.querySelectorAll('[aria-label*="Google"]')].map((e) => e.getAttribute("aria-label") ?? "").find((a) => /\([^()\s]+@[^()\s]+\)/.test(a));
  return label ? /\(([^()\s]+@[^()\s]+)\)/.exec(label)![1].toLowerCase() : null;
};

const manila = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
// The reply is kept as a template, so its own {{values}} are filled where it's typed (one level, reply only:
// text read from a page is never treated as a template).
const fill = (s: string, v: Record<string, unknown>, deep = true): string =>
  s.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (v[k] === undefined || v[k] === null ? "" : k === "reply" && deep ? fill(String(v[k]), v, false) : String(v[k])));
const render = (s: string | null | undefined, v: Record<string, unknown>) => (s == null ? undefined : fill(s, v));

export class Runner {
  run: Run;
  spec: Spec;
  rules: Rules;
  dir: string;
  page!: Page;
  ctx!: BrowserContext;
  // Tabs by the name the spec gives them.
  tabs = new Map<string, Page>();
  tabName = "";
  headless = true;
  inChrome = false; // running in the person's own Chrome through the extension
  // Re-attaches the download watcher when the browser is reopened after a sign-in pause.
  watch: (ctx: BrowserContext) => void = () => {};
  stopped = false;
  // Variables from the previous run of this task, by item label, for {{prev_<name>}} ("change since last time").
  prev: Record<string, Record<string, unknown>> = {};
  // Which task this is (its recording id): uploaded files are remembered per task.
  taskKey = "";
  baseRules: Spec["rules"]; // decide() indexes these; learned rules are added to the spec, not here
  // Practice only: the item the person opened in the demo (its link, or its text for items opened by clicking).
  example?: { url?: string; label?: string };
  // List tasks: items handled in earlier runs (by itemKey), left alone unless the person asks to do them again.
  handled?: Set<string>;
  // Started because this file landed in a watched folder: the upload uses it.
  file?: { folder: string; name: string };
  private get practicing() { return this.run.mode === "practice"; }
  private phase: "all" | "plan" | "act" = "all"; // which pass the current item is in (see runItem)
  // The judgement questions asked on each item (by index): the checker answers the same ones before an irreversible act.
  private judged = new Map<number, { parts: Part[]; names: string[] }>();
  /** A practice starts by itself, on live data, so it is stricter than a run: any click, key press or site tool
   *  in an outcome (the part that acts) ends it, unless it only moves between pages (a link or a tab). */
  private unsure(raw: Step) {
    if (!this.practicing) return false;
    if (raw.do === "upload") return true; // on many sites choosing the file is the upload
    if (this.spec.steps.includes(raw)) return false;
    return raw.do === "press" || !!raw.tool || (raw.do === "click" && !["link", "tab"].includes(raw.target?.role ?? ""));
  }
  private resolve: ((a: Answer) => void) | null = null;
  private shots = 0;
  onChange: (run: Run, spec: Spec) => void;

  constructor(run: Run, spec: Spec, code: string, dir: string, onChange: (run: Run, spec: Spec) => void) {
    this.run = run; this.spec = structuredClone(spec); this.baseRules = structuredClone(spec.rules); this.rules = load(code); this.dir = dir; this.onChange = onChange;
    mkdirSync(dir, { recursive: true });
  }

  private changed() { this.onChange(this.run, this.spec); }
  private get item() { return this.run.items[this.run.current]; }
  private log(msg: string, level: LogLine["level"] = "info", shot?: string, more: Pick<LogLine, "why" | "how" | "by"> = {}) {
    this.item?.log.push({ at: Date.now(), msg, level, shot, ...more });
    this.changed();
  }

  private async shot(highlight?: Locator): Promise<{ file: string; buf: Buffer }> {
    if (highlight) await highlight.evaluate((el: HTMLElement) => { el.dataset.showrunOutline = el.style.outline; el.style.outline = "4px solid #f59e0b"; el.style.outlineOffset = "2px"; }).catch(() => {});
    // A page that keeps animating can make a screenshot wait forever: animations are frozen for it, and it gives up
    // after 15 s and tries once more.
    const snap = () => this.page.screenshot({ timeout: 15_000, animations: "disabled" });
    const buf = await snap().catch(async (e) => { if (this.stopped || this.page.isClosed()) throw e; await this.page.waitForTimeout(1000); return snap(); });
    if (highlight) await highlight.evaluate((el: HTMLElement) => { el.style.outline = el.dataset.showrunOutline ?? ""; }).catch(() => {});
    const file = `${++this.shots}.png`;
    writeFileSync(join(this.dir, file), buf);
    this.run.shot = file;
    return { file, buf };
  }

  /** A close-up of the element a step acts on, outlined, with some of the page around it: small enough to read
   *  as a thumbnail next to the step. Not the "what Remuse sees now" picture, which stays the whole screen. */
  private async shotNear(loc: Locator): Promise<string | undefined> {
    await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
    const b = await loc.boundingBox({ timeout: 1000 }).catch(() => null);
    if (!b) return undefined;
    const [vw, vh] = await this.page.evaluate(() => [innerWidth, innerHeight]).catch(() => [VIEW.width, VIEW.height]);
    const w = Math.min(vw, Math.max(560, b.width + 240)), h = Math.min(vh, Math.max(350, b.height + 160));
    const x = Math.min(Math.max(0, b.x + b.width / 2 - w / 2), vw - w), y = Math.min(Math.max(0, b.y + b.height / 2 - h / 2), vh - h);
    const was = await loc.evaluate((el: HTMLElement) => { const o = [el.style.outline, el.style.outlineOffset]; el.style.outline = "3px solid #a78bfa"; el.style.outlineOffset = "2px"; return o; }, undefined, { timeout: 1000 }).catch(() => null);
    const buf = b.y + b.height > 0 && b.y < vh ? await this.page.screenshot({ clip: { x, y, width: w, height: h }, timeout: 10_000, animations: "disabled" }).catch(() => null) : null;
    if (was) await loc.evaluate((el: HTMLElement, [o, off]) => { el.style.outline = o; el.style.outlineOffset = off; }, was, { timeout: 1000 }).catch(() => {});
    if (!buf) return undefined;
    const file = `${++this.shots}.png`;
    writeFileSync(join(this.dir, file), buf);
    return file;
  }

  /** A screenshot with boxes drawn over the page (0-1000 grid): the element it chose, and around it what
   *  SAM 3.1 segmented and where Muse Spark pointed. The boxes are removed right after. */
  private async marked(boxes: { box: Box; kind: "pick" | "sam" | "spark"; label?: string }[]) {
    await this.page.evaluate((bs) => {
      const root = document.createElement("div");
      root.id = "__remuse_marks";
      root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
      for (const b of bs) {
        const d = document.createElement("div");
        const [x, y, w, h] = [b.box.x_min / 1000 * innerWidth, b.box.y_min / 1000 * innerHeight, (b.box.x_max - b.box.x_min) / 1000 * innerWidth, (b.box.y_max - b.box.y_min) / 1000 * innerHeight];
        const line = b.kind === "pick" ? "3px solid #a78bfa" : b.kind === "spark" ? "2px dashed #f59e0b" : "2px solid rgba(167,139,250,.85)";
        d.style.cssText = `position:absolute;left:${x - 3}px;top:${y - 3}px;width:${w + 6}px;height:${h + 6}px;border:${line};border-radius:6px;box-sizing:border-box;${b.kind === "pick" ? "box-shadow:0 0 0 4px rgba(167,139,250,.25)" : ""}`;
        if (b.label) {
          const t = document.createElement("span");
          t.textContent = b.label;
          t.style.cssText = "position:absolute;left:-3px;top:-24px;font:600 12px/18px system-ui;padding:1px 7px;border-radius:5px;background:#a78bfa;color:#0b0b0d;white-space:nowrap";
          d.appendChild(t);
        }
        root.appendChild(d);
      }
      document.documentElement.appendChild(root);
    }, boxes).catch(() => {});
    try { return await this.shot(); }
    finally { await this.page.evaluate(() => document.getElementById("__remuse_marks")?.remove()).catch(() => {}); }
  }

  private heal(h: Run["heals"][number]) {
    if (!this.run.heals.some((x) => x.step === h.step && x.to === h.to)) this.run.heals.push(h);
  }

  answer(a: Answer) {
    if (!this.resolve) throw new Error("nothing is waiting for an answer");
    const r = this.resolve; this.resolve = null; this.run.pending = null; r(a);
  }

  stop() { this.stopped = true; if (this.resolve) this.answer({ decision: "reject" }); }

  private wait(p: Pending): Promise<Answer> {
    // Nobody is waiting on a practice: a question it would ask ends it, and is part of what it reports.
    if (this.practicing) {
      if (p.kind === "ask") this.run.practice!.asked = p.question;
      throw new PracticeEnd(p.kind === "ask" ? `In a real run I'd ask you: ${p.question}` : "");
    }
    this.run.pending = p; this.changed();
    return new Promise((r) => { this.resolve = r; });
  }

  async start(limit?: number) {
    this.headless = process.env.HEADLESS === "1" || !this.run.visible;
    if (checker().independent) this.run.checker = checker().name;
    // Your own Chrome when the extension is linked: your real logins, nothing copied. Remuse's own browser
    // when Chrome is closed, and for tasks that upload or save files (the extension can't hand those over).
    const steps = [...this.spec.steps, ...Object.values(this.spec.outcomes).flatMap((o) => o.steps)];
    this.inChrome = chromeReady() && process.env.REMUSE_OWN_BROWSER !== "1" && !this.spec.saveDownloads && !steps.some((x) => x.do === "upload");
    try {
      // Inside the try: a browser that fails to open ends the run as failed, instead of leaving it "starting".
      const browser = this.inChrome ? await openChrome() : await openBrowser(this.headless);
      this.run.browser = this.inChrome ? "chrome" : "own"; this.changed();
      this.ctx = browser;
      this.page = browser.pages()[0] ?? (await browser.newPage());
      if (this.inChrome && this.run.visible) await this.page.bringToFront().catch(() => {});
      // A practice keeps nothing: no downloads saved, no files marked as posted, no updates sent.
      const keep = this.practicing ? undefined : findFolder(this.spec.saveDownloads ?? null);
      // Downloads in flight: an item (and the run) waits for them before the browser closes.
      const saving: Promise<void>[] = [];
      const settle = async () => { if (!keep) return; await this.page.waitForTimeout(1000).catch(() => {}); await Promise.allSettled(saving); };
      if (keep) {
        const watch = (pg: Page) => pg.on("download", (d) => {
          const it = this.item;
          saving.push((async () => {
            try {
              const to = freeName(keep, d.suggestedFilename());
              await d.saveAs(to);
              it?.log.push({ at: Date.now(), msg: `Saved ${to.split(/[\\/]/).pop()} to ${keep.name}`, level: "ok" }); this.changed();
            } catch (e) { it?.log.push({ at: Date.now(), msg: `Couldn't save a download: ${(e as Error).message}`, level: "warn" }); this.changed(); }
          })());
        });
        this.watch = (ctx) => { ctx.pages().forEach(watch); ctx.on("page", watch); };
        this.watch(browser);
      }
      const { source, listUrl, itemSelector } = this.spec.inputs;
      if (source === "once") {
        // Nothing to go through: a check or an update that runs as one item.
        this.run.items = [{ url: "", label: (this.spec.title ?? this.spec.goal).slice(0, 90), status: "waiting", vars: {}, log: [] }];
      } else if (source === "rows") {
        // One item per row the person gave; its columns become the item's variables. A practice uses the
        // row from the demo.
        const demoRow = Object.fromEntries((this.spec.inputs.columns ?? []).map((c) => [c.name, c.demoValue]));
        const rows = this.practicing ? [demoRow] : (this.run.rows ?? []).slice(0, limit);
        if (!rows.length) throw new Error("this task needs rows to work on, and none were given");
        this.run.items = rows.map((r) => ({ url: "", label: Object.values(r).join(" · ").slice(0, 90), status: "waiting", vars: { ...r }, log: [] }));
      } else {
        await this.page.goto(listUrl!);
        // An item is a link, or something that opens when clicked (a Discord post, a card): then it's found by position.
        await this.page.locator(itemSelector ?? "a").first().waitFor({ timeout: 15_000 }).catch(() => {});
        const links = await this.page.$$eval(itemSelector ?? "a", (els) => els.map((el, index) => ({
          url: (el.closest("a[href]") as HTMLAnchorElement | null)?.href ?? (el.querySelector("a[href]") as HTMLAnchorElement | null)?.href ?? "",
          label: (el as HTMLElement).innerText.replace(/\s+/g, " ").trim().slice(0, 90), index,
        })));
        const expected = await this.expectedOutcomes();
        // Only what is new since earlier runs; "how many" counts new ones.
        const seen = new Map<string, number>();
        const keyed = [...links].reverse().map((l) => { const k = itemKey(l); const n = (seen.get(k) ?? 0) + 1; seen.set(k, n); return { ...l, key: n > 1 ? `${k}#${n}` : k }; }).reverse();
        const fresh = this.practicing || !this.handled ? keyed : keyed.filter((l) => !this.handled!.has(l.key));
        if (!this.practicing) this.run.alreadyDone = links.length - fresh.length;
        let pick = fresh.slice(0, limit ?? fresh.length);
        if (this.practicing) {
          // The very item from the demo, so what it reads can be compared with what the person saw.
          // Whole address first (items often differ only by ?id= or #/path), then without the fragment, then by
          // path only when that names exactly one item, then by its text.
          const ex = this.example;
          const noTrail = (u: string) => u.replace(/\/$/, "");
          const unique = (f: (u: string) => string) => {
            if (!ex?.url) return undefined;
            const m = keyed.filter((l) => l.url && f(l.url) === f(ex.url!));
            return m.length === 1 ? m[0] : undefined;
          };
          const text = ex?.label?.replace(/\s+/g, " ").trim().slice(0, 40);
          // Path only when the example had no ?query: with ?id= links, a lone other email isn't the example.
          const hit = unique(noTrail) ?? unique((u) => noTrail(u.split("#")[0])) ?? (ex?.url?.includes("?") ? undefined : unique((u) => noTrail(u.split(/[?#]/)[0])))
            ?? (text ? keyed.find((l) => l.label?.includes(text)) : undefined);
          this.run.practice!.sameItem = !!hit;
          pick = (hit ? [hit] : keyed.slice(0, 1));
        }
        this.run.items = pick.map((l) => ({ ...l, status: "waiting", vars: {}, log: [], expected: expected[l.url.split("/").pop()!] }));
      }
      if (this.practicing && source !== "list") this.run.practice!.sameItem = true;
      this.run.status = "running"; this.changed();
      const pass = async (phase: "all" | "plan" | "act") => {
        for (this.run.current = 0; this.run.current < this.run.items.length && !this.stopped; this.run.current++) {
          const it = this.item;
          if (phase === "act" && it.status !== "planned") continue; // skipped or failed while planning
          it.status = "running"; this.changed();
          try { await this.runItem(phase); }
          catch (e) {
            if (e instanceof PracticeEnd) { it.status = this.run.practice?.asked ? "skipped" : "done"; if (e.message) this.log(e.message, "ok"); }
            else { it.status = "failed"; this.log(`Stopped this item: ${(e as Error).message}`, "error"); }
          }
          await settle();
        }
      };
      const gated = gatedStep;
      // Planning walks the shared steps twice (to look, then to act), so it's only for tasks whose shared part
      // just reads: nothing to approve, upload or download there.
      const canPlan = !this.spec.saveDownloads && !this.spec.steps.some((s) => gated(s) || s.do === "upload");
      if (this.run.plan && canPlan && this.run.items.length > 1 && !this.practicing) {
        // Look at everything first (questions come now, while you're here), then show the plan and wait for Go.
        let cancelled = false;
        this.run.phase = "plan";
        await pass("plan");
        const planned = this.run.items.filter((i) => i.status === "planned");
        if (!this.stopped && planned.length) {
          const counts: Record<string, number> = {};
          for (const i of planned) counts[i.outcome!] = (counts[i.outcome!] ?? 0) + 1;
          this.run.current = this.run.items.length; // no item is "live" while the plan waits
          const plan: Pending = { kind: "plan", item: 0, counts, needsOk: planned.filter((i) => (this.spec.outcomes[i.outcome!]?.steps ?? []).some(gated)).length,
            skipped: this.run.items.filter((i) => i.status === "skipped").length, failed: this.run.items.filter((i) => i.status === "failed").length };
          // Only Go starts it: a stray answer meant for something else (a question) waits again.
          let a = await this.wait(plan);
          while (!["approve", "approve_all", "reject", "skip"].includes(a.decision ?? "") && !this.stopped) a = await this.wait(plan);
          if (a.decision === "reject" || a.decision === "skip") { this.stopped = true; cancelled = true; }
          else if (!this.stopped) {
            if (a.decision === "approve_all") this.run.autoApprove = true;
            this.run.phase = "act";
            await pass("act");
          }
        }
        // Anything planned but not done (cancelled at the plan, or stopped on the way) says so.
        for (const i of this.run.items.filter((x) => x.status === "planned")) {
          i.status = "skipped";
          i.log.push({ at: Date.now(), msg: cancelled ? "Not done: cancelled at the plan." : "Not done: the run was stopped.", level: "info" });
        }
      } else await pass("all");
      this.run.status = this.stopped ? "stopped" : "done";
      this.scoreRun();
    } catch (e) {
      this.run.status = "failed"; this.run.error = (e as Error).message;
    } finally {
      if (this.practicing) this.run.practice = this.practiceResult();
      this.run.endedAt = Date.now(); this.run.pending = null; this.changed();
      await this.ctx?.close().catch(() => {}); // after a sign-in pause this is a new browser, not `browser`
    }
  }

  // Mock apps only: the seed knows the right answer per email, so a run can be scored.
  private async expectedOutcomes(): Promise<Record<string, string>> {
    try { return (await (await fetch(`${MOCK}/api/state`)).json()).expected ?? {}; } catch { return {}; }
  }
  private scoreRun() {
    const scored = this.run.items.filter((i) => i.expected && i.outcome);
    // "ask" means the rules should not decide alone: asking you, or reusing your answer, is right.
    const right = (i: Item) => i.status === "done" && (i.expected === "ask" ? i.decidedBy !== "rules" : meaning(i.outcome) === i.expected);
    if (scored.length) this.run.score = { matched: scored.filter(right).length, total: scored.length };
  }

  /** How the practice went, against the demo: same values read, same choice made, where it stopped. */
  private practiceResult(): Practice {
    const p = this.run.practice ?? { sameItem: false, values: [], checked: 0, ok: false };
    const it = this.run.items[0];
    if (!it) return { ...p, problem: this.run.error ?? "there was nothing to practice on", ok: false };
    const shown = Object.entries(this.spec.outcomes).filter(([, o]) => o.demonstrated).map(([k]) => k);
    const expected = shown.length === 1 ? shown[0] : undefined;
    // Read on the same item, a value should be what the person saw. Values worked out from today's date, or
    // read on a page that changes (a "once" check), only need to be found.
    const exact = p.sameItem && this.spec.inputs.source !== "once";
    const values = this.spec.variables.filter((v) => !v.candidate && v.demoValue !== undefined && v.demoValue !== null).map((v) => {
      const got = it.vars[v.name] ?? null;
      return { name: v.name, got, want: v.demoValue, ok: got !== null && (!exact || v.kind === "computed" || same(got, v.demoValue)) };
    });
    // Failed: its last error. Skipped without a question (e.g. nothing new to upload): what it said.
    const problem = it.status === "failed" ? it.log.filter((l) => l.level === "error").at(-1)?.msg.replace(/^Stopped this item: /, "")
      : it.status === "skipped" && !p.asked ? it.log.at(-1)?.msg ?? "it skipped your example"
      : this.run.error;
    const checked = it.log.filter((l) => l.msg.startsWith("✓")).length;
    const choseRight = !expected || !p.sameItem || it.outcome === expected;
    return { ...p, outcome: it.outcome, expected, values, checked, problem,
      ok: !problem && !p.asked && it.status === "done" && choseRight && values.every((v) => v.ok) };
  }

  /** One item. "plan": read and decide only (asking now if it must). "act": go back to the item the same way,
   *  reusing what was read (nothing is read or judged twice), then do what was decided. "all": both at once. */
  private async runItem(phase: "all" | "plan" | "act" = "all") {
    this.phase = phase;
    const it = this.item;
    if (phase === "act") {
      if (!this.spec.outcomes[it.outcome!]?.steps.length) { it.status = "done"; this.changed(); return; } // nothing to do
      this.log(`Doing it now: ${it.outcome?.replaceAll("_", " ")}`, "info");
      for (const [i, step] of this.spec.steps.entries()) if (!(await this.step(step, this.spec.steps[i + 1]?.tab))) return;
      return this.act();
    }
    it.vars = { ...it.vars, item_url: it.url, today: manila() };
    const labels = Object.keys(this.prev);
    // A "once" task is the same single item every time even if its name changed; other items match by label only.
    const before = this.prev[it.label] ?? (this.spec.inputs.source === "once" && labels.length === 1 ? this.prev[labels[0]] : undefined);
    for (const v of this.spec.variables) it.vars[`prev_${v.name}`] = before?.[v.name] ?? null;
    for (const [i, step] of this.spec.steps.entries()) if (!(await this.step(step, this.spec.steps[i + 1]?.tab))) return;
    for (const v of this.spec.variables.filter((x) => x.kind === "computed" && !x.candidate)) {
      it.vars[v.name] = this.rules.compute[v.name]?.(it.vars);
      this.log(`${v.name} = ${JSON.stringify(it.vars[v.name])} (computed)`, "info");
    }

    // Decide. Your own rules come first: one that clearly applies (anything but the "otherwise" catch-all) decides,
    // whatever kind of request it is. Only what would fall through to "otherwise" looks at the kind: a kind your rules
    // were meant for takes "otherwise", one you answered for earlier in this run takes that answer, any other is asked.
    const typeVar = "item_type" in it.vars ? "item_type" : "request_type";
    const rt = it.vars[typeVar] as string | undefined;
    const learned = this.run.learned.find((l) => l.requestType === rt);
    const missing = this.spec.variables.filter((v) => v.kind !== "computed" && !v.candidate && (it.vars[v.name] === null || it.vars[v.name] === undefined)).map((v) => v.name);
    let reply: string | undefined;
    let d: { outcome: string; rule: number } | null = null;
    if (!missing.length) { try { d = this.rules.decide(it.vars); } catch (e) { d = null; this.log(`My rules' code failed on this one (${(e as Error).message.slice(0, 100)}).`, "warn"); } }
    const matched = d ? this.baseRules[d.rule] : undefined;
    // The catch-all: worded "otherwise", or simply your last rule (the model may phrase it "photo shows no damage"), or
    // a rule index that doesn't line up with its outcome. Misjudging this way only asks more; it never acts more.
    const catchAll = !matched || !d || matched.then !== d.outcome || d.rule === this.baseRules.length - 1 || /^\s*(otherwise|else|default)\b/i.test(matched.if);
    const outOfScope = !!rt && !!this.spec.scopeTypes?.length && !this.spec.scopeTypes.includes(rt);
    const ask = async (question: string, note: string, requestType?: string) => {
      const { file } = await this.shot();
      this.log(note, "warn", file);
      it.status = "asking";
      const a = await this.wait({ kind: "ask", item: this.run.current, requestType, shot: file, options: Object.keys(this.spec.outcomes), question });
      it.status = "running";
      return a;
    };
    // Decided by your rules; before anything irreversible that rests on a judgement, the checker looks too.
    const byRules = async () => {
      it.outcome = d!.outcome;
      it.decidedBy = "rules"; it.because = matched ? `${matched.if}${matched.said ? ` ("${matched.said}")` : ""}` : "rule " + d!.rule;
      if (checker().independent && (this.spec.outcomes[it.outcome!]?.steps ?? []).some(gatedStep)) {
        const a = await this.secondLook(it);
        if (a) {
          if (!a.outcome || !this.spec.outcomes[a.outcome]) { it.status = "skipped"; it.byYou = !this.stopped; this.log("Skipped, as you asked.", "info"); return false; }
          it.outcome = a.outcome; reply = a.reply || undefined;
          it.because = `You decided when the two models disagreed${a.note ? `: ${a.note}` : ""}`; it.decidedBy = "you";
        }
      }
      return true;
    };
    if (missing.length) {
      // Deciding without the facts would be a guess (an answer you gave earlier for this kind included).
      const a = await ask(`I couldn't read ${missing.join(", ")} for "${it.label}". What should I do?`, `I couldn't read ${missing.join(", ")}, so I won't guess.`);
      if (!a.outcome || !this.spec.outcomes[a.outcome]) { it.status = "skipped"; it.byYou = !this.stopped; this.log("Skipped, as you asked.", "info"); return; }
      it.outcome = a.outcome; reply = a.reply || undefined;
      it.because = `You told me${a.note ? `: ${a.note}` : ""}`; it.decidedBy = "you";
    } else if (d && !catchAll) {
      if (!(await byRules())) return;
    } else if (learned) {
      it.outcome = learned.outcome; reply = learned.reply;
      it.decidedBy = "learned"; it.because = `You showed me what to do with "${rt}" earlier in this run${learned.note ? `: ${learned.note}` : ""}`;
    } else if (outOfScope) {
      const a = await ask(`"${it.label}" looks like ${rt!.replace(/_/g, " ")}. None of your rules is about that. What should I do?`, `This looks like "${rt}". None of your rules is about that, so I'm asking.`, rt);
      if (!a.outcome || !this.spec.outcomes[a.outcome]) { it.status = "skipped"; it.byYou = !this.stopped; this.log("Skipped, as you asked.", "info"); return; }
      it.outcome = a.outcome; reply = a.reply || undefined;
      it.because = `You told me${a.note ? `: ${a.note}` : ""}`; it.decidedBy = "you";
      if (a.learn !== false) {
        this.run.learned.push({ requestType: rt!, outcome: a.outcome, note: a.note, reply: a.reply || undefined });
        this.spec.rules.unshift({ if: `${typeVar} is ${rt}`, then: a.outcome, said: a.note, learned: true });
        this.spec.scopeTypes.push(rt!);
        this.log(`Learned: "${rt}" → ${a.outcome}. I'll do the same for the next one (your other rules still come first).`, "ok");
      }
    } else if (d) {
      if (!(await byRules())) return;
    } else throw new Error("my rules couldn't decide this one");
    // The values it decided on, in plain words, kept with the decision.
    const read = this.spec.variables.filter((x) => !x.candidate && it.vars[x.name] !== null && it.vars[x.name] !== undefined && typeof it.vars[x.name] !== "object")
      .map((x) => `${x.name.replaceAll("_", " ")} ${short(String(it.vars[x.name]))}${it.vars[`prev_${x.name}`] != null ? ` (last time ${short(String(it.vars[`prev_${x.name}`]))})` : ""}`).join(" · ");
    this.log(`Decision: ${it.outcome}, because ${it.because}`, "ok", undefined, { why: it.decidedBy === "rules" && read ? `What it read: ${read}` : undefined });

    const out = this.spec.outcomes[it.outcome!];
    if (!out) throw new Error(`no steps for outcome "${it.outcome}"`);
    // Kept as written: {{values}} in it are filled where it's typed (render goes one level deep), so values
    // that only exist later, like an uploaded file's name, still come out right.
    it.vars.reply = reply ?? out.reply ?? null;
    if (phase === "plan") { it.status = "planned"; this.changed(); return; }
    return this.act();
  }

  /** The second model's answers to the same judgement questions (same page text and photos, none of the first
   *  answers). Agreement is noted on the item; a disagreement is put to the person, whose answer is returned. */
  private async secondLook(it: Item): Promise<Answer | null> {
    const j = this.judged.get(this.run.current);
    if (!j) return null;
    this.judged.delete(this.run.current); // done with its photos, whatever happens next
    const c = checker();
    let r: Record<string, unknown>;
    try { r = await askJson(j.parts, "second opinion", c.model); }
    catch (e) { this.log(`No second opinion this time (${c.name} didn't answer: ${(e as Error).message.slice(0, 80)}).`, "warn"); return null; }
    const norm = (a: unknown) => { const s = typeof a === "string" ? a.trim().toLowerCase() : a; return s === "true" ? true : s === "false" ? false : s ?? null; };
    const nice = (n: string) => n.replaceAll("_", " ");
    // The checker's answer to a question: {answer} or a bare value. Missing, or not one of the allowed answers: no opinion.
    const theirs = (n: string) => {
      const raw = r[n] && typeof r[n] === "object" && "answer" in (r[n] as object) ? (r[n] as any).answer : r[n];
      const v = this.spec.variables.find((x) => x.name === n);
      const a = norm(raw);
      if (a === null || a === undefined) return undefined;
      if (v?.kind === "vision") return typeof a === "boolean" ? a : undefined;
      return !v?.options?.length || v.options.some((o) => o.toLowerCase() === a) ? a : undefined;
    };
    const differ = j.names.filter((n) => theirs(n) !== undefined && JSON.stringify(theirs(n)) !== JSON.stringify(norm(it.vars[n])));
    if (j.names.every((n) => theirs(n) === undefined)) { this.log(`No second opinion this time (${c.name}'s answer couldn't be used).`, "warn"); return null; }
    if (!differ.length) {
      this.log(`Second opinion: ${c.name} agrees`, "ok", undefined, { why: `Asked the same on its own: ${j.names.map((n) => `${nice(n)} ${theirs(n) === undefined ? "(no answer)" : JSON.stringify(it.vars[n])}`).join(" · ")}`, by: c.name });
      return null;
    }
    const said = differ.map((n) => `${nice(n)}: Muse Spark says ${JSON.stringify(it.vars[n])}, ${c.name} says ${JSON.stringify(theirs(n))}${(r[n] as any)?.why ? ` (${(r[n] as any).why})` : ""}`).join("; ");
    const { file } = await this.shot();
    this.log("The two models disagree, so I'm asking you before I act.", "warn", file, { why: said, by: c.name });
    it.status = "asking";
    const a = await this.wait({ kind: "ask", item: this.run.current, shot: file, options: Object.keys(this.spec.outcomes),
      question: `On "${it.label}" the two models disagree (${said}). My rules would ${it.outcome?.replaceAll("_", " ")}. What should I do?` });
    it.status = "running";
    return a;
  }

  /** Do what was decided for this item: its outcome's steps. */
  private async act() {
    this.phase = "all"; // the outcome's own steps (a compare, a read) run normally
    const it = this.item;
    for (const step of this.spec.outcomes[it.outcome!].steps) {
      if (!(await this.step(step))) return;
      if (it.status === "skipped") return;
    }
    it.status = "done"; this.changed();
    if (it.vars.file_name && this.taskKey && !this.practicing) markUsed(this.taskKey, [String(it.vars.file_name)]);
  }

  /** Pick a file from an allowed folder by the task's rule and hand it to the page's upload control. */
  private async upload(raw: Step, step: Step) {
    const it = this.item;
    const rule = raw.file ?? { folder: null };
    const folder = findFolder(rule.folder);
    if (!folder) throw new Error(rule.folder ? `the folder "${rule.folder}" isn't allowed any more; add it on the Folders page` : "choose which folder to upload from on the task page");
    // A run started by a file landing posts exactly that file; otherwise the task's own rule picks.
    const name = this.file && folder.name === this.file.folder && !usedFor(this.taskKey).has(this.file.name) ? this.file.name : this.file ? null : chooseFile(folder, rule, usedFor(this.taskKey));
    if (!name) throw new Skip(`Nothing new to upload in ${folder.name} right now (${rule.pick ?? "next"} file). Skipped.`);
    const path = pathIn(folder, name);
    it.vars.file_name = name;
    it.vars.file_caption = captionFor(folder, name);
    // Most sites keep a hidden file input; set it directly. Otherwise click their button and answer the file picker.
    const input = this.page.locator('input[type="file"]');
    if (await input.count()) await input.first().setInputFiles(path);
    else {
      const found = raw.target ? await this.locate(raw, step) : null;
      const [chooser] = await Promise.all([
        this.page.waitForEvent("filechooser", { timeout: 10_000 }),
        found?.loc ? found.loc.click() : found?.point ? this.page.mouse.click(found.point.x, found.point.y) : Promise.reject(new Error("no upload button found")),
      ]);
      await chooser.setFiles(path);
    }
    await this.page.waitForTimeout(1500); // let the site read the file and show its preview
    const { file } = await this.shot();
    this.log(`Uploaded ${name} from ${folder.name}${it.vars.file_caption ? " (with its caption)" : ""}`, "ok", file);
  }

  /** Switch to the tab a step names. A new name takes the starting tab first, then a tab the site opened
   *  by itself (a link that opens in a new tab), else a fresh tab. Tabs stay as they were left. */
  private async useTab(name: string, opensItself: boolean) {
    if (name === this.tabName && !this.page.isClosed()) return;
    let p = this.tabs.get(name);
    if (!p || p.isClosed()) {
      const claimed = new Set([...this.tabs.values()]);
      const unclaimed = () => this.ctx.pages().filter((x) => !x.isClosed() && !claimed.has(x));
      if (!this.tabs.size && !this.page.isClosed()) p = this.page;
      else {
        // The site's new tab can show up a moment after the click that opened it.
        if (!unclaimed().length && opensItself) await this.ctx.waitForEvent("page", { timeout: 5000 }).catch(() => {});
        p = unclaimed().at(-1) ?? (await this.ctx.newPage());
        if (p.url() === "about:blank" && opensItself) await p.waitForURL((u) => u.href !== "about:blank", { timeout: 15_000 }).catch(() => {});
      }
      this.tabs.set(name, p);
      await p.waitForLoadState("domcontentloaded").catch(() => {});
    }
    this.page = p; this.tabName = name;
    await p.bringToFront().catch(() => {});
    this.log(`In the ${name} tab`, "info");
  }

  private hasTool(name: string) {
    return this.page.evaluate((n) => !!(window as any).__showrunTools?.has(n), name).catch(() => false);
  }

  /** Run one step. If it gets stuck (sign-in wall, captcha, popup), hand the browser to the person:
   *  they fix it and press Try again, or skip the item. Returns false when the item was skipped. */
  private async step(s: Step, nextTab?: string): Promise<boolean> {
    for (;;) {
      try { await this.exec(s, nextTab); return true; }
      catch (e) {
        if (e instanceof PracticeEnd) throw e;
        if (e instanceof Skip) { this.item.status = "skipped"; this.log(e.message, "info"); return false; }
        // A practice never waits on the person: whatever is in the way is what it reports.
        if (this.practicing) {
          if (await this.onSignInPage()) throw new Error(`a sign-in page is in the way (${new URL(this.page.url()).hostname}); sign in there once, then practice again`);
          throw e;
        }
        // A sign-in page in the way: hidden or not, pause and let the person sign in once in plain Chrome.
        if (!this.stopped && !this.inChrome && (await this.onSignInPage())) {
          if (await this.signIn(s)) continue;
          this.item.status = "skipped"; return false;
        }
        // A hidden run has no window to hand over: the item fails and says why instead of waiting forever.
        // In your Chrome there's always a window to hand over; in Remuse's hidden browser there isn't.
        if (this.stopped || (!this.inChrome && (process.env.HEADLESS === "1" || !this.run.visible))) throw e;
        if (this.inChrome) await this.page.bringToFront().catch(() => {});
        const { file } = await this.shot();
        const it = this.item;
        this.log(`Stuck on "${s.describe}": ${(e as Error).message}`, "warn", file);
        it.status = "asking";
        const a = await this.wait({ kind: "handoff", item: this.run.current, step: s.describe, problem: (e as Error).message, shot: file });
        it.status = "running";
        if (a.decision !== "retry") { it.status = "skipped"; this.log("Skipped, as you asked.", "info"); return false; }
        this.log("Trying again.", "info");
      }
    }
  }

  private async onSignInPage() {
    if (this.page.isClosed()) return false;
    return SIGN_IN.test(this.page.url()) || (await this.page.locator("input[type=password]:visible").count().catch(() => 0)) > 0;
  }

  /** A sign-in page is in the way. Close the run's browser, open the same page in plain Chrome on the same
   *  profile, and wait for the person to sign in and close that window (or answer on the run page). Then
   *  reopen every tab where it was and carry on. Returns false if they chose to skip. */
  private async signIn(s: Step): Promise<boolean> {
    const url = this.page.url(), site = new URL(url).hostname.replace(/^www\./, "");
    const { file } = await this.shot();
    const tabs = [...this.tabs].map(([name, p]) => [name, p.isClosed() ? "" : p.url()] as const);
    const here = this.tabName;
    await this.ctx.close().catch(() => {});
    if (!openPlainChrome(url)) throw new Error(`a sign-in page is in the way (${site}) and Chrome isn't installed to show it`);
    const problem = `This needs you to sign in to ${site}. Sign in in the Chrome window that just opened, then close that window. I'll carry on by myself.`;
    this.log(`Waiting for you to sign in to ${site}`, "warn", file);
    notify("Remuse needs you to sign in", `Sign in to ${site} in the window that opened, then close it.`, `http://127.0.0.1:${process.env.PORT ?? 3200}/#/run/${this.run.id}`);
    this.item.status = "asking";
    const answer = this.wait({ kind: "handoff", item: this.run.current, step: s.describe, problem, shot: file });
    // ponytail: polls the process list every 2 s, up to 30 min; a scheduled run waits that long at most.
    let a: Answer | null = null;
    answer.then((x) => { a = x; });
    for (let i = 0; i < 900 && !a && plainChromeOpen(); i++) await new Promise((r) => setTimeout(r, 2000));
    if (!a) { if (plainChromeOpen()) this.answer({ decision: "skip" }); else this.answer({ decision: "retry" }); }
    const got = (await answer) as Answer;
    this.item.status = "running";
    // Back to work: the same browser profile, now signed in, every tab where it was.
    this.ctx = await openBrowser(this.headless);
    this.watch(this.ctx);
    this.tabs = new Map();
    for (const [name, u] of tabs) {
      const p = this.tabs.size ? await this.ctx.newPage() : this.ctx.pages()[0] ?? (await this.ctx.newPage());
      if (u) await p.goto(u).catch(() => {});
      this.tabs.set(name, p);
    }
    this.page = this.tabs.get(here) ?? this.ctx.pages()[0] ?? (await this.ctx.newPage());
    if (!this.tabs.size) await this.page.goto(url).catch(() => {});
    if (got.decision !== "retry") { this.log("Skipped, as you asked.", "info"); return false; }
    this.log(`Signed in to ${site}. Carrying on.`, "ok");
    return true;
  }

  /** Open the top results on this page, read the same values on each, keep the best by the person's rule. */
  private async compare(step: Step) {
    const it = this.item;
    const shape = step.resultHref ? urlShape(step.resultHref) : "";
    const sel = step.resultSelector || "a[href]";
    const links = await this.page.$$eval("a[href]", (as, sel) => as.map((a) => ({
      url: (a as HTMLAnchorElement).href.split("#")[0],
      title: ((a as HTMLElement).innerText || a.getAttribute("title") || a.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 120),
      bySelector: a.matches(sel) || !!a.querySelector(sel) || !!a.closest(sel),
    })), sel).catch(() => [] as { url: string; title: string; bySelector: boolean }[]);
    // Same URL shape as the result opened in the demo (any site); the recorded selector only as a fallback.
    const pick = shape ? links.filter((l) => urlShape(l.url) === shape) : links.filter((l) => l.bySelector);
    const seen = new Set<string>();
    const results = pick.filter((l) => { const k = l.url.split("?")[0]; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, step.max ?? 5);
    if (!results.length) throw new Error("found no results to compare on this page");
    this.log(`Comparing the top ${results.length} results.`, "info");

    const names = step.vars ?? [];
    const computed = this.spec.variables.filter((v) => v.candidate && v.kind === "computed");
    it.candidates = [];
    for (const r of results) {
      if (this.stopped) throw new Error("run stopped");
      await this.page.goto(r.url);
      await this.page.waitForLoadState("domcontentloaded").catch(() => {});
      const c: Record<string, unknown> = {};
      await this.extract(names.filter((n) => !computed.some((v) => v.name === n)), c);
      for (const v of computed) { try { c[v.name] = this.rules.compute[v.name]?.({ ...it.vars, ...c }); } catch { c[v.name] = null; } }
      let score: number | null = null;
      try { const s = this.rules.score?.(c, it.vars); score = typeof s === "number" && Number.isFinite(s) ? s : null; } catch { score = null; }
      // The result's own name: its link text, else the page heading, else the tab title (often just the site name).
      const h1 = await this.page.locator("h1").first().innerText({ timeout: 500 }).catch(() => "");
      const title = (r.title || h1.replace(/\s+/g, " ").trim() || (await this.page.title().catch(() => ""))) || r.url;
      const { file } = await this.shot();
      it.candidates.push({ url: this.page.url(), title: title.slice(0, 120), vars: c, score, shot: file });
      this.log(`${title.slice(0, 60)}: ${score === null ? "doesn't qualify" : `score ${+score.toFixed(3)}`}`, "info", file);
    }

    const ok = it.candidates.filter((c) => c.score !== null).sort((a, b) => b.score! - a.score!);
    it.vars.candidates_found = ok.length;
    if (!ok.length) { this.log("None of the results qualify under your rule.", "warn"); return; }
    const best = ok[0];
    best.best = true;
    for (const [k, val] of Object.entries(best.vars)) it.vars[`best_${k}`] = val;
    it.vars.best_url = best.url; it.vars.best_title = best.title;
    await this.page.goto(best.url);
    this.log(`Best: ${best.title} (score ${+best.score!.toFixed(3)}, ${ok.length} of ${it.candidates.length} qualify)`, "ok");
  }

  private async exec(raw: Step, nextTab?: string) {
    const it = this.item;
    const v = it.vars;
    const step: Step = { ...raw, url: render(raw.url, v), value: render(raw.value, v),
      target: raw.target && { ...raw.target, name: render(raw.target.name, v) },
      expect: raw.expect && { ...raw.expect, urlIncludes: render(raw.expect.urlIncludes, v), textIncludes: render(raw.expect.textIncludes, v) } };
    if (this.stopped) throw new Error("run stopped");
    let aim: string | undefined;
    // A new tab whose first step isn't a "goto" is one the site opened (the previous click did it).
    if (raw.tab) await this.useTab(raw.tab, raw.do !== "goto");

    // Reading a page counts too: the values must come from the account in your demo.
    if (step.do === "extract" || step.do === "compare") await this.rightAccount("act", raw);
    if (step.do === "open_item") {
      // In the demo the item opened in its own tab (the next step is in another tab): open it there.
      if (nextTab && raw.tab && nextTab !== raw.tab) {
        const p = this.tabs.get(nextTab);
        const into = p && !p.isClosed() ? p : await this.ctx.newPage();
        this.tabs.set(nextTab, into);
        await into.goto(it.url);
        await this.rightAccount("open", raw, into);
        this.log(`Opened ${this.spec.inputs.itemName ?? "the item"} in the ${nextTab} tab`, "info");
        return;
      }
      if (it.url) { await this.page.goto(it.url); await this.rightAccount("open", raw); }
      else {
        // Opens by clicking: back to the list, click the same position.
        const { listUrl, itemSelector } = this.spec.inputs;
        // Acting after a plan, the list is loaded fresh: it may have changed while the plan waited for Go.
        if (listUrl && (this.page.url() !== listUrl || this.phase === "act")) await this.page.goto(listUrl);
        const el = this.page.locator(itemSelector!).nth(it.index ?? 0);
        await el.waitFor({ timeout: 15_000 });
        // Acting after a plan: the list may have moved, so the item at this position must still be the one planned.
        if (this.phase === "act") {
          const label = (await el.innerText()).replace(/\s+/g, " ").trim().slice(0, 90);
          if (label !== it.label) throw new Skip(`The list moved since the plan (in its place is now “${label.slice(0, 50)}”), so I left this one alone.`);
        }
        await el.click();
        await this.page.waitForTimeout(1500);
      }
    }
    else if (step.do === "goto") { await this.page.goto(step.url!); await this.rightAccount("open", raw); }
    // Acting after a plan: values were read in the planning pass, so they aren't read (or judged) again.
    else if (step.do === "extract") return this.phase === "act" ? this.stillTheSame(step.vars ?? []) : this.extract(step.vars ?? []);
    else if (step.do === "compare") {
      if (this.phase !== "act") return this.compare(step);
      if (it.vars.best_url) await this.page.goto(String(it.vars.best_url)); // back to the result it chose
      return;
    }
    else if (step.do === "upload") {
      if (this.phase === "plan") return; // planning only looks; the upload happens when it acts
      if (this.unsure(raw)) await this.approve(step);
      await this.rightAccount("act", raw);
      return this.upload(raw, step);
    }
    else if (step.do === "report" && this.phase === "plan") return;
    else if (step.do === "report") {
      // Tell the person: a Windows notification, and the update is kept on the run.
      // A value that doesn't exist yet (no previous run to compare with) drops its "(… since last time)"
      // part instead of leaving a gap; any other missing value shows as a dash.
      const NONE = "\u0000";
      const msg = (raw.message ?? step.describe).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (v[k] === undefined || v[k] === null || v[k] === "" ? NONE : k === "reply" ? fill(String(v[k]), v, false) : String(v[k])))
        .replace(/\s*\([^()]*\u0000[^()]*\)/g, "").replaceAll(NONE, "–");
      if (this.practicing) { this.log(`Would tell you: ${msg}`, "ok"); return; }
      it.report = msg;
      this.log(`Update: ${msg}`, "ok");
      notify(this.spec.title ?? "Remuse update", msg, `http://127.0.0.1:${process.env.PORT ?? 3200}/#/run/${this.run.id}`);
      return;
    }
    else if (raw.tool && (await this.hasTool(raw.tool.name))) {
      await this.rightAccount("act", raw);
      // The page offers this action as a WebMCP tool: call it directly instead of clicking. Same approval gate.
      const gated = raw.irreversible || IRREVERSIBLE.test(step.target?.name ?? "") || IRREVERSIBLE.test(raw.tool.name.replace(/_/g, " ")) || this.unsure(raw);
      if (gated && !(await this.approve(step))) return;
      const args = Object.fromEntries(Object.entries(raw.tool.args ?? {}).map(([k, x]) => [k, render(String(x), v)]));
      const out = await this.page.evaluate(async ({ name, args }) => {
        const r = await (window as any).__showrunTools.get(name).execute(args, { requestUserInteraction: async (f: () => unknown) => f?.() });
        return JSON.stringify(r ?? null).slice(0, 200);
      }, { name: raw.tool.name, args });
      this.log(`Used the site's WebMCP tool ${raw.tool.name}(${JSON.stringify(args)}) instead of clicking: ${out}`, "ok");
    }
    else {
      await this.rightAccount("act", raw);
      const found = step.target ? await this.locate(raw, step) : null;
      // The picture kept with the step's check: what it pressed (taken before pressing), or the field after typing
      // (so it shows what the check says). A healed element already has its marked-up screenshot.
      aim = step.do === "fill" && found?.loc ? undefined : found?.shot ?? (found?.loc ? await this.shotNear(found.loc) : undefined);
      if (step.do === "fill") {
        if (found?.loc) { await found.loc.fill(step.value ?? ""); aim ??= await this.shotNear(found.loc); }
        else if (found?.point) { await this.page.mouse.click(found.point.x, found.point.y); await this.page.keyboard.press("Control+A"); await this.page.keyboard.type(step.value ?? ""); }
        else if (!step.target) await this.page.keyboard.type(step.value ?? ""); // no field: type where the focus is (a spreadsheet cell, an editor)
      } else if (step.do === "press") {
        // Enter in a chat box sends: a press the spec marks irreversible waits for the OK like a click does.
        if ((raw.irreversible || this.unsure(raw)) && !(await this.approve(step, found?.loc))) return;
        if (found?.loc) await found.loc.press(step.key ?? "Enter"); else await this.page.keyboard.press(step.key ?? "Enter");
      } else if (step.do === "click") {
        const gated = raw.irreversible || IRREVERSIBLE.test(step.target?.name ?? "") || IRREVERSIBLE.test(found?.healedName ?? "") || this.unsure(raw);
        if (gated && !(await this.approve(step, found?.loc, found?.healedName))) return;
        if (found?.loc) await found.loc.click(); else if (found?.point) await this.page.mouse.click(found.point.x, found.point.y);
      }
    }
    await this.page.waitForLoadState("load").catch(() => {});
    await this.check(step, aim);
  }

  private async approve(step: Step, loc?: Locator, healedName?: string): Promise<boolean> {
    const it = this.item;
    if (this.practicing) {
      // The thing it would do, outlined on the screen, and no further.
      const { file } = await this.shot(loc);
      // A real run asks you here, or (a plain button in the part that acts) would just do it.
      const asks = !!step.irreversible || IRREVERSIBLE.test(step.target?.name ?? "") || IRREVERSIBLE.test(healedName ?? "") || IRREVERSIBLE.test(step.tool?.name.replace(/_/g, " ") ?? "");
      Object.assign(this.run.practice!, { stoppedBefore: step.describe, stoppedForOk: asks });
      this.log(`Next I'd ${step.describe.replace(/^./, (c) => c.toLowerCase())}${healedName ? ` (“${healedName}”)` : ""}. ${asks ? "A real run waits for your OK here" : "That changes something on the site"}, so the practice stops.`, "ok", file);
      throw new PracticeEnd("");
    }
    if (this.run.autoApprove) { this.log(`Approved in advance: ${step.describe}`, "info"); return true; }
    const { file } = await this.shot(loc);
    it.status = "approval";
    const a = await this.wait({ kind: "approval", item: this.run.current, step: step.describe, target: healedName ?? step.target?.name,
      outcome: it.outcome, because: it.because, shot: file, healed: healedName ? `The page changed: I'm using "${healedName}" for "${step.target?.name}".` : undefined });
    it.status = "running";
    if (a.decision === "approve_all") this.run.autoApprove = true;
    if (a.decision === "reject") { it.status = "skipped"; it.byYou = !this.stopped; this.log(`You said no to: ${step.describe}. Skipped this ${this.spec.inputs.itemName ?? "item"}.`, "warn"); return false; }
    this.log(`You approved: ${step.describe}`, "ok");
    return true;
  }

  // DOM first (role + name, then the recorded selector if it still points at the same thing), then vision.
  private async locate(raw: Step, step: Step): Promise<{ loc?: Locator; point?: { x: number; y: number }; healedName?: string; shot?: string }> {
    const t = step.target!;
    if (t.role && t.name) {
      const l = this.page.getByRole(t.role as any, { name: t.name, exact: !t.fuzzy });
      if ((await l.count()) === 1 && (await l.isVisible())) return { loc: l };
    }
    if (t.selector) {
      const l = this.page.locator(t.selector);
      if ((await l.count()) === 1 && (await l.isVisible())) {
        const name = await l.evaluate((el: any) => (el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.innerText || el.value || "").trim());
        // A selector that now points at a differently named element is the wrong element (layout changed).
        if (!t.name || name.toLowerCase() === t.name.toLowerCase()) return { loc: l };
      }
    }
    // Not there because a sign-in page is in the way: say so (the step pauses for sign-in) instead of searching the screen.
    if (await this.onSignInPage()) throw new Error(`a sign-in page is in the way (${new URL(this.page.url()).hostname})`);
    return this.findByVision(raw, step);
  }

  private async findByVision(raw: Step, step: Step) {
    const t = step.target!;
    const kind = t.role === "textbox" ? "text box" : t.role === "link" ? "link" : "button";
    const { buf, file } = await this.shot();
    this.log(`Couldn't find the ${kind} "${t.name}" on the page. Looking at the screen instead (Muse Spark + SAM 3.1).`, "warn", file);
    const box = await ground(buf, `the ${kind} used to: ${step.describe}. It used to be labeled "${t.name}"; if the page was redesigned the label may be different, so pick the ${kind} that does the same job`)
      // Second look with a looser description: any field/button a person would use for this.
      ?? await ground(buf, `the ${kind} a person would ${step.do === "fill" ? "type into" : "click"} to: ${step.describe}. Ignore the old label; any ${kind} that fits the purpose counts`);
    if (!box) throw new Error(`can't find "${t.name}" on the page, even by looking`);
    // SAM 3.1 gives tight boxes for every element of this kind; snap to the one under Muse Spark's box.
    const cx = (box.x_min + box.x_max) / 2, cy = (box.y_min + box.y_max) / 2;
    let use: Box = box;
    let segs: Box[] = [];
    let snapped = false; // SAM 3.1 gave the exact edges of the element Muse Spark pointed at
    try {
      segs = await sam(buf, kind);
      const inside = segs.filter((b) => cx >= b.x_min && cx <= b.x_max && cy >= b.y_min && cy <= b.y_max);
      inside.sort((a, b) => (a.x_max - a.x_min) * (a.y_max - a.y_min) - (b.x_max - b.x_min) * (b.y_max - b.y_min));
      if (inside[0]) { use = inside[0]; snapped = true; }
      else {
        // Muse Spark's box a little off: the SAM 3.1 element that overlaps it most (at least a third, by area), or,
        // failing that, one that is very close and clearly the nearest. Otherwise its own box stands.
        const area = (b: Box) => Math.max(0, b.x_max - b.x_min) * Math.max(0, b.y_max - b.y_min);
        const iou = (b: Box) => { const i = area({ x_min: Math.max(b.x_min, box.x_min), y_min: Math.max(b.y_min, box.y_min), x_max: Math.min(b.x_max, box.x_max), y_max: Math.min(b.y_max, box.y_max) }); return i / (area(b) + area(box) - i || 1); };
        const dist = (b: Box) => Math.hypot((b.x_min + b.x_max) / 2 - cx, (b.y_min + b.y_max) / 2 - cy);
        const overlap = [...segs].sort((a, b) => iou(b) - iou(a))[0];
        const [n1, n2] = [...segs].sort((a, b) => dist(a) - dist(b));
        if (overlap && iou(overlap) >= 0.33) { use = overlap; snapped = true; }
        else if (n1 && dist(n1) <= 25 && (!n2 || dist(n2) >= 1.5 * dist(n1))) { use = n1; snapped = true; }
      }
    } catch (e) { this.log(`SAM 3.1 unavailable (${(e as Error).message.slice(0, 80)}); using Muse Spark's box.`, "warn"); }
    // The page's real size (your Chrome's window can differ from Remuse's own browser), as the screenshot was.
    const [vw, vh] = await this.page.evaluate(() => [innerWidth, innerHeight]).catch(() => [VIEW.width, VIEW.height]);
    const point = { x: ((use.x_min + use.x_max) / 2 / 1000) * vw, y: ((use.y_min + use.y_max) / 2 / 1000) * vh };

    // Read what is really there, so the spec can be updated and the DOM path works next time.
    const found = await this.page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y)?.closest("button, a, input, textarea, select, [role]") as HTMLElement | null;
      if (!el) return null;
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute("role") || (tag === "a" ? "link" : tag === "button" || (el as HTMLInputElement).type === "submit" ? "button" : "textbox");
      const name = (el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.innerText || (el as HTMLInputElement).value || "").replace(/\s+/g, " ").trim();
      return { role, name };
    }, point);
    // The evidence: every SAM 3.1 box for this kind of element, Muse Spark's pick, and the one it will use.
    const seen = await this.marked([...segs.slice(0, 40).map((b) => ({ box: b, kind: "sam" as const })), { box, kind: "spark" }, { box: use, kind: "pick", label: snapped ? "Muse Spark + SAM 3.1" : "Muse Spark" }]);
    const how = { how: "screen" as const, why: `Muse Spark pointed at it on a screenshot${segs.length ? `; SAM 3.1 outlined ${segs.length} ${segs.length === 1 ? kind : kind === "text box" ? "text boxes" : `${kind}s`}${snapped ? " and gave its exact edges" : ", none of them under that spot, so I went by Muse Spark's box"}` : ""}` };
    if (!found?.name) { this.log(`Found the ${kind} by looking`, "ok", seen.file, how); return { point, shot: seen.file }; }
    const loc = this.page.getByRole(found.role as any, { name: found.name, exact: true });
    const healedName = found.name;
    // Labels with per-item data ("Issue refund (₱570.00)") are kept as their stable prefix and matched loosely.
    const stable = healedName.split(/[(\d₱$]/)[0].trim();
    raw.target = stable && stable !== healedName ? { role: found.role, name: stable, fuzzy: true } : { role: found.role, name: healedName };
    raw.healed = `was "${t.name}"`;
    this.heal({ step: step.describe, from: t.name ?? "", to: healedName });
    this.log(`Found it: the ${found.role} “${healedName}” (was “${t.name}”). Updated the task so the next ${this.spec.inputs.itemName ?? "item"} uses it directly.`, "ok", seen.file, how);
    return (await loc.count()) === 1 ? { loc, healedName, shot: seen.file } : { point, healedName, shot: seen.file };
  }

  /** Google apps (YouTube included) can be signed in as several accounts at once. If you did this part of the task as
   *  a particular account, make sure the page uses it. Right after opening a page ("open") it may switch: Google opens a
   *  page as an account with ?authuser=<email>; YouTube by trying each signed-in account (and &pageid= for a brand
   *  channel). Before acting or reading ("act") it only checks, and stops rather than reload mid-form or act as anyone
   *  else. A site used as several accounts in the demo, where this step's account isn't known, must at least be one of
   *  them. Pages that name no account aren't checked; only Google and YouTube pages are. */
  private async rightAccount(mode: "open" | "act", raw?: Step, p: Page = this.page) {
    let host = "";
    try { host = new URL(p.url()).host; } catch { return; }
    if (!ACCOUNT_HOSTS.test(host)) return;
    const want = raw?.account ?? this.spec.accounts?.[host];
    const allowed = this.spec.accountSets?.[host];
    if (!want && !allowed?.length) return;
    const sample = want ?? allowed![0];
    const read = sample.startsWith("ytc:") ? studioChannel : sample.startsWith("yt:") ? youTubeIdentity : pageAccount;
    const shown = async (ms: number) => {
      // After opening a page its account can show a few seconds later; before acting, the page is already settled.
      for (const end = Date.now() + ms; ;) {
        const got = await p.evaluate(read).catch(() => null);
        if (got || Date.now() >= end) return got;
        await p.waitForTimeout(300);
      }
    };
    const now = await shown(mode === "open" ? 8000 : 0);
    if (!now) return; // this page names no account: nothing to compare
    const name = (x: string) => (x.includes("@") ? x : "another YouTube account or channel");
    if (!want) {
      if (allowed!.includes(now)) return;
      throw new Error(`this page is using ${name(now)}, which isn't one of the accounts from your demo`);
    }
    if (now === want) return;
    if (mode === "act") throw new Error(`this page is using ${name(now)}, not the account from your demo (${name(want)}). I won't act as another account`);
    if (read === pageAccount) {
      this.log(`This page is using ${now}, but you did this as ${want}. Switching to ${want}.`, "warn");
      const u = new URL(p.url());
      u.pathname = u.pathname.replace(/\/u\/\d+(?=\/|$)/, ""); // the account number from your Chrome means another account here
      u.searchParams.set("authuser", want);
      await p.goto(u.href);
      await p.waitForLoadState("domcontentloaded").catch(() => {});
      const after = await shown(8000);
      if (after !== want) throw new Error(after ? `this page is signed in as ${after}, not ${want} as in your demo. Sign in ${want} in Remuse's browser (Connected sites), then try again` : `I couldn't tell which account this page uses after switching to ${want}, so I stopped`);
      this.log(`Now using ${want}.`, "ok", undefined, { why: "the account button shows it", how: "page" });
      return;
    }
    this.log("This YouTube page is signed in as another account or channel than in your demo. Switching to yours.", "warn");
    const [first, second] = want.replace(/^ytc?:/, "").split("||");
    const brand = want.startsWith("yt:") && second ? first : null; // "channel||account" is a brand channel
    for (let n = 0; n < 6; n++) {
      const u = new URL(p.url());
      u.searchParams.set("authuser", String(n));
      if (brand) u.searchParams.set("pageid", brand); else u.searchParams.delete("pageid");
      await p.goto(u.href);
      await p.waitForLoadState("domcontentloaded").catch(() => {});
      const got = await shown(8000);
      if (got === want) { this.log("Now on your channel from the demo.", "ok", undefined, { why: "YouTube's own page data names that account and channel", how: "page" }); return; }
      const loggedIn = await p.evaluate(() => (window as any).ytcfg?.get?.("LOGGED_IN")).catch(() => undefined);
      if (!got || loggedIn === false) break; // past the last signed-in account
    }
    throw new Error("the YouTube channel from your demo isn't signed in to Remuse's browser. Sign in the Google account that owns it (Connected sites), then try again");
  }

  /** Acting after a plan: before doing anything, make sure this is still the item that was planned (lists move;
   *  values change). Code reads the same values again, no model call; any that differ end the item untouched. */
  private async stillTheSame(names: string[]) {
    const it = this.item;
    const vars = this.spec.variables.filter((v) => names.includes(v.name) && v.kind === "text" && this.rules.extract[v.name]);
    if (!vars.length) return;
    const now: Record<string, unknown> = {};
    for (const deadline = Date.now() + 3000; ;) {
      const t = await this.page.innerText("body").catch(() => "");
      for (const v of vars) { try { now[v.name] = this.rules.extract[v.name](t) ?? null; } catch { now[v.name] = null; } }
      if (vars.every((v) => now[v.name] !== null) || Date.now() > deadline) break;
      await this.page.waitForTimeout(300);
    }
    // Only values code could read both times are compared (ones Muse Spark read while planning aren't re-read).
    const moved = vars.filter((v) => now[v.name] !== null && it.vars[v.name] !== null && it.vars[v.name] !== undefined && !same(now[v.name], it.vars[v.name]));
    if (!moved.length) return;
    // Something changed since the plan. If your rules decided this item, decide again with the new values: the
    // same decision carries on (with the new values); a different one means the plan no longer holds.
    const next: Record<string, unknown> = { ...it.vars, ...Object.fromEntries(moved.map((v) => [v.name, now[v.name]])) };
    for (const v of this.spec.variables.filter((x) => x.kind === "computed" && !x.candidate)) { try { next[v.name] = this.rules.compute[v.name]?.(next); } catch { next[v.name] = null; } }
    const what = moved.map((v) => `${v.name.replaceAll("_", " ")} was ${JSON.stringify(it.vars[v.name])}, now ${JSON.stringify(now[v.name])}`).join("; ");
    let again: string | undefined;
    try { again = it.decidedBy === "rules" ? this.rules.decide(next).outcome : undefined; } catch { again = undefined; }
    if (again !== it.outcome) throw new Skip(`This changed since the plan (${what}), so the plan for it may not hold. I left it alone.`);
    it.vars = next;
    this.log(`Changed since the plan (${what}), but my decision is the same: ${it.outcome?.replaceAll("_", " ")}.`, "info");
  }

  private async extract(names: string[], into?: Record<string, unknown>) {
    const bag = into ?? this.item.vars;
    const vars = this.spec.variables.filter((v) => names.includes(v.name));
    const textVars = vars.filter((x) => x.kind === "text");
    const read = (t: string) => { for (const v of textVars) { try { bag[v.name] = this.rules.extract[v.name]?.(t) ?? null; } catch { bag[v.name] = null; } } };
    // The page may still be rendering after client-side navigation: re-read for a few seconds.
    let pageText = "";
    for (const deadline = Date.now() + 4000; ;) {
      pageText = await this.page.innerText("body").catch(() => "");
      read(pageText);
      if (textVars.every((v) => bag[v.name] !== null) || Date.now() > deadline) break;
      await this.page.waitForTimeout(300);
    }
    // Code found nothing: the page wording probably changed. Muse Spark reads those values instead.
    const lost = textVars.filter((v) => bag[v.name] === null);
    if (lost.length) {
      const r = await askJson<Record<string, unknown>>([text(`Read these values from the page text below. They may be under different labels than before. Reply with only JSON {"<name>": value or null}, using the same format as the example.\n\n${JSON.stringify(Object.fromEntries(lost.map((v) => [v.name, { what: v.description, example: v.demoValue }])), null, 2)}\n\nPage text:\n${pageText.slice(0, 6000)}`)], "read");
      for (const v of lost) {
        const val = r[v.name];
        if (val === null || val === undefined || val === "") continue;
        bag[v.name] = val;
        this.heal({ step: `read ${v.name}`, from: "code extractor", to: "Muse Spark reading the page" });
        this.log(`My code couldn't find ${v.name} (the page wording changed). Muse Spark read it: ${JSON.stringify(val)}`, "warn");
      }
    }
    if (textVars.length && textVars.every((v) => bag[v.name] === null || bag[v.name] === undefined)) throw new Error(`couldn't read anything (${textVars.map((v) => v.name).join(", ")}) on this page`);
    for (const v of textVars) this.log(`${v.name} = ${JSON.stringify(bag[v.name])}`, bag[v.name] === null ? "warn" : "info");
    const looks = vars.filter((x) => x.kind === "vision" || x.kind === "judge");
    if (!looks.length) return;

    // One Muse Spark call per page for everything that needs judgement or eyes.
    const imgs = await this.page.locator("main img, article img, figure img").all();
    const photos: Buffer[] = [];
    let missed = 0; // photos on the page it couldn't capture
    for (const img of imgs.slice(0, 3)) {
      if (!(await img.isVisible().catch(() => false))) continue;
      const pic = await img.screenshot({ timeout: 5000 }).catch(() => img.screenshot({ timeout: 5000, animations: "disabled" })).catch(() => null);
      if (pic) photos.push(pic); else missed++;
    }
    const ask: Record<string, unknown> = {};
    for (const v of looks) {
      if (v.kind === "vision" && missed) { bag[v.name] = null; this.log(`${v.name}: a photo on the page couldn't be captured, so I won't guess.`, "warn"); continue; }
      if (v.kind === "vision" && !photos.length) { bag[v.name] = false; this.log(`${v.name} = false (no photo on the page)`, "info"); continue; }
      ask[v.name] = v.kind === "vision" ? { question: v.question, answer: "true or false" } : { question: v.question, answer: `one of ${JSON.stringify(v.options)}` };
    }
    if (!Object.keys(ask).length) return;
    const parts = [
      text(`Answer each question about this page. Reply with only JSON: {"<name>": {"answer": ..., "why": "one short sentence"}}.\n\nQuestions:\n${JSON.stringify(ask, null, 2)}\n\nPage text:\n${pageText.slice(0, 6000)}${photos.length ? "\n\nPhotos on the page follow." : ""}`),
      ...photos.map((p) => png(p)),
    ];
    const r = await askJson<Record<string, { answer: unknown; why: string }>>(parts, "judge");
    if (!into && checker().independent) this.judged.set(this.run.current, { parts, names: Object.keys(ask) });
    for (const name of Object.keys(ask)) {
      const a = r[name]?.answer;
      bag[name] = a === "true" ? true : a === "false" ? false : a ?? null;
      this.log(`${name} = ${JSON.stringify(bag[name])}: ${r[name]?.why ?? ""}`, "info");
    }
  }

  // Cheap DOM check first; Muse Spark looks at the screen for irreversible steps or when the DOM check fails.
  private async check(step: Step, aim?: string) {
    if (step.do === "extract") return;
    const e = step.expect ?? {};
    let domOk = true, why = "", unchecked = false; // unchecked: nothing on the page could confirm it
    if (step.do === "fill" && step.value) {
      // Typed values don't show up in page text; read the field back instead.
      const val = await this.page.evaluate(() => (document.activeElement as HTMLInputElement)?.value ?? null);
      domOk = val === null || val === step.value;
      why = val === null ? "typed it (this kind of field can't be read back)" : domOk ? `the field now holds “${short(step.value)}”` : "the field doesn't hold what I typed";
      if (val === null) unchecked = true;
    } else if (e.urlIncludes || e.textIncludes) {
      const deadline = Date.now() + 5000;
      for (;;) {
        const bare = (x: string) => x.toLowerCase().replace(/\/u\/\d+(?=\/|$)/, "");
        const urlOk = !e.urlIncludes || bare(this.page.url()).includes(bare(e.urlIncludes));
        const textOk = !e.textIncludes || (await this.page.innerText("body").catch(() => "")).toLowerCase().includes(e.textIncludes.toLowerCase());
        domOk = urlOk && textOk;
        if (domOk) { why = [e.urlIncludes && `the address now has “${short(e.urlIncludes)}”`, e.textIncludes && `“${short(e.textIncludes)}” is on the page`].filter(Boolean).join(", and "); break; }
        if (Date.now() > deadline) { why = urlOk ? `“${short(e.textIncludes)}” is not on the page` : `the address doesn't have “${short(e.urlIncludes)}”`; break; }
        await this.page.waitForTimeout(250);
      }
    }
    else if (step.do === "goto" && step.url) {
      const bare = (u: string) => u.split(/[?#]/)[0].replace(/\/$/, "").toLowerCase();
      if (bare(this.page.url()) === bare(step.url)) why = "the address is the one it opened";
      else { why = `it opened, and landed on ${short(this.page.url())}`; unchecked = true; }
    }
    else if (step.do === "goto" || step.do === "open_item") { why = "the page opened"; unchecked = true; }
    else { why = "no error came up; there was nothing specific to look for"; unchecked = true; }
    const gated = step.irreversible || (step.do === "click" && IRREVERSIBLE.test(step.target?.name ?? ""));
    if (domOk && !gated) { this.log(`✓ ${step.describe}`, "ok", aim, { why, how: unchecked ? undefined : "page" }); return; }

    let r: { ok: boolean; why: string } = { ok: false, why: "" }, file = "", by: string | undefined, unseen = "", answered = false;
    for (let look = 0; look < 2 && r.ok !== true; look++) {
      // Server actions re-render after the click returns; give the page a moment before judging it.
      await this.page.waitForLoadState("networkidle").catch(() => {});
      await this.page.waitForTimeout(look ? 1500 : 600);
      const shot = await this.shot();
      file = shot.file;
      const ask = [
        text(`A browser robot just did this step: "${step.describe}". It expected: "${e.looks ?? "the step to have worked"}". Look at the screen now. Did the step work? Reply with only JSON: {"ok": true|false, "why": "one short sentence"}`),
        png(shot.buf),
      ];
      // The checker looks; if it can't be reached, Muse Spark does; if neither can, the page check decides.
      try { r = await askJson<{ ok: boolean; why: string }>(ask, "check", checker().model); by = checker().independent ? checker().name : undefined; answered = true; }
      catch (e) {
        try { r = await askJson<{ ok: boolean; why: string }>(ask, "check"); by = undefined; answered = true; }
        catch (e2) { unseen = (e2 as Error).message.slice(0, 80); break; }
      }
    }
    if (r.ok === true) { this.log(`✓ ${step.describe}`, "ok", file, { why: r.why || "the screen shows it worked", how: "screen", by }); return; }
    // No model could look: the page check stands, and it says the screen wasn't checked.
    if (unseen && !answered && domOk) { this.log(`✓ ${step.describe}`, "ok", file, { why: `${why}; the screen couldn't be checked this time (${unseen})`, how: unchecked ? undefined : "page" }); return; }
    this.log(`✗ ${step.describe}`, "error", file, { why: domOk ? r.why || "the screen doesn't show that it worked" : why, how: domOk ? "screen" : "page", by: domOk ? by : undefined });
    throw new Error(`step didn't work: ${step.describe}`);
  }
}
