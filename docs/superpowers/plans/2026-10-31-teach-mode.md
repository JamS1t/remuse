# Teaching Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remuse learns only from what James did or said (no hover noise, every step cites evidence), in a dedicated teaching screen he can end by voice, then reads its plan aloud and takes spoken corrections. Plus shortcuts and on-page drawing.

**Architecture:** The extension cuts speech into utterances while recording (the existing pause detector) and posts each to a new `/heard` route. A note-taker (Muse Spark) turns each utterance plus the actions since the last one into cited cards. The planner gets a storyboard of moments (utterance plus its actions) plus the cards, and a checker drops steps without evidence and asks about uncovered instructions. The sidebar renders a separate `TeachMode` screen. Remuse speaks through `chrome.tts` in the background worker, while the offscreen mic holds off.

**Tech Stack:** Node 24 TypeScript (type stripping, no build) + node:sqlite; MV3 extension (plain JS); React + Tailwind sidebar (`backend/web`, `npm run build` type-checks and writes `backend/public`); Playwright for e2e. Models: Muse Spark, Muse Voice Transcribe, SAM 3.1, Muse Spark Open (via `checker()` in `meta.ts`).

**Spec:** `docs/superpowers/specs/2026-10-31-teach-mode-design.md`

## Global Constraints

- No new npm dependencies.
- Models: only Meta's (`askJson`, `transcribe`, `sam` in `backend/src/meta.ts`; the second opinion goes through `checker().model`).
- Never read or print `.env`. Never copy Google cookies or the Remuse browser profile.
- Never touch the approval gate before pay, send, refund or submit, or the runner's step checks.
- Teaching-mode text is never under 13 px.
- Shortcuts: `teach` = **Alt+Shift+S**, `pen` = **Alt+Shift+D**.
- Voice: "Google US English" if present, else the first voice whose `lang` starts with `en`.
- End phrases, verbatim: "I'm done", "that's it", "that's all", "proceed", "go ahead", "you can start", "tapos na", "ayan na", "sige na", "done showing", "okay Remuse".
- Tests without port 3200 (`*.check.ts`, and e2e tests with `PORT=3299`) can run any time. Extension e2e tests need port 3200: stop James's Agent (background task) only when no `chrome.exe` uses `backend\data\browser` and nothing is recording or learning, then restart it with `npm start` in `backend/`.
- Test style: `node test/<name>.ts`, `check(name, ok, detail)` printing PASS/FAIL, exit 1 on any fail (copy the helper from `test/checks.check.ts`).
- Commits: plain English subject, ending with the session's attribution lines. One PR for the branch (base `feat/google-accounts`), opened as a draft after Task 5, never merged.
- After UI changes: `cd backend/web && npm run build`, and commit `backend/public` with the source.

## Review Focus

1. **The planner ignores the new `evidence` field** (it may leave it off every step). The checker must re-cite by target or URL, and must never empty a task: if no acting step can be backed, keep them all and ask one question. *Test: Task 5 `evidence.check.ts` "no step cited and none matchable: all kept, one question".*
2. **The note-taker returns junk:** cards without a quote or events, invented event ids, an unknown kind. These are dropped in code. *Test: Task 3 `notes.check.ts` "invented event ids and quote-less cards are dropped".*
3. **"Try again" on an old recording that still has `point` events.** Points are ignored and nothing crashes. *Test: Task 2 `moments.check.ts` "point and tools events are never in a moment".*
4. **Stop pressed and "I'm done" heard at the same moment.** The second stop is ignored, and nothing throws "not recording" into the UI. *Test: Task 4 `teach.e2e.ts` "a saidDone after Stop is ignored".*
5. **An utterance that's silence, or whose transcription fails.** `/heard` answers `{ text: "", control: null }`, adds no turn and runs no note-taker, and the recording goes on. *Test: Task 4 `teach.e2e.ts` "a silent utterance adds nothing".*

---

## Phase 1: Grounding

### Task 1: The recorder stops logging hover

**Files:**
- Modify: `extension/content.js:153-167` (remove the pointing block)
- Modify: `backend/test/sheets.e2e.ts:99-100` (invert the pointing check)

**Interfaces:**
- Produces: no `point` events from new recordings.

- [ ] **Step 1: Change the test.** In `sheets.e2e.ts`, replace the pointing check with:
```ts
check("resting the mouse on something records nothing", !s.events.some((e: any) => e.kind === "point"), JSON.stringify(s.events.map((e: any) => e.kind)));
```
- [ ] **Step 2: Delete the `pointermove` block and its comment** (`content.js:153-167`).
- [ ] **Step 3: Run** `node test/sheets.e2e.ts` (port 3200 rules apply). Expected: the new check PASSes. The two live-draft checks may FAIL until Task 4 rewrites them, so note them and move on.
- [ ] **Step 4: Commit** "Stop recording where the mouse rests".

### Task 2: Moments and the storyboard

