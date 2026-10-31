# Self-Healing Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remuse proves every step against the page, heals failed steps toward their goal with safe, proven attempts,
runs folder batches that end in "N ready for your OK", and learns proven fixes, so the video script v2 is true on real
Google Classroom.

**Architecture:**
- **One general engine:**
  - `src/proof.ts`: verdicts and value comparison, pure.
  - `src/recover.ts`: diagnosis, ladder, safety check and attempt memory, pure, plus the prompt.
  - `Runner` methods that use them.
- **Small site plug-ins:** `src/plugins.ts` (Classroom, Sheets, stores).
- **Batches:** a server change (several files → one run) plus a runner change (gated steps in a batch defer to one
  approval at the end).

**Tech Stack:** Node 24 TypeScript (type stripping, no build for the backend), Playwright 1.64, node:sqlite, React +
Tailwind web UI (`backend/web`, `npm run build` type-checks and writes `backend/public`). Models through `src/meta.ts`.

**Spec:** `docs/superpowers/specs/2026-11-01-self-healing-design.md` (design v2, approved 2026-10-31). Video:
`docs/video-script.md` v2. Research: `.superpowers/self-healing-research.md`.

## Global Constraints

- The model split is strict:

  | Model | Job |
  |---|---|
  | Muse Voice Transcribe | hears |
  | Muse Spark | understands the demo, writes rules and procedure, reasons when a step breaks |
  | Muse Spark Open (`meta-models/muse-spark-open-1026`) | checks step results, reads values a second time |
  | SAM 3.1 | outlines pen marks and proof |

  Every check records `by` (who checked). The Open label shows only when Open really checked.
- A failed page check is a failure: a screen judgment may block a pass, never make one. "No error came up" is
  unverified. A step that writes or attaches is verified only by page proof.
- Healing never runs on irreversible steps.
- Each healing attempt passes the safety check:
  - nothing named on the irreversible list;
  - no Enter or Ctrl+Enter unless the step's group pressed it;
  - typing only into something that takes typing, and only the step's own value;
  - no leaving the step's site;
  - uploads only of the item's own file;
  - no downloads.
- Budget per failed step: 6 different attempts, 90 seconds, 8 model calls.
- A fix is never saved until proven. A write is never repeated without reading back first.
- Practice stays look-only.
- `IRREVERSIBLE` gains `turn in`.
- Tests:
  - model-free `*.check.ts` run with plain `node`;
  - e2e `*.e2e.ts` use real models on their own ports (3291–3294 here), never 3200;
  - e2e local pages are test fixtures, not demo material.
- Every commit stays inside the hackathon window. No code copied from other projects. No Facebook or Instagram
  automation.
- Open PRs, never merge, unless James asks. Commits end with the session's attribution lines.

## Review Focus

1. **A file whose name fits two assignments** (`CS101_Lab5_v2.pdf`, with "Lab 5" and "Lab 5 resubmission" listed): the
   item asks, it never takes the first. Test in Task 8.
2. **The model returns broken JSON or an element number that isn't on the list:** that counts as a failed attempt, and
   the loop continues within budget. No crash, no click. Test in Task 5.
3. **A learned fix that now points at an irreversible button** (the site changed, and the learned target now reads
   "Delete"): the fix fails the safety check and is dropped. Test in Task 9.
4. **Approve all where one item's press fails:** the others are still turned in, and the failed one says why. Test in
   Task 4.
5. **A heal move that navigates off the step's site** (a link to another domain): refused before acting. Test in
   Task 5.

---

## Day 1: Nov 1. Proof first, then the hero demo's critical path

### Task 0: Workspace and real-Classroom probe

**Files:**
- Create: `backend/scripts/probe-classroom.ts`
- Move: `.worktrees/teach-mode/backend/test/recover.check.ts` and `recover.e2e.ts` → `.worktrees/self-healing/backend/test/`
  (untracked drafts from 2026-10-31, rewritten in Task 5)

- [ ] **Step 1:** Create the ledger `.superpowers/sdd/2026-11-01-self-healing/progress.md`. Its first line:
  `# SDD ledger — plan: docs/superpowers/plans/2026-11-01-self-healing.md`.
- [ ] **Step 2:** Write `probe-classroom.ts`.
  - **Usage:** `node scripts/probe-classroom.ts <assignment URL>`. It opens Remuse's own browser profile
    (`openBrowser(false)` from runner.ts) while the Agent is idle.
  - **Prints, at 1280 px and at 640 px wide:**
    1. Each visible button, link and menu item: role, accessible name, id.
    2. Whether "Add or create" exists by role and name at each width.
    3. The "Turn in" control's role and name.
    4. After clicking "Add or create" → "File": every frame, and whether an `input[type=file]` exists in each.
  - **Saves** a screenshot at each width to `data/probe/`. Never uploads, never turns in.
