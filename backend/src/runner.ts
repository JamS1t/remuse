// Run: plays a Task Spec on every item in the list with Playwright. DOM first, Muse Spark + SAM 3.1 when
// the page changed. Checks every step, pauses for approval before anything irreversible, asks when unsure.
import { chromium, type BrowserContext, type Page, type Locator } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { askJson, ground, sam, text, png, type Box } from "./meta.ts";
import { load, type Rules } from "./build.ts";
import type { Spec, Step, Target } from "./understand.ts";
import { applyLogins } from "./logins.ts";
import { notify } from "./notify.ts";
import { captionFor, chooseFile, findFolder, freeName, markUsed, pathIn, usedFor } from "./folders.ts";

/** Ends the item quietly as skipped (e.g. nothing new to upload yet), not as a failure. */
class Skip extends Error {}

export type LogLine = { at: number; msg: string; level: "info" | "ok" | "warn" | "error"; shot?: string };
export type Candidate = { url: string; title: string; vars: Record<string, unknown>; score: number | null; shot?: string; best?: boolean };
export type Item = {
  url: string; label: string;
  status: "waiting" | "running" | "approval" | "asking" | "done" | "skipped" | "failed";
  vars: Record<string, unknown>; outcome?: string; because?: string; expected?: string; decidedBy?: "rules" | "you" | "learned"; log: LogLine[];
  candidates?: Candidate[];
  report?: string; // the update a "report" step gave the person
};
export type Pending =
  | { kind: "approval"; item: number; step: string; target?: string; outcome?: string; because?: string; shot: string; healed?: string }
  | { kind: "ask"; item: number; question: string; options: string[]; shot: string; requestType?: string }
  | { kind: "handoff"; item: number; step: string; problem: string; shot: string };
export type Answer = { decision?: "approve" | "reject" | "approve_all" | "retry" | "skip"; outcome?: string; note?: string; reply?: string; learn?: boolean };
export type Run = {
  id: string; specId: number; status: "starting" | "running" | "done" | "failed" | "stopped";
  items: Item[]; current: number; pending: Pending | null; autoApprove: boolean;
  rows?: Record<string, string>[];
  // Runs work hidden in the background unless the person chose to watch; who started it.
  visible?: boolean; trigger?: "you" | "schedule";
  startedAt: number; endedAt?: number; error?: string; shot?: string;
  heals: { step: string; from: string; to: string }[];
  learned: { requestType: string; outcome: string; note?: string; reply?: string }[];
  score?: { matched: number; total: number };
};

const VIEW = { width: 1440, height: 900 };
const MOCK = process.env.MOCK_URL ?? "http://localhost:3100";
const IRREVERSIBLE = /\b(refund|replace|send|pay|submit|ship|confirm|delete|place order|issue|buy|checkout|check out|purchase|book|transfer|message seller|post|share|publish)\b/i;
const PROFILE = fileURLToPath(new URL("../data/browser", import.meta.url));

/** The Remuse browser: the person's installed Chrome with its own profile, so sign-ins stick between runs. */
// Hidden Chrome calls itself "HeadlessChrome", which sites like Google treat as a bot. Learn the real
// user agent once and present that instead, so a hidden run looks like the person's normal Chrome.
let realUA: string | null = null;
const launch = async (opts: Parameters<typeof chromium.launchPersistentContext>[1]) => {
  try { return await chromium.launchPersistentContext(PROFILE, { ...opts, channel: "chrome" }); }
  catch { return chromium.launchPersistentContext(PROFILE, opts); } // ponytail: no Chrome installed, bundled Chromium
};