**Files:**
- Create: `backend/src/moments.ts`
- Modify: `backend/src/understand.ts` (`buildPrompt` builds from moments; export `eventLine`)
- Test: `backend/test/moments.check.ts`

**Interfaces:**
- Produces:
```ts
import type { Turn } from "./meta.ts"; // { startMs, endMs, text }, already exported there
export type Moment = { from: number; to: number; said: string | null; events: number[] }; // indexes into s.events
export const IGNORED: Set<string>; // "point", "tools"
export function moments(s: { events: any[]; turns: Turn[] }): Moment[];
// understand.ts
export function eventLine(e: any, i: number, tabs: Map<unknown, string>): string;
```

Grouping rule (the algorithm):
- Leave out `IGNORED` kinds, and events in tabs never clicked, typed or marked in (the existing `used` rule in `buildPrompt`).
- Each turn has a talk window: `[startMs - 1000, endMs + 4000]`, cut short so it ends before the next turn's `startMs - 1000`. An event belongs to the first turn whose window holds `e.t`.
- The remaining events form silent moments: one per run of consecutive leftovers that no turn splits.
- A turn with no events is still a moment.
- `from`/`to` span the turn and its events. The result is sorted by `from`.

- [ ] **Step 1: Write `moments.check.ts`**, with events at `t` = 0 (start), 2000 (click), 9000 (click), 30000 (click), and 31000 (point), and turns `[1500–4000 "open analytics"]` and `[8800–10000 "read views"]`:
```ts
const m = moments({ events, turns });
check("a click while talking belongs to that sentence", m.find((x) => x.said === "open analytics")!.events.includes(1));
check("a click inside the next sentence's window goes to that sentence", m.find((x) => x.said === "read views")!.events.includes(2));
check("a click long after the talking is its own silent moment", m.some((x) => x.said === null && x.events.includes(3)));
check("point and tools events are never in a moment", !m.some((x) => x.events.includes(4)));
check("moments are in time order", m.every((x, i) => i === 0 || m[i - 1].from <= x.from));
```
- [ ] **Step 2: Run** `node test/moments.check.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `moments()`.**
- [ ] **Step 4: Rewrite the main loop of `buildPrompt`.** It walks the moments: a header line `Moment N (a–b s) said: "<text>"` or `Moment N (a–b s) silent`, then each event's `eventLine` and frames, with the existing frame rules and the 48-picture limit. Change the INSTRUCTIONS line "Recording, in time order…" to say the recording is in moments. Delete the pointing instruction and the `talking()` filter. `draft()` is deleted in Task 4, so leave it for now.
- [ ] **Step 5: Run** `node test/moments.check.ts` and `node test/checks.check.ts` (it uses `normalize`). Expected: all PASS.
- [ ] **Step 6: Commit** "Learn from moments: what was said, with what was done".

### Task 3: Cards, the note-taker and the end phrase

**Files:**
- Create: `backend/src/notes.ts`
- Test: `backend/test/notes.check.ts`

**Interfaces:**
- Consumes: `askJson`, `text` from `meta.ts`.
- Produces:
```ts
export type Card = { id: string; kind: "step" | "rule" | "read" | "question"; text: string; quote?: string; events?: number[] }; // events: event DB ids
export type CardOp = { op: "add"; card: Omit<Card, "id"> } | { op: "edit"; id: string; card: Partial<Omit<Card, "id">> } | { op: "remove"; id: string };
export const END_PHRASES: string[]; // the list in Global Constraints, lowercased, plus apostrophe-less forms ("im done", "thats it", "thats all")
export function endPhrase(text: string): boolean;
export function applyOps(cards: Card[], ops: CardOp[], known: Set<number>): Card[];
export async function noteTake(cards: Card[], momentText: string): Promise<{ ops: CardOp[]; control: "done" | "undo" | null }>;
```
- `endPhrase`:
  1. Lowercase, drop punctuation, collapse spaces.
  2. True if the text ends with a phrase.
  3. Otherwise drop one trailing filler word ("na", "now", "po", "please", "remuse", "okay", "ok") and check again, at most twice.
- `applyOps`:
  - New ids continue as `c<n>`.
  - A card counts only if:
    - `text` is non-empty,
    - `kind` is one of the four,
    - it has a non-empty `quote` or events left after keeping only ids in `known`.
  - An edit that breaks these is ignored. Unknown ids are ignored.
- `noteTake` prompt essentials:
  - Input: the cards so far (with ids) and the new moment.
  - Every card cites the person's words or event `#ids` from the moment.
  - Nothing may come from frames alone. A click with no words may become a `step`.
  - `control`: `"done"` only if they finished teaching (not a tab, field or page); `"undo"` for "scratch that" or "no, not that". With undo, use `remove`/`edit` on the card meant.
  - The end phrase itself is never a card.
  - At most one `question` card open at a time.
  - Reply JSON `{ "ops": [...], "control": ... }`. Label `"notes"`.