- [ ] **Step 3:** James's checkpoint (not blocking the next tasks). He signs in his school account in Remuse's browser
  (Connected sites → Google), then runs the probe on one assignment.
  - Record the output in the ledger.
  - If "Add or create" keeps its name at 640 px, the half-width demo heal needs another real trigger. Ledger a ruling,
    and pick from the probe's evidence (the collapsed layout's other changes, a popup) before Task 5's real-site step.
- [ ] **Step 4:** Commit: `git add backend/scripts/probe-classroom.ts && git commit -m "Probe: real Classroom layout at two widths"`.

### Task 1: Proof layer (verdicts and the three trust bugs)

**Files:**
- Create: `backend/src/proof.ts`, `backend/test/proof.check.ts`, `backend/test/proof.e2e.ts` (port 3291)
- Modify: `backend/src/runner.ts`:
  - `check()` (~L1199–1254): returns a verdict;
  - `findByVision()` (~L1043–1046): no write before proof;
  - `exec()`: before/after text for "newly appeared";
  - `step()`: restores the target on failure;
  - `LogLine`: gains `proof`.

**Interfaces:**
- Produces (`proof.ts`):
  - `export type Verdict = { result: "verified" | "failed" | "unverified"; proof: "page" | "screen" | "none"; by?: string; why: string }`
  - `export function newlyAppeared(before: string, after: string, want: string): boolean`. Case-insensitive.
    True when `want` occurs more times in `after` than in `before`.
  - `export function combine(page: Verdict | null, screen: { ok: boolean; why: string; by?: string } | null, writes: boolean): Verdict`
  - `export function writes(s: Step): boolean`. True for `fill` and `upload`.
  - `export function sameValue(a: unknown, b: unknown): boolean`. Strips currency signs, thousands separators and
    spaces, then compares numbers numerically and text case-insensitively.
- Produces (runner):
  - `private async check(step: Step, aim?: string, before?: string): Promise<Verdict>`. Throws `Error("step didn't work: …")`
    when the result is `failed`, as today.
  - `Item.unproven?: string[]`: describes the item's writes that ended unverified.
  - `LogLine` gains `proof?: Verdict["proof"]`.

- [ ] **Step 1: Write `proof.check.ts`.**
  ```ts
  check("text that was already there doesn't count", !newlyAppeared("Receipts sheet", "Receipts sheet", "Receipts"));
  check("text that newly appeared counts", newlyAppeared("Lab Report 5", "Lab Report 5 Lab5.pdf", "lab5.pdf"));
  check("a failed page check stays failed whatever the screen says", combine({ result: "failed", proof: "page", why: "x" }, { ok: true, why: "looks fine" }, false).result === "failed");
  check("the screen can veto a page pass", combine({ result: "verified", proof: "page", why: "x" }, { ok: false, why: "error dialog" }, false).result === "failed");
  check("a screen pass alone verifies a non-write", combine(null, { ok: true, why: "ok", by: "Muse Spark Open" }, false).result === "verified");
  check("a screen pass alone leaves a write unverified", combine(null, { ok: true, why: "ok" }, true).result === "unverified");
  check("nothing to go on is unverified", combine(null, null, false).result === "unverified");
  check("₱451 = 451.00", sameValue("₱451", "451.00") && sameValue("1,799", 1799) && !sameValue("349", "394"));
  check("fill and upload write; click doesn't", writes({ do: "fill" } as Step) && writes({ do: "upload" } as Step) && !writes({ do: "click" } as Step));
  ```
- [ ] **Step 2:** Run `node test/proof.check.ts`. Expected: it fails, because `proof.ts` doesn't exist yet.
- [ ] **Step 3:** Implement `proof.ts`.
- [ ] **Step 4:** Run `node test/proof.check.ts`. Expected: `all passed`.
- [ ] **Step 5: Write `proof.e2e.ts`.** Its own Agent, a local site, specs inserted into the database the way
  `namebox.e2e.ts` does it. Checks:
  1. A click step whose `expect.textIncludes` text was already on the page before the step logs
     `"unverified"`/"proves nothing", not ✓.
  2. A click step whose page check fails, where the screenshot looks fine, fails (item `failed`).
  3. A fill into a field that can't be read back (contenteditable inside an iframe) is unverified, and a later gated
     step in the same item doesn't run: it logs "couldn't prove … so I didn't …".
  4. A vision-healed target that then fails its check is not in the saved spec and not in `run.heals`.