export async function openBrowser(headless: boolean): Promise<BrowserContext> {
  const opts = { headless, viewport: VIEW, args: headless ? [] : [`--window-size=${VIEW.width},${VIEW.height + 120}`] };
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

const manila = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
const render = (s: string | undefined, v: Record<string, unknown>) =>
  s?.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (v[k] === undefined || v[k] === null ? "" : String(v[k])));

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
  stopped = false;
  // Variables from the previous run of this task, by item label, for {{prev_<name>}} ("change since last time").
  prev: Record<string, Record<string, unknown>> = {};
  // Which task this is (its recording id): uploaded files are remembered per task.
  taskKey = "";
  baseRules: Spec["rules"]; // decide() indexes these; learned rules are added to the spec, not here
  private resolve: ((a: Answer) => void) | null = null;
  private shots = 0;
  onChange: (run: Run, spec: Spec) => void;

  constructor(run: Run, spec: Spec, code: string, dir: string, onChange: (run: Run, spec: Spec) => void) {
    this.run = run; this.spec = structuredClone(spec); this.baseRules = structuredClone(spec.rules); this.rules = load(code); this.dir = dir; this.onChange = onChange;
    mkdirSync(dir, { recursive: true });
  }

  private changed() { this.onChange(this.run, this.spec); }
  private get item() { return this.run.items[this.run.current]; }
  private log(msg: string, level: LogLine["level"] = "info", shot?: string) {
    this.item?.log.push({ at: Date.now(), msg, level, shot });
    this.changed();
  }

  private async shot(highlight?: Locator): Promise<{ file: string; buf: Buffer }> {
    if (highlight) await highlight.evaluate((el: HTMLElement) => { el.dataset.showrunOutline = el.style.outline; el.style.outline = "4px solid #f59e0b"; el.style.outlineOffset = "2px"; }).catch(() => {});
    const buf = await this.page.screenshot();
    if (highlight) await highlight.evaluate((el: HTMLElement) => { el.style.outline = el.dataset.showrunOutline ?? ""; }).catch(() => {});
    const file = `${++this.shots}.png`;
    writeFileSync(join(this.dir, file), buf);
    this.run.shot = file;
    return { file, buf };
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
    this.run.pending = p; this.changed();
    return new Promise((r) => { this.resolve = r; });
  }

  async start(limit?: number) {
    const headless = process.env.HEADLESS === "1" || !this.run.visible;
    const browser = await openBrowser(headless);
    try {
      this.ctx = browser;
      this.page = browser.pages()[0] ?? (await browser.newPage());
      const keep = findFolder(this.spec.saveDownloads ?? null);
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
        browser.pages().forEach(watch);
        browser.on("page", watch);
      }
      const { source, listUrl, itemSelector } = this.spec.inputs;
      if (source === "once") {
        // Nothing to go through: a check or an update that runs as one item.
        this.run.items = [{ url: "", label: (this.spec.title ?? this.spec.goal).slice(0, 90), status: "waiting", vars: {}, log: [] }];
      } else if (source === "rows") {
        // One item per row the person gave; its columns become the item's variables.
        const rows = (this.run.rows ?? []).slice(0, limit);
        if (!rows.length) throw new Error("this task needs rows to work on, and none were given");
        this.run.items = rows.map((r) => ({ url: "", label: Object.values(r).join(" · ").slice(0, 90), status: "waiting", vars: { ...r }, log: [] }));
      } else {
        await this.page.goto(listUrl!);
        const links = await this.page.$$eval(itemSelector ?? "a", (as) => as.map((a) => ({ url: (a as HTMLAnchorElement).href, label: (a as HTMLElement).innerText.replace(/\s+/g, " ").trim().slice(0, 90) })));
        const expected = await this.expectedOutcomes();
        this.run.items = links.slice(0, limit ?? links.length).map((l) => ({ ...l, status: "waiting", vars: {}, log: [], expected: expected[l.url.split("/").pop()!] }));
      }
      this.run.status = "running"; this.changed();
      for (this.run.current = 0; this.run.current < this.run.items.length && !this.stopped; this.run.current++) {
        const it = this.item;
        it.status = "running"; this.changed();
        try { await this.runItem(); }
        catch (e) { it.status = "failed"; this.log(`Stopped this item: ${(e as Error).message}`, "error"); }
        await settle();
      }
      this.run.status = this.stopped ? "stopped" : "done";
      this.scoreRun();
    } catch (e) {
      this.run.status = "failed"; this.run.error = (e as Error).message;
    } finally {
      this.run.endedAt = Date.now(); this.run.pending = null; this.changed();
      await browser.close();
    }
  }

  // Mock apps only: the seed knows the right answer per email, so a run can be scored.
  private async expectedOutcomes(): Promise<Record<string, string>> {
    try { return (await (await fetch(`${MOCK}/api/state`)).json()).expected ?? {}; } catch { return {}; }
  }
  private scoreRun() {
    const scored = this.run.items.filter((i) => i.expected && i.outcome);
    // "ask" means the rules should not decide alone: asking you, or reusing your answer, is right.
    const right = (i: Item) => i.status === "done" && (i.expected === "ask" ? i.decidedBy !== "rules" : i.outcome === i.expected);
    if (scored.length) this.run.score = { matched: scored.filter(right).length, total: scored.length };
  }

  private async runItem() {
    const it = this.item;
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

    // Decide: learned answers first, then the scope check, then the person's rules (as code).
    const typeVar = "item_type" in it.vars ? "item_type" : "request_type";
    const rt = it.vars[typeVar] as string | undefined;
    const learned = this.run.learned.find((l) => l.requestType === rt);
    const missing = this.spec.variables.filter((v) => v.kind !== "computed" && !v.candidate && (it.vars[v.name] === null || it.vars[v.name] === undefined)).map((v) => v.name);
    let reply: string | undefined;
    if (missing.length && !learned) {
      // Deciding without the facts would be a guess.
      const { file } = await this.shot();
      this.log(`I couldn't read ${missing.join(", ")}, so I won't guess.`, "warn", file);
      it.status = "asking";
      const a = await this.wait({ kind: "ask", item: this.run.current, shot: file, options: Object.keys(this.spec.outcomes),
        question: `I couldn't read ${missing.join(", ")} for "${it.label}". What should I do?` });
      it.status = "running";
      if (!a.outcome || !this.spec.outcomes[a.outcome]) { it.status = "skipped"; this.log("Skipped, as you asked.", "info"); return; }
      it.outcome = a.outcome; reply = a.reply || undefined;
      it.because = `You told me${a.note ? `: ${a.note}` : ""}`; it.decidedBy = "you";
    } else if (learned) {
      it.outcome = learned.outcome; reply = learned.reply;
      it.decidedBy = "learned"; it.because = `You showed me what to do with "${rt}" earlier in this run${learned.note ? `: ${learned.note}` : ""}`;
    } else if (rt && this.spec.scopeTypes?.length && !this.spec.scopeTypes.includes(rt)) {
      const { file } = await this.shot();
      this.log(`This looks like "${rt}". My rules don't cover it, so I'm asking.`, "warn", file);
      it.status = "asking";
      const a = await this.wait({ kind: "ask", item: this.run.current, requestType: rt, shot: file, options: Object.keys(this.spec.outcomes),
        question: `"${it.label}" looks like ${rt.replace(/_/g, " ")}. Your rules don't cover that. What should I do?` });
      it.status = "running";
      if (!a.outcome || !this.spec.outcomes[a.outcome]) { it.status = "skipped"; this.log("Skipped, as you asked.", "info"); return; }
      it.outcome = a.outcome; reply = a.reply || undefined;
      it.because = `You told me${a.note ? `: ${a.note}` : ""}`; it.decidedBy = "you";
      if (a.learn !== false) {
        this.run.learned.push({ requestType: rt, outcome: a.outcome, note: a.note, reply: a.reply || undefined });
        this.spec.rules.unshift({ if: `${typeVar} is ${rt}`, then: a.outcome, said: a.note, learned: true });
        this.spec.scopeTypes.push(rt);
        this.log(`Learned: "${rt}" → ${a.outcome}. I'll do the same for the next one.`, "ok");
      }
    } else {
      const d = this.rules.decide(it.vars);
      it.outcome = d.outcome;
      const rule = this.baseRules[d.rule];
      it.decidedBy = "rules"; it.because = rule ? `${rule.if}${rule.said ? ` ("${rule.said}")` : ""}` : "rule " + d.rule;
    }
    this.log(`Decision: ${it.outcome}, because ${it.because}`, "ok");

    const out = this.spec.outcomes[it.outcome!];
    if (!out) throw new Error(`no steps for outcome "${it.outcome}"`);
    it.vars.reply = render(reply ?? out.reply, it.vars);
    for (const step of out.steps) {
      if (!(await this.step(step))) return;
      if (it.status === "skipped") return;
    }
    it.status = "done"; this.changed();
    if (it.vars.file_name && this.taskKey) markUsed(this.taskKey, [String(it.vars.file_name)]);
  }

  /** Pick a file from an allowed folder by the task's rule and hand it to the page's upload control. */
  private async upload(raw: Step, step: Step) {
    const it = this.item;
    const rule = raw.file ?? { folder: null };
    const folder = findFolder(rule.folder);
    if (!folder) throw new Error(rule.folder ? `the folder "${rule.folder}" isn't allowed any more; add it on the Folders page` : "choose which folder to upload from on the task page");
    const name = chooseFile(folder, rule, usedFor(this.taskKey));
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
        if (e instanceof Skip) { this.item.status = "skipped"; this.log(e.message, "info"); return false; }
        // A hidden run has no window to hand over: the item fails and says why instead of waiting forever.
        if (this.stopped || process.env.HEADLESS === "1" || !this.run.visible) throw e;
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
    // A new tab whose first step isn't a "goto" is one the site opened (the previous click did it).
    if (raw.tab) await this.useTab(raw.tab, raw.do !== "goto");

    if (step.do === "open_item") {
      // In the demo the item opened in its own tab (the next step is in another tab): open it there.
      if (nextTab && raw.tab && nextTab !== raw.tab) {
        const p = this.tabs.get(nextTab);
        const into = p && !p.isClosed() ? p : await this.ctx.newPage();
        this.tabs.set(nextTab, into);
        await into.goto(it.url);
        this.log(`Opened ${this.spec.inputs.itemName ?? "the item"} in the ${nextTab} tab`, "info");
        return;
      }
      await this.page.goto(it.url);
    }
    else if (step.do === "goto") await this.page.goto(step.url!);
    else if (step.do === "extract") return this.extract(step.vars ?? []);
    else if (step.do === "compare") return this.compare(step);
    else if (step.do === "upload") return this.upload(raw, step);
    else if (step.do === "report") {
      // Tell the person: a Windows notification, and the update is kept on the run.
      // A value that doesn't exist yet (no previous run to compare with) drops its "(… since last time)"
      // part instead of leaving a gap; any other missing value shows as a dash.
      const NONE = "\u0000";
      const msg = (raw.message ?? step.describe).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (v[k] === undefined || v[k] === null || v[k] === "" ? NONE : String(v[k])))
        .replace(/\s*\([^()]*\u0000[^()]*\)/g, "").replaceAll(NONE, "–");
      it.report = msg;
      this.log(`Update: ${msg}`, "ok");
      notify(this.spec.title ?? "Remuse update", msg, `http://127.0.0.1:${process.env.PORT ?? 3200}/#/run/${this.run.id}`);
      return;
    }
    else if (raw.tool && (await this.hasTool(raw.tool.name))) {
      // The page offers this action as a WebMCP tool: call it directly instead of clicking. Same approval gate.
      const gated = raw.irreversible || IRREVERSIBLE.test(step.target?.name ?? "") || IRREVERSIBLE.test(raw.tool.name.replace(/_/g, " "));
      if (gated && !(await this.approve(step))) return;
      const args = Object.fromEntries(Object.entries(raw.tool.args ?? {}).map(([k, x]) => [k, render(String(x), v)]));
      const out = await this.page.evaluate(async ({ name, args }) => {
        const r = await (window as any).__showrunTools.get(name).execute(args, { requestUserInteraction: async (f: () => unknown) => f?.() });
        return JSON.stringify(r ?? null).slice(0, 200);
      }, { name: raw.tool.name, args });
      this.log(`Used the site's WebMCP tool ${raw.tool.name}(${JSON.stringify(args)}) instead of clicking: ${out}`, "ok");
    }
    else {
      const found = step.target ? await this.locate(raw, step) : null;
      if (step.do === "fill") {
        if (found?.loc) await found.loc.fill(step.value ?? "");
        else if (found?.point) { await this.page.mouse.click(found.point.x, found.point.y); await this.page.keyboard.press("Control+A"); await this.page.keyboard.type(step.value ?? ""); }
        else if (!step.target) await this.page.keyboard.type(step.value ?? ""); // no field: type where the focus is (a spreadsheet cell, an editor)
      } else if (step.do === "press") {
        if (found?.loc) await found.loc.press(step.key ?? "Enter"); else await this.page.keyboard.press(step.key ?? "Enter");
      } else if (step.do === "click") {
        const gated = raw.irreversible || IRREVERSIBLE.test(step.target?.name ?? "") || IRREVERSIBLE.test(found?.healedName ?? "");
        if (gated && !(await this.approve(step, found?.loc, found?.healedName))) return;
        if (found?.loc) await found.loc.click(); else if (found?.point) await this.page.mouse.click(found.point.x, found.point.y);
      }
    }
    await this.page.waitForLoadState("load").catch(() => {});
    await this.check(step);
  }

  private async approve(step: Step, loc?: Locator, healedName?: string): Promise<boolean> {
    const it = this.item;
    if (this.run.autoApprove) { this.log(`Approved in advance: ${step.describe}`, "info"); return true; }
    const { file } = await this.shot(loc);
    it.status = "approval";
    const a = await this.wait({ kind: "approval", item: this.run.current, step: step.describe, target: healedName ?? step.target?.name,
      outcome: it.outcome, because: it.because, shot: file, healed: healedName ? `The page changed: I'm using "${healedName}" for "${step.target?.name}".` : undefined });
    it.status = "running";
    if (a.decision === "approve_all") this.run.autoApprove = true;
    if (a.decision === "reject") { it.status = "skipped"; this.log(`You said no to: ${step.describe}. Skipped this ${this.spec.inputs.itemName ?? "item"}.`, "warn"); return false; }
    this.log(`You approved: ${step.describe}`, "ok");
    return true;
  }

  // DOM first (role + name, then the recorded selector if it still points at the same thing), then vision.
  private async locate(raw: Step, step: Step): Promise<{ loc?: Locator; point?: { x: number; y: number }; healedName?: string }> {
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
    try {
      const inside = (await sam(buf, kind)).filter((b) => cx >= b.x_min && cx <= b.x_max && cy >= b.y_min && cy <= b.y_max);
      inside.sort((a, b) => (a.x_max - a.x_min) * (a.y_max - a.y_min) - (b.x_max - b.x_min) * (b.y_max - b.y_min));
      if (inside[0]) use = inside[0];
    } catch (e) { this.log(`SAM 3.1 unavailable (${(e as Error).message.slice(0, 80)}); using Muse Spark's box.`, "warn"); }
    const point = { x: ((use.x_min + use.x_max) / 2 / 1000) * VIEW.width, y: ((use.y_min + use.y_max) / 2 / 1000) * VIEW.height };

    // Read what is really there, so the spec can be updated and the DOM path works next time.
    const found = await this.page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y)?.closest("button, a, input, textarea, select, [role]") as HTMLElement | null;
      if (!el) return null;
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute("role") || (tag === "a" ? "link" : tag === "button" || (el as HTMLInputElement).type === "submit" ? "button" : "textbox");
      const name = (el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.innerText || (el as HTMLInputElement).value || "").replace(/\s+/g, " ").trim();
      return { role, name };
    }, point);
    if (!found?.name) return { point };
    const loc = this.page.getByRole(found.role as any, { name: found.name, exact: true });
    const healedName = found.name;
    // Labels with per-item data ("Issue refund (₱570.00)") are kept as their stable prefix and matched loosely.
    const stable = healedName.split(/[(\d₱$]/)[0].trim();
    raw.target = stable && stable !== healedName ? { role: found.role, name: stable, fuzzy: true } : { role: found.role, name: healedName };
    raw.healed = `was "${t.name}"`;
    this.heal({ step: step.describe, from: t.name ?? "", to: healedName });
    this.log(`Found it: the ${found.role} "${healedName}". Updated the spec so the next ${this.spec.inputs.itemName ?? "item"} uses it directly.`, "ok");
    return (await loc.count()) === 1 ? { loc, healedName } : { point, healedName };
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
    for (const img of imgs.slice(0, 3)) if (await img.isVisible()) photos.push(await img.screenshot());
    const ask: Record<string, unknown> = {};
    for (const v of looks) {
      if (v.kind === "vision" && !photos.length) { bag[v.name] = false; this.log(`${v.name} = false (no photo on the page)`, "info"); continue; }
      ask[v.name] = v.kind === "vision" ? { question: v.question, answer: "true or false" } : { question: v.question, answer: `one of ${JSON.stringify(v.options)}` };
    }
    if (!Object.keys(ask).length) return;
    const r = await askJson<Record<string, { answer: unknown; why: string }>>([
      text(`Answer each question about this page. Reply with only JSON: {"<name>": {"answer": ..., "why": "one short sentence"}}.\n\nQuestions:\n${JSON.stringify(ask, null, 2)}\n\nPage text:\n${pageText.slice(0, 6000)}${photos.length ? "\n\nPhotos on the page follow." : ""}`),
      ...photos.map((p) => png(p)),
    ], "judge");
    for (const name of Object.keys(ask)) {
      const a = r[name]?.answer;
      bag[name] = a === "true" ? true : a === "false" ? false : a ?? null;
      this.log(`${name} = ${JSON.stringify(bag[name])}: ${r[name]?.why ?? ""}`, "info");
    }
  }

  // Cheap DOM check first; Muse Spark looks at the screen for irreversible steps or when the DOM check fails.
  private async check(step: Step) {
    if (step.do === "extract") return;
    const e = step.expect ?? {};
    let domOk = true, why = "";
    if (step.do === "fill" && step.value) {
      // Typed values don't show up in page text; read the field back instead.
      const val = await this.page.evaluate(() => (document.activeElement as HTMLInputElement)?.value ?? null);
      domOk = val === null || val === step.value; why = domOk ? "" : "the field doesn't hold what I typed";
    } else if (e.urlIncludes || e.textIncludes) {
      const deadline = Date.now() + 5000;
      for (;;) {
        const urlOk = !e.urlIncludes || this.page.url().toLowerCase().includes(e.urlIncludes.toLowerCase());
        const textOk = !e.textIncludes || (await this.page.innerText("body").catch(() => "")).toLowerCase().includes(e.textIncludes.toLowerCase());
        domOk = urlOk && textOk;
        if (domOk || Date.now() > deadline) { why = urlOk ? `"${e.textIncludes}" is not on the page` : `the address doesn't contain "${e.urlIncludes}"`; break; }
        await this.page.waitForTimeout(250);
      }
    }
    const gated = step.irreversible || (step.do === "click" && IRREVERSIBLE.test(step.target?.name ?? ""));
    if (domOk && !gated) { this.log(`✓ ${step.describe}`, "ok"); return; }

    let r: { ok: boolean; why: string } = { ok: false, why: "" }, file = "";
    for (let look = 0; look < 2 && !r.ok; look++) {
      // Server actions re-render after the click returns; give the page a moment before judging it.
      await this.page.waitForLoadState("networkidle").catch(() => {});
      await this.page.waitForTimeout(look ? 1500 : 600);
      const shot = await this.shot();
      file = shot.file;
      r = await askJson<{ ok: boolean; why: string }>([
        text(`A browser robot just did this step: "${step.describe}". It expected: "${e.looks ?? "the step to have worked"}". Look at the screen now. Did the step work? Reply with only JSON: {"ok": true|false, "why": "one short sentence"}`),
        png(shot.buf),
      ], "check");
    }
    if (r.ok) { this.log(`✓ ${step.describe} (checked on screen: ${r.why})`, "ok", file); return; }
    this.log(`✗ ${step.describe}: ${domOk ? r.why : why}`, "error", file);
    throw new Error(`step didn't work: ${step.describe}`);
  }
}