- [ ] **Step 1: Write `notes.check.ts`:**
```ts
for (const s of ["Okay, that's it.", "tapos na", "Alright, proceed.", "I'm done now", "okay so that's all Remuse", "sige na po"]) check(`"${s}" ends the demo`, endPhrase(s));
for (const s of ["I'm done with this tab", "that's it for the title", "proceed to the next page and click", "go ahead and click Reach"]) check(`"${s}" doesn't`, !endPhrase(s));
const known = new Set([12, 13]);
const c = applyOps([], [
  { op: "add", card: { kind: "step", text: "Open Analytics", events: [12] } },
  { op: "add", card: { kind: "read", text: "Read the views", quote: "I want the views" } },
  { op: "add", card: { kind: "step", text: "Watch this", events: [99] } },   // invented event
  { op: "add", card: { kind: "step", text: "Hover the chart" } },          // no evidence
  { op: "add", card: { kind: "vibe" as any, text: "x", quote: "y" } },     // unknown kind
], known);
check("invented event ids and quote-less cards are dropped", c.length === 2 && c[0].id === "c1" && c[1].id === "c2", c);
const d = applyOps(c, [{ op: "edit", id: "c1", card: { text: "Open the Analytics tab" } }, { op: "remove", id: "c2" }, { op: "remove", id: "c9" }], known);
check("edit and remove by id; unknown ids ignored", d.length === 1 && d[0].text === "Open the Analytics tab");
```
- [ ] **Step 2: Run** `node test/notes.check.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `endPhrase`, `applyOps` and `noteTake` in `notes.ts`.
- [ ] **Step 4: Run** the check. Expected: all PASS.
- [ ] **Step 5: Commit** "Cards that cite what was said or done, and the end phrase".

### Task 4: Utterances while recording, cards live, ending by voice

**Files:**
- Modify: `extension/offscreen.js` (the pause detector runs while recording; `/heard`; `hold`; hearing messages; remove `sendPiece`/ticker)
- Modify: `extension/background.js` (`saidDone`, `hearing`, `status`)
- Rewrite: `backend/src/live.ts`
- Modify: `backend/src/server.ts` (route `/heard`, `GET /live`, `sessions.cards`, `full()`)
- Modify: `backend/src/understand.ts` (delete `draft` and `Draft`)
- Create: `scripts/fixtures/teach.wav`
- Test: `backend/test/teach.e2e.ts`; update `backend/test/sheets.e2e.ts:83-87`

**Interfaces:**
- Consumes: `noteTake`, `applyOps`, `endPhrase`, `Card` (Task 3); `eventLine`, `IGNORED` (Task 2).
- Produces:
```ts
// live.ts
export type LiveState = { turns: Turn[]; cards: Card[]; thinking: boolean; error: string | null };
export async function heard(id: string, wav: Uint8Array, atMs: number, session: () => { events: any[] }): Promise<{ text: string; control: "done" | null }>;
export function liveState(id: string): LiveState | null;
export async function liveCards(id: string): Promise<Card[]>; // waits for queued note-taking
export function endLive(id: string): void;
```
- HTTP:
  - `POST /api/sessions/:id/heard?at=<ms>` (WAV) → `200 { text, control }`.
  - `GET /api/sessions/:id/live` → `LiveState` (empty when none).
  - `POST /live` is removed.
- Extension messages:
  - offscreen → background `{ type: "saidDone", sessionId }` and `{ type: "hearing", on: boolean }`.
  - background → offscreen `{ target: "offscreen", type: "hold", on: boolean }`.
  - `status()` adds `hearing: boolean`.
- DB: `sessions.cards TEXT` (JSON). `full(id)` returns `cards: Card[]` (`[]` when null).

`heard` behaviour:
1. Transcribe. Empty text: return `{ text: "", control: null }` and change nothing.
2. Otherwise push the turn at `atMs + startMs`.
3. Queue a note-take on the session's chain. Its moment text is the utterance plus every non-ignored event with DB id greater than the last one note-taken, each as `eventLine(e, e.id, tabs)` without selectors. Then `applyOps` with `known` = those ids plus earlier card ids.
4. If `endPhrase(text)`: await that note-take and return `control: "done"` only when its control is `"done"`. Otherwise return at once with `control: null`.
5. The end-phrase utterance's ops are discarded.

Offscreen: in recording mode `parts` is never trimmed. An utterance is `parts.slice(from)` at its end, and its `at` is `parts[from].at`. When the `/heard` reply says `done`, send `saidDone`. While held, the detector stays not-speaking.