- [ ] **Step 6:** Run `node test/proof.e2e.ts`. Expected: all four fail.
- [ ] **Step 7: Wire it into the runner.**
  - `exec()` reads `innerText("body")` before acting and passes it to `check()`.
  - `check()` builds the page verdict:
    - text expectations use `newlyAppeared`;
    - a fill reads the field back; if it can't, the page verdict is `null`;
    - "nothing specific" gives `null`.
  - The screen judge is `askJson` with `checker().model`, falling back to Muse Spark, as today.
  - The result is `combine(page, screen, writes(step))`.
    - **Verified:** logs ✓ with `proof` and `by`.
    - **Unverified:** logs "– … (not proven: …)" at warn and, for writes, pushes the step to `it.unproven`.
    - **Failed:** throws.
  - **Gated steps:** `approve()` and the gated click/press paths refuse when `it.unproven?.length`. They log
    `I couldn't prove "${it.unproven[0]}" worked, so I didn't ${step.describe.toLowerCase()}`, and the item ends
    `skipped` with `byYou: false`.
  - **`findByVision`** returns `{ loc | point, healedName, proposed: { role, name, fuzzy } }` and no longer touches
    `raw.target` or `run.heals`. `exec` applies `raw.target` and `heal()` only after `check()` returns `verified`.
  - **`step()`** keeps the original `raw.target` and restores it when the step finally fails.
  - The log line "Updated the task so the next … uses it directly" moves to after the proof.
- [ ] **Step 8:** Run `node test/proof.e2e.ts`, then the existing `node test/namebox.e2e.ts`, `node test/practice.e2e.ts`
  and `node test/checks.check.ts`. Expected: all pass. If an older e2e relied on "no error came up" counting as ✓,
  ledger a ruling for each test you change.
- [ ] **Step 9:** Commit: "Proof layer: verified/failed/unverified, judge can only veto, no fix saved before proof".

### Task 2: "turn in" is never pressed alone

**Files:**
- Modify: `backend/src/runner.ts:76`: export `IRREVERSIBLE` and add `turn in|turn it in|hand in|mark as done`.
- Create: `backend/test/gate.check.ts`

- [ ] **Step 1:** Write `gate.check.ts`.
  - Gated: "Turn in", "Hand in", "Mark as done", "Checkout", "Place order", "Send", "Submit", "Archive".
  - Not gated: "Add or create", "File", "Open", "View instructions".
  - Instead of the bare regex, test `gatedStep({ do: "click", target: { role: "button", name } })`.
- [ ] **Step 2:** Run `node test/gate.check.ts`. Expected: FAIL on "Turn in", "Hand in", "Mark as done".
- [ ] **Step 3:** Add the words to `IRREVERSIBLE` and export both `IRREVERSIBLE` and `gatedStep`.
- [ ] **Step 4:** Run it again. Expected: `all passed`.
- [ ] **Step 5:** Commit: "Turn in waits for your OK".

### Task 3: Plug-ins (Classroom, Sheets), one engine

**Files:**
- Create: `backend/src/plugins.ts`, `backend/test/plugins.check.ts`
- Modify: `backend/src/runner.ts`:
  - `locate()`: replace the hard-coded `#t-name-box` with plug-in handles;
  - `upload()`: a frame-aware file input;
  - `check()`: plug-in read-back before the generic one.

**Interfaces:**
- Produces:
  ```ts
  export type Plugin = {
    name: string;
    matches(url: string): boolean;
    handles?: { name: RegExp; selector: string }[];          // fixed handles by target name
    routes?: { purpose: RegExp; keys: string[]; why: string }[]; // keyboard routes for a step's purpose (Task 5 rung 4)
    readBack?(page: Page, step: Step, vars: Record<string, unknown>): Promise<Verdict | null>;
    fileInput?(page: Page): Promise<Locator | null>;          // the upload control, in any frame
    keepsDrafts?: boolean;
  };
  export function pluginFor(url: string): Plugin | null;
  ```
- **Classroom** (`classroom.google.com`):
  - `readBack` for `upload`: `vars.file_name` newly visible in the page or its frames gives `verified/page` with why
    `"<name> is attached, read back from the page"`.
  - `fileInput`: searches `page.frames()` for `input[type=file]`, the Google file picker.
  - `keepsDrafts: true`.
- **Sheets** (`docs.google.com/spreadsheets`):
  - handle `{ name: /^name box$/i, selector: "#t-name-box" }`;
  - route `{ purpose: /name box|go to|cell/i, keys: ["Control+J"], why: "Google's shortcut for the Name Box" }`.
- **stores:** added in Task 11.

- [ ] **Step 1: Write `plugins.check.ts`.**
  ```ts
  check("Classroom by address", pluginFor("https://classroom.google.com/c/abc/a/def/details")?.name === "classroom");
  check("Sheets by address", pluginFor("https://docs.google.com/spreadsheets/d/x/edit#gid=0")?.name === "sheets");
  check("Docs isn't Sheets", pluginFor("https://docs.google.com/document/d/x")?.name !== "sheets");
  check("unknown sites get none", pluginFor("https://example.com") === null);
  check("Sheets knows the Name Box", !!pluginFor("https://docs.google.com/spreadsheets/d/x")!.handles!.find((h) => h.name.test("Name Box")));
  ```