- [ ] **Step 1: Make the fixture.** Run PowerShell with `System.Speech` at 16 kHz/16-bit/mono to `scripts/fixtures/teach.wav`: "Open the report page and read the total." + 3 s of silence + "Okay, that's it." + 8 s of silence (use `SpeakSsml` with `<break time="3s"/>`).
- [ ] **Step 2: Write `teach.e2e.ts`.** Start the Agent and Chromium with the extension (copy the setup from `sheets.e2e.ts`, using `teach.wav` with `%noloop`), serve a page with a "Report" link, start recording, click it, then:
```ts
check("while recording, each sentence is heard whole", lv.turns.some((t: any) => /report/i.test(t.text)), JSON.stringify(lv.turns));
check("cards appear, each citing words or a click", lv.cards.length > 0 && lv.cards.every((c: any) => c.quote || c.events?.length), JSON.stringify(lv.cards));
check("saying \"okay, that's it\" ends the recording by itself", stoppedByVoice, `recording=${st.recording}`);
check("the end phrase is not a card", !saved.cards.some((c: any) => /that's it/i.test(c.quote ?? "")));
check("a saidDone after Stop is ignored", !(await sw.evaluate(() => (globalThis as any).showrun.status())).recording && noError);
check("a silent utterance adds nothing", silent.text === "" && silent.control === null && after.turns.length === before.turns.length);
```
"Silent" is a 2 s zero WAV posted to `/heard` on a second session. "saidDone after Stop" sends `chrome.runtime.sendMessage({ type: "saidDone", sessionId: <stopped id> })` from a page in the test, and expects no error and no state change.
- [ ] **Step 3: Run** it. Expected: FAIL.
- [ ] **Step 4: Implement** offscreen, background, `live.ts`, the server routes and the column. Delete `draft()`, `Draft` and the `/live` POST.
- [ ] **Step 5: Update `sheets.e2e.ts:83-87`.** The live draft checks become "while recording, the voice is heard in sentences" (`lv.turns.length > 0`) and "cards show up before you stop" (`lv.cards.length > 0`).
- [ ] **Step 6: Run** `teach.e2e.ts` and `sheets.e2e.ts`. Expected: all PASS.
- [ ] **Step 7: Commit** "Hear whole sentences while recording; end by saying so".

### Task 5: Evidence in the plan, the checker, and no automatic practice

**Files:**
- Create: `backend/src/evidence.ts`
- Modify: `backend/src/understand.ts` (schema `evidence`, prompt cards section, `understand()` calls `checkEvidence`, `Spec.questions`)
- Modify: `backend/src/server.ts` (`learn()`: `liveCards` → save cards → understand → coverage → saveSpec; no `autoPractice`)
- Test: `backend/test/evidence.check.ts`

**Interfaces:**
- Consumes: `moments`, `IGNORED` (Task 2); `Card` (Task 3); `liveCards` (Task 4); `checker`, `askJson` (`meta.ts`).
- Produces:
```ts
// understand.ts
Step.evidence?: { events: number[]; quote?: string }   // indexes into s.events
Spec.questions?: Question[]
// evidence.ts
export type Question = { id: string; text: string; quote?: string; step?: Step; after?: string }; // after: id of the step before a removed one
export const ACTING: Set<string>; // click fill press goto upload open_item compare
export function checkEvidence(spec: Spec, events: any[]): void; // mutates spec
export async function coverage(spec: Spec, turns: Turn[], cards: Card[]): Promise<Question[]>; // ≤ 3, ids "q-cover-<n>"
```

`checkEvidence` rules:
- It skips steps of outcomes with `demonstrated: false`.
- Valid evidence: indexes in range whose event isn't `IGNORED`.
- An acting step without valid evidence is re-cited in this order:
  1. The first click/input/key/upload event whose target role and label equal the step's target role and name (case-insensitive).
  2. For `goto`: a start or page event with the same origin + pathname.
  3. For `open_item`: `spec.inputs.itemEvent`.
- A step still unbacked is removed, and becomes the question ``{ id: `q-${step.id}`, text: `I wasn't sure about "${describe}". Did you do that?`, step, after }``. **Exception:** if every acting step in `spec.steps` is unbacked, keep them all and add the single question `{ id: "q-evidence", text: "I couldn't match my steps to what you did. Please check them." }`.
- `extract` and `report` steps are kept.
- `fromEvent ??= evidence.events[0]`.

`checkEvidence` is called in `understand()` after `normalize()`, never from `revise()`.

Prompt changes:
- Each step needs `"evidence": { "events": [<#>], "quote": "<their words, optional>" }`. Acting steps must cite events.
- The cards are listed as "What the person said they want while teaching (follow these)", with their event ids mapped to `#index`.

`coverage` sends the utterances, cards, step `describe`s and rules to `checker().model` (label `"coverage"`). It asks for at most 3 things the person asked for that the task doesn't do, as JSON `[{ "text": "<short question>", "quote": "<their words>" }]`. Errors → `[]`.

- [ ] **Step 1: Write `evidence.check.ts`.** Events: `start`(url A), `click`(tab "Analytics"), `input`, `point`. Cases:
```ts
check("a step citing a real click keeps it and sets fromEvent", one.steps[0].fromEvent === 1);
check("an uncited click step is re-cited by its target", two.steps.find((s) => s.id === "s2")!.evidence!.events[0] === 1);
check("an uncited goto is re-cited by its URL", two.steps[0].evidence!.events[0] === 0);
check("an unbacked click is removed and asked about, with the step kept on the question", !three.steps.some((s) => s.id === "s9") && three.questions![0].id === "q-s9" && three.questions![0].step!.id === "s9");
check("a step citing a point event counts as unbacked", !four.steps.some((s) => s.id === "s3"));
check("no step cited and none matchable: all kept, one question", five.steps.length === 2 && five.questions!.length === 1 && five.questions![0].id === "q-evidence");
check("undemonstrated outcome steps are left alone", six.outcomes.refund.steps.length === 1);
```
- [ ] **Step 2: Run** `node test/evidence.check.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `evidence.ts`, the schema and prompt changes, and the `learn()` reorder. Delete `autoPractice(specId)` in `learn()`, with a `// ponytail:` note: practice now starts when he approves in review (teaching always precedes learning); `/practice` is one call.
- [ ] **Step 4: Run** `evidence.check.ts`, `checks.check.ts`, `build.check.ts`, and `PORT=3299 node test/practice.e2e.ts` (it calls `/practice` explicitly). Expected: all PASS.
- [ ] **Step 5: Commit** "Every learned step shows what it came from". Push, then open the draft PR (base `feat/google-accounts`) titled "Teaching mode: Remuse hears, watches and talks back", with the spec path in the body.

## Phase 2: Teaching mode, voice end, shortcut

### Task 6: Shortcuts, mode and the recording broadcast

**Files:**
- Modify: `extension/manifest.json` (`commands`, `tts` permission)
- Modify: `extension/background.js` (`command()`, `mode`, broadcast, `onCommand`)
- Modify: `extension/sidepanel.js` (`ALLOWED` += `"mode"`, `"speak"`, `"hush"`, `"keys"`)
- Test: `backend/test/teach.e2e.ts` (add checks)

**Interfaces:**
- Produces (background):
```js
let mode = "idle"; // "idle" | "learning" | "review" | "practice", set by the sidebar: ext("mode", { mode })
async function command(name) // "teach" | "pen"; exposed as showrun.command
// keys: ext("keys") -> { teach: "Alt+Shift+S", pen: "Alt+Shift+D" } from chrome.commands.getAll()
// to tabs: { type: "recording", on: boolean } on start/stop; { type: "pen" } on the pen command
```
- `teach` command, by state:
  - speaking → `hush()` (Task 8; until then a no-op)
  - recording → `stop()`
  - `mode === "idle"` → `start("")`
  - otherwise nothing
- `onCommand`: `chrome.sidePanel.open({ windowId: tab.windowId })` **first, before any await** (it needs the gesture), then `command(name)`.

- [ ] **Step 1: Add checks to `teach.e2e.ts`:**
```ts
await call("command", "teach"); check("the teach shortcut starts a recording", (await call("status")).recording);
await call("command", "teach"); check("pressed again, it stops", !(await call("status")).recording);
await call("setMode", "review"); await call("command", "teach");
check("during a review it never starts a new recording", !(await call("status")).recording);
```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Expose `command` and `setMode(m)` (the same setter the `mode` message uses) on `globalThis.showrun`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** "Alt+Shift+S starts and stops teaching".

### Task 7: The teaching screen