- [ ] **Step 2:** Run `node test/plugins.check.ts`. Expected: it fails, because the module is missing.
- [ ] **Step 3:** Implement `plugins.ts`. Then wire it into the runner:
  - `locate()`: a plug-in handle for `target.name`, else the existing paths. Delete the old Name Box line; the
    `normalize()` selector in understand.ts stays.
  - `upload()`: try `pluginFor(url)?.fileInput`, then the existing `input[type=file]` / file-chooser path.
  - `check()`: try `pluginFor(url)?.readBack` before the generic page verdict.
- [ ] **Step 4:** Run `node test/plugins.check.ts` and `node test/namebox.e2e.ts`. Expected: both pass.
- [ ] **Step 5:** Commit: "Plug-ins: Classroom and Sheets knowledge outside the engine".

### Task 4: Folder batches and "N ready for your OK"

**Files:**
- Modify: `backend/src/server.ts`:
  - `nextFile` → `nextFiles` (~L945);
  - `folderTick` (~L971) starts one run with every arrived file;
  - `startRun` opts gain `files`.
- Modify: `backend/src/runner.ts`:
  - `file` → `files`;
  - items per file;
  - `upload()` uses the item's file;
  - `Ready` deferral in `act()`/`step()`;
  - the end-of-run `ready` approval.
- Modify: `backend/web/src/pages/run.tsx` and `backend/web/src/lib/api.ts`: the `ready` pending kind.
- Create: `backend/test/batch.e2e.ts` (port 3293)

**Interfaces:**
- Produces:
  - `startRun(specId, { …, files?: { folder: string; name: string }[] })`. `file` is removed; its callers move to `files`.
  - `Runner.files?: { folder: string; name: string }[]`. When set and `source === "once"`: one item per file,
    `{ url: "", label: name, status: "waiting", vars: { file_name: name }, log: [] }`.
  - `Item.status` gains `"ready"`. `Item.ready?: { step: string; at: number; shot?: string }`. `at` is the outcome-step
    index to resume from.
  - `Pending` gains `{ kind: "ready"; item: number; items: number[]; shot?: string }`.
  - `Answer` gains `items?: number[]`. `approve` with `items` acts on those items. `approve_all` acts on all of them.
    `reject` leaves them prepared.
  - A gated step in a batch run (`files.length > 1`, not practice, not `autoApprove`) throws `Ready` instead of waiting.
    The item keeps its tabs. The next item gets a fresh page and tab map.
  - After the pass, if any items are `ready`: one `wait({ kind: "ready", … })`. The notification title is
    `"${n} ready for your OK"`. Each approved item restores its page and tabs and runs its outcome steps from `at`, with
    the gate approved.

- [ ] **Step 1: Write `batch.e2e.ts`.**
  - **Fixture:** a local "class" page with assignments Lab 5 and Lab 6. Each assignment page has an `input[type=file]`,
    an attachment list, and a "Turn in" button that records `/did?turnin=<assignment>`.
  - **Spec:** inserted directly; outcome steps:
    1. open the assignment by the item's file name: a click on link `{{file_name}}`-derived name; Task 8 replaces this
       with `match`;
    2. upload from the watched folder;
    3. click "Turn in".
  - **Setup:** a folder schedule; copy `Lab5.pdf` and `Lab6.pdf` in at once.
  - **Checks:**
    1. One run with two items.
    2. Both items are `ready`, with "is attached, read back from the page" proof.
    3. The run's pending kind is `ready` with 2 items; nothing turned in yet.
    4. `approve_all` → both turned in → items `done`.
    5. A file already used before isn't in the batch.
    6. When one item's Turn in button is removed before approval, the other is still turned in and the missing one is
       `failed` with a reason. (Review focus 4.)
- [ ] **Step 2:** Run `node test/batch.e2e.ts`. Expected: FAIL. Today two runs start, and the first waits at its own
  approval.
- [ ] **Step 3:** Implement the server part:
  - `nextFiles` returns every file that qualifies today, with the existing 10 s stillness and the used/tried rules.
  - `folderTick` passes them all.
- [ ] **Step 4:** Implement the runner part (`files`, items per file, `Ready`, the end approval).
  - `step()`'s catch rethrows `Ready`, like `PracticeEnd`.
  - `upload()` uses `it.vars.file_name` when `files` is set.
  - Then the UI:
    - `run.tsx` renders `ready`: each item's label, its proof thumbnail and "Ready for your OK";
    - buttons **Approve all**, per-item **Approve**, and **Leave them prepared**;
    - `api.ts` gets the type.
- [ ] **Step 5:** Run `node test/batch.e2e.ts`, `node test/files.e2e.ts` and `node test/handled.e2e.ts`, then
  `cd web && npm run build`. Expected: all pass, and the build is clean.
- [ ] **Step 6:** Commit, including `backend/public`: "Folder batches: one run per drop, ends in N ready for your OK".

### Task 5: The healing loop (diagnose, ladder rungs 1–6, safety, memory, budget)