**Files:**
- Create: `backend/web/src/pages/teach.tsx`
- Modify: `backend/web/src/pages/remote.tsx` (render `TeachMode` alone while teaching; `FollowAlong`'s live-draft parts are removed)
- Modify: `backend/web/src/lib/api.ts` (`Card`, `LiveState` types)
- Test: `backend/test/teach.e2e.ts` (panel checks)

**Interfaces:**
- Consumes: `/sessions/:id/live` (Task 4); `ext("status")` → `{ recording, rec, hearing, speaking, mode }`; `ext("keys")`; `ext("mode")` (Task 6).
- Produces:
```tsx
export function TeachMode({ sessionId, onExit }: { sessionId: string; onExit: () => void }): JSX.Element
```
- **When it shows:**
  - `Remote` keeps `teachId` in state, set when a recording starts (`rec.rec.id`) and cleared by `onExit`. It's mirrored in `localStorage` key `remuse.teach` (read and written in try/catch).
  - While `teachId` is set, `Remote` returns only `<TeachMode>`.
- **Layout:** as in design §7.10.
- **One big state word** (24 px), from status, the task's `learnStage` and review state:
  - **Listening** · **Hearing you** · **Got it, you're done**: about 1.5 s after a stop by voice or button, before learning shows.
  - **Thinking**, with `STAGE[learnStage]` as the small line.
  - The review states come in Task 10.
- **Caption:** the last turn at 20 px, fading in. "Hearing you…" while `hearing`.
- **Cards:** numbered, 15 px text. Each has a 13 px evidence line: `you said "<quote>"` or `you clicked "<label>"` (event label from `/sessions/:id`). Questions are marked "?".
- **Bottom bar** (sticky): Stop, "or say 'I'm done'", the bound keys from `ext("keys")`, and the timer. An `audioError` shows "No voice: …" above Stop.
- `ext("mode", { mode })` is sent on each change: `idle` when exiting, `learning` while learning.
- Polling: `ext("status")` every 500 ms; `/live` every 1500 ms while recording or learning.

- [ ] **Step 1: Add panel checks to `teach.e2e.ts`** (open `chrome-extension://<id>/sidepanel.html` as `sidepanel.check.ts` does, during the recording):
```ts
check("teaching shows its own screen: no Connected sites, no task list", !(await frame.getByText("Connected sites").count()) && !(await frame.getByText("Your tasks").count()));
check("Stop and the voice hint are on screen", await frame.getByRole("button", { name: /Stop/ }).isVisible() && await frame.getByText(/say .I'm done./).isVisible());
check("the cards show their evidence", await frame.getByText(/you (said|clicked)/).first().isVisible());
```
Save a screenshot to `scratchpad/teach-recording.png` and look at it.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Then run `cd backend/web && npm run build`.
- [ ] **Step 4: Run** the checks and look at the screenshot against §7.10. Expected: PASS, roomy, nothing under 13 px.
- [ ] **Step 5: Commit** (source + `backend/public`) "Teaching gets its own screen".

## Phase 3: The spoken review

### Task 8: Remuse speaks (`chrome.tts`, mic holds off)

**Files:**
- Modify: `extension/background.js` (`speak`, `hush`, `speaking` in `status`; `start()` hushes first)
- Modify: `extension/offscreen.js` (`hold`, already added in Task 4)
- Test: `backend/test/teach.e2e.ts` (add checks)

**Interfaces:**
- Produces:
```js
async function speak(lines /* string[] */) // -> { spoken: number }; resolves when the last line ends or hush() is called
function hush()                            // stops speech, speaking = null, hold off
// status().speaking: { line: number, total: number } | null    (line = index being spoken)
// ext("speak", { lines }), ext("hush")
```
- Voice choice: see Global Constraints, cached after the first `chrome.tts.getVoices`.
- Lines are queued with `enqueue: true`. `onEvent` `end` advances `speaking.line`; `interrupted`/`cancelled`/`error` end it.
- The hold is on from the first line until the end or `hush()`.
- With no voices at all (headless), `speak` resolves `{ spoken: 0 }` at once.

- [ ] **Step 1: Add checks:**
```ts
const sp = call("speak", ["One.", "Two."]); check("speaking shows in status", (await call("status")).speaking !== null || (await sp).spoken === 0);
await call("hush"); check("hush ends it", (await call("status")).speaking === null);
await call("speak", ["Long line to be cut off."]); await call("command", "teach");
check("the teach shortcut while speaking only silences it", !(await call("status")).recording && (await call("status")).speaking === null);
```
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Hook `hush()` into `command("teach")` and `start()`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** "Remuse can speak, and the mic waits while it does".

### Task 9: Review on the server: readback, answers, what to say back

**Files:**
- Create: `backend/src/readback.ts`
- Modify: `backend/src/understand.ts` (`sortSaid` gets the open question and an `answer` intent)
- Modify: `backend/src/server.ts` (`hearSaid`, `applyFeedback` options, `/feedback` body `practice`, `GET /specs/:id/readback`, `Heard.speak`)
- Test: `backend/test/readback.check.ts`; add to `backend/test/converse.e2e.ts`'s sort checks

**Interfaces:**
- Consumes: `Question`, `Spec.questions` (Task 5).
- Produces:
```ts
export type Line = { text: string; step?: string; question?: string };
export function readback(spec: Spec): { plan: Line[]; questions: Line[] };
export async function sortSaid(spec: Spec, said: string, question?: string): Promise<{ intent: "change" | "approve" | "schedule" | "run" | "teach" | "answer" | "none"; schedule?: {...} }>;
async function applyFeedback(row, said: string, opts?: { practice?: boolean; answered?: string })
// GET /api/specs/:id/readback -> { plan: Line[], questions: Line[] }
// GET /api/sessions/:id/say adds: speak?: string[], answered?: string
```
- `readback` copy:
  - "Here's my plan."
  - `Step ${n}: ${describe without trailing period}.` for main steps, then outcome steps. Over 8 steps: the first 8, then `And ${rest} more steps, all on the screen.`
  - Each rule with `said`, or a rule whose `if` isn't "otherwise": `If ${said ?? if}, I'll ${outcome describe, first letter lowercased}.`
  - Questions: `One thing: you said "${quote}". ${text}`, or just `text` when there's no quote.
- `hearSaid`: the open question is the latest spec's `questions[0]`. What each intent does:
  - `answer` → `applyFeedback(row, "Q: <text>[ (the step I took out: <step JSON>)]\nA: <said>", { practice: false, answered: id })`. Speak the changes.
  - `change` → `applyFeedback(row, said, { practice: false })`. Speak the changes, or ["I changed it."].
  - `approve` | `run` → speak ["Okay, I'll try it once on your example."]
  - `schedule` → speak ["Okay, it'll repeat on that schedule."]
  - Others → no speak.
- `applyFeedback` keeps `row.spec.questions` minus `answered` on the new spec, and runs `autoPractice` only when `opts.practice !== false`.

- [ ] **Step 1: Write `readback.check.ts`:**
```ts
check("plan starts with the intro and numbers each step", r.plan[0].text === "Here's my plan." && r.plan[1].text === "Step 1: Open YouTube Studio." && r.plan[1].step === "s1");
check("over 8 steps: 8, then how many more", long.plan.filter((l) => l.step).length === 8 && /And 3 more steps/.test(long.plan.at(-1)!.text));
check("rules read as 'If …, I'll …'", r.plan.some((l) => l.text === "If it's damaged, I'll refund it."));
check("a question quotes the person", r.questions[0].text === `One thing: you said "only new videos". Every video, or only the newest?` && r.questions[0].question === "q-cover-1");
```
- [ ] **Step 2: Add to `converse.e2e.ts`'s sort checks** (the model is real):
```ts
const q = "Should I do this for every video, or only the newest one?";
check(`with a question open, "yes, every video" is an answer`, (await sortSaid(spec as any, "yes, every video", q)).intent === "answer");
check(`with a question open, "looks good" is still approve`, (await sortSaid(spec as any, "looks good, that's it", q)).intent === "approve");
```
- [ ] **Step 3: Run** both. Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** `readback.check.ts`, `SKIP_SORT= node test/converse.e2e.ts <wav>` (sort part), `PORT=3299 node test/feedback.e2e.ts`. Expected: PASS.
- [ ] **Step 6: Commit** "Review: read the plan, ask one question at a time, say what changed".

### Task 10: The review on the teaching screen

**Files:**
- Modify: `backend/web/src/pages/teach.tsx` (review flow)
- Create: `backend/web/src/lib/say.ts`
- Test: `backend/test/say.check.ts`; manual live check

**Interfaces:**
- Consumes: `GET /specs/:id/readback`, `/sessions/:id/say` (`speak`, `answered`) (Task 9); `ext("speak" | "hush" | "listen" | "unlisten" | "mode")`; `POST /specs/:id/practice`; `PracticeState` from `/tasks`.
- Produces:
```ts
// say.ts (no imports but types)
export function practiceSay(p: PracticeState): string;
```
- `practiceSay` copy, in order:
  - `I got stuck: ${problem}.`
  - all values ok → `That worked. I read ${name1} ${got1}, ${name2} ${got2}.` (names with `_` → space)
  - wrong values → `I read ${name} as ${got}, but you saw ${want}.` (first one only)
  - `asked` → `On your example I'd ask you: ${asked}`
  - `stoppedBefore` appends ` I stopped before "${x}"; real runs wait for your OK there.`
- **Review flow** (`learnStage` becomes `ready`; `ext("mode", "review")`):
  1. **Speaking:** `ext("speak", plan)`. The spoken line is highlighted from `status.speaking.line`.
  2. For each question in turn: **Speaking**, then **Listening for your answer**. A new `/say` with `answered` moves to the next one.
  3. **Listening for changes:** `ext("listen")`.
  4. On each new `/say` result, speak `speak` if any. Then:
     - `change`: highlight the changed steps (re-read the spec, compare `describe`s).
     - `approve`/`run`: `POST /practice`, mode `practice`, **Practicing**. When it ends, speak `practiceSay`, then **Listening for changes** again.
     - `approve` after a practice, or **Looks right**: `onExit()`.
     - `teach`: `onExit()` + `ext("start")`.
- **Bottom bar:** **Looks right** · **Show you again** · **Stop listening**, plus "Type instead" (posts `/feedback` with `practice: false`; the result `changes` are spoken).
- **Evidence:** tapping a plan step opens its evidence under it: the quote, and the clicked or marked thing's label (`step.evidence.events` → `/sessions/:id` events).
- After 2 quiet minutes: unlisten, and say so on screen.

- [ ] **Step 1: Write `say.check.ts`** (imports `../web/src/lib/say.ts`):
```ts
check("all read right", practiceSay(ok) === "That worked. I read views 2,607, ctr 5.1%.");
check("stuck", practiceSay(stuck) === "I got stuck: the Reach tab wasn't there.");
check("a wrong value", practiceSay(bad) === "I read views as 2,600, but you saw 2,607.");
```
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement** `say.ts` and the flow, then `npm run build`. **Step 4: Run** `say.check.ts` and `teach.e2e.ts`. Expected: PASS.
- [ ] **Step 5: Live check on James's Agent** (restart rules apply; he reloads the extension). Teach "YouTube Studio views + CTR", end with "okay, that's it", hear the plan, say "no, step 2, use the Reach tab", hear the change, say "looks good", watch the practice, hear the result.
- [ ] **Step 6: Commit** (source + `backend/public`) "Remuse reads its plan aloud and takes spoken corrections".

## Phase 4: Drawing (cut first if behind)

### Task 11: Marks drawn on the page

**Files:**
- Modify: `extension/content.js` (overlay, right-drag, pen, classify, targets, `mark` event; the click recorder skips while drawing)
- Modify: `extension/background.js` (a `mark` gets a `before` screenshot)
- Modify: `backend/src/understand.ts` (`eventLine` for marks; the mark instruction from design §7.6, verbatim)
- Test: `backend/test/marks.e2e.ts`

**Interfaces:**
- Consumes: the `{ type: "recording" | "pen" }` tab messages (Task 6); `describe()` in `content.js`.
- Produces: event `{ kind: "mark", shape: "circle" | "underline" | "line", grid: {x_min,y_min,x_max,y_max}, path: {x,y}[] /* ≤ 32 points, 0–1000 grid */, targets: ReturnType<typeof describe>[] /* ≤ 3 */ }`, with a `before` PNG showing the ink.
- **Gestures:**
  - While recording, a right-button drag over 20 px draws and suppresses the next `contextmenu`. A plain right-click is untouched.
  - In pen mode a left drag draws, and that `pointerdown` is neither recorded as a click nor passed to the page.
- **Ink:** a full-viewport canvas in a closed shadow root, `pointer-events: none`, stroke `#ff3b30`, 4 px, round. It stays 1500 ms, then fades over 300 ms.
- **Shape:**
  - `underline` if the box height < 40 px and < 0.2 × its width.
  - else `circle` if the gap from start to end < 0.25 × the larger side.
  - else `line`.
- **Targets:**
  - circle: sample `elementsFromPoint` on a 5×5 grid inside the box; keep elements at least 60 % inside it and with an area under 1.5 × the box; smallest first, those with text first.
  - underline: points 8 px above the stroke; the smallest element with text.
  - line: the elements at both ends.

- [ ] **Step 1: Write `marks.e2e.ts`** (page with `<span id="views">Views 2,607</span>`, recording on; strokes with `page.mouse.down({ button: "right" })` and moves):
```ts
check("circling a number with the right button makes a mark on it", m?.shape === "circle" && m.targets.some((t: any) => /Views 2,607/.test(t.text)) && !!m.before);
check("underlining makes an underline mark", u?.shape === "underline");
check("a plain right-click makes no mark", marks.length === 2);
check("pen mode: a left drag draws and isn't recorded as a click", penMarks === 1 && clicksDuringPen === 0);
check("not recording: dragging draws nothing", afterStop === marks.length + penMarks);
```
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS. Look at one `before` PNG to confirm the ink shows.
- [ ] **Step 5: Commit** "Draw on the page to show Remuse what you mean".

### Task 12: SAM 3.1 finds what's circled on charts and canvases

**Files:**
- Create: `backend/src/marks.ts`
- Modify: `backend/src/server.ts` (`learn()` calls `resolveMarks` before `understand`), `backend/src/understand.ts` (`eventLine` shows `sam`)
- Test: `backend/test/marks.check.ts`

**Interfaces:**
- Consumes: `sam`, `askJson`, `png` (`meta.ts`).
- Produces:
```ts
import type { Box } from "./meta.ts"; // 0–1000 grid box, already exported there
export function bestBox(boxes: Box[], ink: Box): Box | null; // highest overlap with the ink box; null if none overlaps
export async function resolveMarks(events: any[], dir: string, save: (eventId: number, data: object) => void): Promise<void>;
```
- A mark needs resolving when it has no targets, or every target's `tag` is `canvas` or `svg`.
- For each one:
  - `askJson` with its inked frame: "What did the person circle? Reply {"phrase": "<2–4 word noun phrase>"}" (label `"mark-phrase"`).
  - Then `sam(frame, phrase)` and `bestBox`.
  - Save `{ samPhrase, samBox }` into the event's data.
- Errors skip the mark.

- [ ] **Step 1: Write `marks.check.ts`:**
```ts
check("the box overlapping the ink most wins", bestBox([a, b], ink) === b);
check("no overlap: none", bestBox([far], ink) === null);
```
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** "SAM 3.1 finds what you circled on a chart".

## Finish

### Task 13: Whole-branch check and hand-over

- [ ] **Step 1:** Run every `*.check.ts`, then the e2e suites:
  - `PORT=3299` for the server-only ones.
  - `teach`, `sheets`, `marks`, `sidepanel` and `recorder` on 3200, under the restart rules.
  Expected: all PASS, except the eval, which isn't run (James starts it only when he asks).
- [ ] **Step 2:** Dispatch one fresh code reviewer on `git diff feat/google-accounts...feat/teach-mode`. Fix what it finds and re-run the affected tests.
- [ ] **Step 3:** Restart James's Agent and ask him to reload the extension. Then take him through the live acceptance in spec §10, in one short message.
- [ ] **Step 4:** Mark the PR ready for review and give James the link. Never merge.