**Files:**
- Create: `backend/src/recover.ts`
- Rewrite: `backend/test/recover.check.ts`, `backend/test/recover.e2e.ts` (port 3294), from the moved drafts
- Modify: `backend/src/runner.ts`:
  - `step()` calls `recover()` after the sign-in checks and before the practice/hidden/handoff branches;
  - `locate()` no longer calls `findByVision` itself; rung 6 does.

**Interfaces:**
- Produces (`recover.ts`):
  ```ts
  export type Seen = { i: number; role: string; name: string; id?: string; editable: boolean; where: string; disabled?: boolean };
  export type Move = { action: "click" | "fill" | "press" | "scroll" | "wait" | "done" | "none"; el?: number; key?: string; why: string };
  export type Attempt = { rung: number; strategy: string; target?: string; changed: boolean; verdict: Verdict["result"] | "refused" | "error"; why: string };
  export type Diagnosis = { kind: "signin" | "overlay" | "loading" | "wrong-page" | "narrow" | "hidden" | "missing"; say: string };
  export function canRecover(s: Step): boolean;                                   // false for gatedStep(s)
  export function unsafe(m: Move, el: Seen | undefined, s: Step, groupKeys: string[], here: string, to?: string): string | null;
  export function repeated(tried: Attempt[], strategy: string, target?: string): boolean;
  export function diagnose(sig: { signin: boolean; overlay: boolean; loading: boolean; width: number; urlMatches: boolean; targetHidden: boolean }): Diagnosis;
  export function firstRung(d: Diagnosis): number;                                // overlay→2, loading→1, others→3
  export function parseMove(reply: string, max: number): Move;                   // bad JSON or bad el → { action: "none", why: "…" }
  export function movePrompt(ctx: { goal: string; why?: string; task: string; tried: Attempt[]; els: Seen[]; value?: string }): string;
  export const BUDGET = { attempts: 6, ms: 90_000, calls: 8 };
  ```
- Produces (runner): `private async recover(s: Step, err: Error): Promise<boolean>` (true = the step is verified) and
  `private async elements(): Promise<Seen[]>`. The latter stamps `data-remuse-i` on up to 120 visible interactive
  elements in viewport order (button, a, input, textarea, select, [role] in button/link/menuitem/tab/checkbox/textbox/
  combobox/option, [contenteditable]) and returns them.
- **Rungs:**
  1. wait for load, then `locate`;
  2. Escape, then close the dialog's close button, then `locate`;
  3. fuzzy name, recorded selector, `getByText(name)`, `getByLabel(name)`, plug-in handle;
  4. plug-in `routes` whose `purpose` matches `step.describe`;
  5. Muse Spark `parseMove(movePrompt(…))` on `elements()` with a screenshot, repeatable;
  6. `findByVision` (only when `elements()` has no candidate of the needed kind).
- **After each attempt:** compare the URL and body text with before (`changed`). Run `check(step)`. A verified result
  ends it. Otherwise log the `Attempt` and continue until `BUDGET`.
- **Log lines:** each attempt logs `Idea N: <strategy> → ✓/✗ <why>`, with `proof` and a screenshot. The diagnosis
  `say` is the first line.

- [ ] **Step 1: Rewrite `recover.check.ts`.** Keep the draft's safety checks, adapted to the new
  `unsafe(m, el, s, groupKeys, here, to)`. Add:
  ```ts
  check("broken JSON is a failed attempt, not a click", parseMove("not json", 10).action === "none");
  check("an element number that isn't on the list is refused", parseMove('{"action":"click","el":99,"why":"x"}', 10).action === "none");
  check("leaving the site is refused", unsafe({ action: "click", el: 1, why: "" }, el(1, "link", "Help"), click, [], "https://classroom.google.com/c/1", "https://evil.example/x") !== null);
  check("the same idea on the same target isn't tried twice", repeated([{ rung: 5, strategy: "click", target: "Add or create", changed: false, verdict: "failed", why: "" }], "click", "Add or create"));
  check("a narrow window is said so", diagnose({ signin: false, overlay: false, loading: false, width: 640, urlMatches: true, targetHidden: false }).kind === "narrow");
  check("an overlay starts at rung 2", firstRung({ kind: "overlay", say: "" }) === 2);
  ```
- [ ] **Step 2:** Run `node test/recover.check.ts`. Expected: FAIL, because the module is missing.
- [ ] **Step 3:** Implement `recover.ts`. Then run `node test/recover.check.ts`. Expected: `all passed`.
- [ ] **Step 4: Rewrite `recover.e2e.ts`.**
  - **Fixture:** a Classroom-like page whose "Add or create" button (accessible name "Add or create") is replaced
    below 800 px by an icon button with accessible name "Add attachment" and text "+". Its menu has "File", which
    reveals `input[type=file]`.
  - **Spec:** learned at full width (target button "Add or create"), run with `viewport 700×900`.
  - **Checks:**
    1. The item finishes: the file is attached and read back.
    2. The log has the "narrow" diagnosis and "Idea" lines.
    3. Delete is never clicked (the menu also has "Delete").
    4. The spec isn't saved with an unproven target.
    5. No `Attempt` repeats.
    6. The "Send" trap (the draft's case 2) never sends.
    7. The model never got more than 8 calls for the step (count `meta.calls` with label "heal").
- [ ] **Step 5:** Run `node test/recover.e2e.ts`. Expected: FAIL. Today the step fails or vision picks something.
- [ ] **Step 6:** Implement `Runner.recover` and `elements()`. Call it from `step()` when `canRecover(s)` and the run
  isn't stopped. Rung 5's model calls use label `"heal"`.
  - **The goal:** `shownSteps()` (readback.ts) over the item's steps gives the step's group. The goal text is the
    group's text, and `groupKeys` is every `key` pressed in the group.
  - **If the action already ran:** when `writes(s)` and the step's action already ran before the failure, the first
    move is the plug-in or generic read-back. Act again only if it shows the write didn't land.
  - **When the budget runs out:**
    - a hidden or batch run ends the item as "needs you", with the last screenshot, and the batch continues;
    - a visible run goes to the existing handoff, with the attempts in `problem`;
    - a practice throws the plain message, ending "I tried: <strategies>".
- [ ] **Step 7:** Run `node test/recover.e2e.ts`, `node test/proof.e2e.ts`, `node test/namebox.e2e.ts` and
  `node test/practice.e2e.ts`. Expected: all pass.
- [ ] **Step 8:** James's real-site checkpoint. Practice his Classroom task at half width once Task 0's probe confirms
  the trigger. Ledger the result.
- [ ] **Step 9:** Commit: "Self-healing loop: diagnose, ladder, safety check, attempt memory, budget".

### Task 6: SAM 3.1 outlines the proof

**Files:**
- Modify: `backend/src/runner.ts`: after `recover()` returns verified, and in Classroom's `readBack` success.

- [ ] **Step 1:** Extend `recover.e2e.ts`: the healed step's ✓ line has a `shot`, and its `why` names SAM 3.1 ("SAM 3.1
  outlined it") or says "SAM 3.1 unavailable".
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement. The proven element's box comes from `loc.boundingBox()`, with `sam(buf, kind)` snapping it
  as in `findByVision`. `marked([{ box, kind: "pick", label: "SAM 3.1" }])` gives the proof screenshot, attached to the
  ✓ line.
- [ ] **Step 4:** Run `node test/recover.e2e.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: "Proof pictures: SAM 3.1 outlines what was proven".

---

## Day 2: Nov 2. The independent check, matching, learning, live trace, scene tests

### Task 7: Muse Spark Open checks and second reads

**Files:**
- Modify: `backend/src/runner.ts`:
  - `check()`: the `by` field on every verdict;
  - after `extract`: a second read of the values used by later `fill` values.
- Modify: `backend/test/proof.check.ts`, `backend/test/batch.e2e.ts`

**Interfaces:**
- Produces: `private async secondRead(names: string[]): Promise<{ agreed: boolean; second: Record<string, unknown>; by: string }>`.
  - Asks `checker().model` (falling back to Muse Spark) for those values from a fresh screenshot plus page text, without
    the first answers.
  - Compares with `sameValue`.
  - **Disagreement:** `ask("I read <name> as A, and a second read says B. Which is right?")`. In a hidden run the item
    ends "needs you".
  - **Agreement:** logs `Two readings agree: <name> <value> (checked by <by>)`.

- [ ] **Step 1: Add the failing tests.**
  - `proof.check.ts`: `sameValue("₱1,388.80", "1388.8")`, `!sameValue("Subtotal 349", "Total 394")`.
  - `batch.e2e.ts`: the fixture assignment page shows a "Points 100" value that a fill step uses. Check for a "Two
    readings agree" line, and that every ✓ line has `by`.
- [ ] **Step 2:** Run both. Expected: the new checks FAIL.
- [ ] **Step 3:** Implement. `Run.checker` already exists; set it from `checker()`. The UI shows `by` next to each
  proof line (`run.tsx` already renders `why`/`how`; add `by`).
- [ ] **Step 4:** Run `node test/proof.check.ts` and `node test/batch.e2e.ts`. Expected: PASS. Also run
  `node --env-file-if-exists=../.env test/open.check.ts` to see whether the Open key works today, and ledger the
  answer.
- [ ] **Step 5:** Commit: "Muse Spark Open checks every result and reads each value twice".

### Task 8: Match step and the unmatched-file question

**Files:**
- Modify: `backend/src/understand.ts`:
  - `Step.do` gains `"match"`;
  - `SCHEMA` gets the match step;
  - a prompt rule: "items are files and the person opened the entry that fits by a rule → a match step with `said`".
- Modify: `backend/src/runner.ts`: `exec()` gets a `match` branch.
- Create: `backend/test/match.check.ts`
- Modify: `backend/test/batch.e2e.ts`: a third file, `Essay2.pdf`.

**Interfaces:**
- Produces:
  - `{ do: "match", target: { role: "link" }, said: "<the person's rule>", describe }`.
  - At run time: the candidates are the visible elements of `target.role` with names. Muse Spark returns every index
    that fits the rule for `it.label` (`{ "fit": number[], "why": string }`).
  - `export function matchOutcome(fit: number[]): "open" | "none" | "several"` in `recover.ts`.
    - **open:** clicks the one, then logs `Matched "<file>" to "<name>": <why>`.
    - **none / several:** `ask` with `No assignment fits "<file>". Which one?` (or `Two fit: A, B. Which one?`), with the
      candidates as options. In a hidden run the item ends "needs you" and the batch continues.

- [ ] **Step 1:** Write `match.check.ts`: `matchOutcome([2]) === "open"`, `matchOutcome([]) === "none"`,
  `matchOutcome([1, 3]) === "several"`. Extend `batch.e2e.ts`:
  1. The spec uses `match` with said "match by the course code and lab number in the file name".
  2. `Essay2.pdf` ends "needs you" with a "No assignment fits" question.
  3. Lab 5 and Lab 6 are still ready.
  4. A `Lab5_v2.pdf` against "Lab 5" + "Lab 5 resubmission" asks "Two fit". (Review focus 1.)
- [ ] **Step 2:** Run both. Expected: FAIL.
- [ ] **Step 3:** Implement. The understand.ts SCHEMA and prompt rule are covered by a check in `checks.check.ts`:
  `normalize` keeps a match step's `said`.
- [ ] **Step 4:** Run `node test/match.check.ts`, `node test/batch.e2e.ts` and `node test/checks.check.ts`. Expected:
  PASS.
- [ ] **Step 5:** James's checkpoint. He teaches the Classroom chore for real. Verify the learned spec has a `match`
  step (or the learned steps open the assignment by a `{{variable}}`). If not, ledger it, and tune the prompt rule
  with his recording.
- [ ] **Step 6:** Commit: "Match each file to its assignment by your rule; ask when none or several fit".

### Task 9: Learning (proposed → learned → dropped, with undo)

**Files:**
- Modify: `backend/src/server.ts`:
  - a `fixes` table;
  - `GET /api/sessions/:id/fixes`;
  - `DELETE /api/fixes/:id`;
  - saving a run's proven fixes when an item ends.
- Modify: `backend/src/runner.ts`:
  - a "rung 0" learned fix before a step's own way;
  - `Run.heals` entries gain `{ group, move, state }`.
- Create: `backend/src/fixes.ts` (pure lifecycle), `backend/test/fixes.check.ts`
- Modify: `backend/web/src/pages/tasks.tsx`: a "What Remuse learned" list with **Undo**.

**Interfaces:**
- Produces:
  ```ts
  export type Fix = { id?: number; task: string; group: string; move: { strategy: string; role?: string; name?: string; selector?: string; keys?: string[] }; state: "proposed" | "learned"; fails: number; provenAt?: number };
  export function promote(f: Fix, itemVerified: boolean): Fix;  // proposed → learned when the whole item verified
  export function failed(f: Fix): Fix | null;                   // fails+1; null (dropped) at 2
  ```
  Table `fixes(id INTEGER PRIMARY KEY, session_id TEXT, grp TEXT, move TEXT, state TEXT, fails INTEGER, proven_at INTEGER, created_at INTEGER)`.
  - **Rung 0:** for a step, a learned fix of its group is tried first.
  - It passes `unsafe()` every time. A fix pointing at an irreversible name is dropped, with the log line "Dropped what
    I learned for this step: it now points at '<name>'" (review focus 3).
  - **Success:** log `Used what I learned on <date>: <strategy>`.
  - **Failure:** `failed()`, then the normal step.

- [ ] **Step 1: Write `fixes.check.ts`.**
  - `promote` only when `itemVerified`;
  - `failed` twice gives `null`;
  - one failure keeps `state`.

  Extend `recover.e2e.ts`:
  1. A second run at 700 px uses the learned fix first ("Used what I learned"), with 0 heal model calls.
  2. The fixture is then changed so the learned target reads "Delete": the fix is dropped, never clicked.
  3. `DELETE /api/fixes/:id` removes it.
- [ ] **Step 2:** Run both. Expected: FAIL.
- [ ] **Step 3:** Implement. The UI list shows the step's shown name, the fix in words, when it was proven, and
  **Undo**.
- [ ] **Step 4:** Run `node test/fixes.check.ts`, `node test/recover.e2e.ts` and `cd web && npm run build`. Expected:
  PASS, clean build.
- [ ] **Step 5:** Commit: "Learn proven fixes, drop the ones that stop working, undo from the task page".

### Task 10: Live trace and end-of-run decisions

**Files:**
- Modify: `backend/src/runner.ts`: `LogLine` gains `kind?: "heal" | "decision"`; heal lines and the end summary.
- Modify: `backend/web/src/pages/run.tsx`: a **Working it out** block (consecutive `kind: "heal"` lines with
  before/after thumbnails and proof labels) and a **Decisions** list at the top.
- Modify: `backend/web/src/pages/remote.tsx`: the live run card shows the latest Working-it-out lines.
- Modify: `backend/src/server.ts`: the scheduled-run notification body starts with the decisions.

- [ ] **Step 1:** Extend `recover.e2e.ts`:
  1. Heal lines have `kind: "heal"` and `proof`.
  2. The run has `decisions: string[]`, each "what + why". For example: `Used the "+" menu because "Add or create"
     isn't on the page at this width; Lab7.pdf attached, read back from the page`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement. `Run.decisions?: string[]` is pushed when a heal is verified, an item is matched, or an item
  is skipped or asked.
- [ ] **Step 4:** Run `node test/recover.e2e.ts` and `cd web && npm run build`. Expected: PASS, clean build. Then check
  `run.tsx` at desktop width and in the 400 px sidebar with chrome-devtools screenshots: one look, one fix pass.
- [ ] **Step 5:** Commit: "Show the reasoning live, and the decisions at the end".

### Task 11: Stores plug-in (scene 5)

**Files:**
- Modify: `backend/src/plugins.ts`: `stores`, matched by the store hosts James picks (default empty list, set in Step
  3). `readBack` for a click whose describe says "add to cart": the cart count or line item newly appeared.
- Modify: `backend/test/plugins.check.ts`

- [ ] **Step 1:** Extend `plugins.check.ts`: once hosts are set, `pluginFor("https://<host>/cart")?.name === "stores"`.
  The `readBack` of "Add to cart" on a fixture page (count 0 → 1) is verified.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Ask James for the two stores (scene 5). Check their terms allow personal automation, and ledger it.
  Set the hosts and implement.
- [ ] **Step 4:** Run `node test/plugins.check.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: "Stores plug-in: prove the cart, stop at checkout".

### Task 12: Re-plan rung and cleaning up its own partial writes (cut first if short)

**Files:**
- Modify: `backend/src/recover.ts` and `runner.ts`:
  - rung 7: Muse Spark writes ≤3 reversible steps, each passing `unsafe()`, and together they must pass the original
    `check()`;
  - when the budget runs out with `it.typed` (the fields and cells Remuse typed in this item), clear them (select all +
    Delete) and read them back as empty.

- [ ] **Step 1:** Extend `recover.e2e.ts`:
  1. A step only reachable by two moves (open a section, then the button), where rung 5 is limited to 1 call, heals
     through rung 7.
  2. An item that fails after typing two fields leaves both fields empty, with the log "Cleared what I typed".
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `node test/recover.e2e.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: "Re-plan a step as a last resort; never leave a half-written item".

### Task 13: Sheets plug-in, writes by column name and duplicates (cut second if short; not in the video)

**Files:**
- Modify: `backend/src/plugins.ts` (sheets): the read-back spike, CSV via signed-in `page.request` vs the Name
  Box/formula bar; the winner is ledgered.
  - `headers()`.
  - `findRow(key)` for duplicates, keyed on merchant + date + total.
  - `readBack` of a written row: exactly one new row with the expected values.
- Modify: `backend/test/sheets.e2e.ts`: a moved Total column, and the same receipt twice ("already logged", archive
  waits).

- [ ] **Step 1:** Write the failing checks.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 14: Scene-by-scene pass and final review

- [ ] **Step 1:** Run every test: each `*.check.ts`, then the e2e suite (one at a time; the ports are fixed). Ledger the
  results.
- [ ] **Step 2:** Map each scene of `docs/video-script.md` v2 to a passing test or James's real-site checkpoint, and
  update the script's [build]/[verify] tags.
- [ ] **Step 3:** Final whole-branch review with a fresh reviewer on the most capable model (executing-plans' Final
  Review). Fix Critical and Important findings test-first; ledger minors.
- [ ] **Step 4:** Push, then open the PR to `main`. Don't merge.

---

## Day 3: Nov 3. Feature freeze

### Task 15: Measure, README

**Files:**
- Create: `backend/scripts/measure.ts`. For a finished run id, it prints per-item seconds, model calls per item
  (`meta.calls` by run window), and calls by label (heal, check, read, match).
- Modify: `README.md`:
  - the positioning line;
  - the four truths;
  - the model split table;
  - how self-healing works (ladder, proof, safety);
  - the test list;
  - the measured numbers.

- [ ] **Step 1:** Write `measure.ts`. Run it on a batch.e2e run. Expected: numbers print.
- [ ] **Step 2:** James's rehearsal runs on real Classroom. Run `measure.ts` on each, and put only those numbers in the
  script and README.
- [ ] **Step 3:** Update the README. Commit, and push to the PR.
- [ ] **Step 4:** Freeze. From here, only fixes for bugs found while recording, each test-first.
