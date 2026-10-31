# Teaching mode: Remuse that hears, watches, and talks back

Date: 2026-10-31. Status: waiting for James's approval. Branch: `feat/teach-mode` (stacked on `feat/google-accounts`, which holds open PRs #25 to #29).

## 1. Why

James tested Remuse on a real task (YouTube Studio: read views, click-through rate (CTR) and average view duration (AVD), and report the change). His verdict, in his words:

- "it feels like blind, hallucinating". The steps list things he never said ("watch this"), probably taken "from how I hover", "I stayed with my mouse there".
- "it does not match what I am saying… I want the agent to hear, and at the same time look at what I am doing".
- The listening part is "crammed" into a dashboard that already shows too much. He wants a **work mode**: once teaching starts, the sidebar is only about capturing what he shows and says. Muse on top, no Connected sites, no overstimulation.
- He wants to **end the demo by voice** ("proceed", "I'm done demonstrating"). He still needs to see clearly whether Remuse is listening, and a Stop button stays.
- After the demo, Remuse should **say its plan out loud** ("first step I will do is this…"), keep listening, and take **spoken corrections** ("oops, you are wrong there, instead of this, do that"). Today, the way to give feedback or re-record after Stop is unclear.
- **Shortcuts** to start teaching. "If this is implemented to the fullest… it can change how I work, so I can really use this one."
- **Drawing on the page** to label things ("draw, doodle, like 'you must select this'").
- No video until the product is ready.

He heard Chrome's built-in voices on a test page and said they are good.

## 2. What's wrong today (from the code)

1. **Resting the mouse counts as pointing.** `extension/content.js:153-167` sends a `point` event whenever the mouse rests 0.7 s on a new element. `backend/src/understand.ts:149` keeps every point within 2 s of speech, and a narrated demo is speech end to end, so nearly every hover reaches Muse Spark. Each point also costs a screenshot (`understand.ts:168`) out of a 48-picture limit, which pushes out pictures of real clicks.
2. **The live draft takes every point, unfiltered.** `understand.ts:195` keeps all points, then only the last 120 lines. It is rewritten from scratch on every piece of voice (at most 8 steps), so it churns and invents steps.
3. **Voice is cut blindly every 8 s** (`extension/offscreen.js:26`), mid-word, for the live view.
4. **Nothing ties a step to evidence.** Muse Spark gets one time-sorted mix of event lines, voice lines and frames, and lines them up itself. `fromEvent` may be null, and nothing checks that what he said was used.
5. **Voice review exists but is silent and hidden.** After learning, `FollowAlong` opens the mic (`converse` in `offscreen.js`, then `hearSaid` → `sortSaid` → `applyFeedback` in `server.ts:219-237`). But Remuse never speaks, and the only sign is a 12.5 px "Listening" line at the bottom (`remote.tsx:285`). There is no end phrase and no keyboard shortcut (the manifest has no `commands`).

The root problem: features were added on top (more prompt rules, a box in the dashboard). What Muse sees, and how the conversation takes turns, were never fixed.

## 3. Goals

- **G1. Grounded learning.** Every step and rule Remuse learns comes from something he did (a click, typing, a page, a drawn mark) or said (a quote), and shows that evidence. Hovering adds nothing.
- **G2. Everything he says gets used.** What he said that the task doesn't use yet is caught and asked about, out loud.
- **G3. Teaching mode.** A dedicated full-sidebar screen while teaching and reviewing. Calm, roomy, with one clear state at a time.
- **G4. Voice end.** Saying he's done ends the recording. The Stop button and shortcut still work.
- **G5. Spoken review loop.** Remuse reads the plan step by step and listens. Spoken corrections change the task, and it says what changed. "Looks good" or "try it" moves on.
- **G6. Shortcuts.** Start or stop teaching from any tab, and toggle the pen.
- **G7. Drawing.** Marks drawn on the page become evidence, as strong as a click for "what to read" or "what this is about".

## 4. Non-goals

- Word-by-word live captions. Muse Voice Transcribe gives back whole utterances, so captions appear per sentence, about 1 to 2 s after a pause.
- Full-duplex talk, where he can talk over Remuse on laptop speakers and it stops at once. Turn-taking is half-duplex (see 5.6).
- New run-time features. The runner, approval gate, step checks, practice, schedules and accounts stay as they are.
- The video script (it comes after the product is ready).
- A settings screen for voices. One sensible default is used.

## 5. Anti-goals (a failure even if it "works")

- Steps or cards that he didn't do or say.
- A teaching screen that looks like the dashboard with a box added.
- Remuse talking over him, or hearing its own voice as his.
- The recording ending because he said "done" about something else ("I'm done with this tab").
- Any change that weakens the approval gate before pay, send, refund or submit.

## 6. Constraints

- Hackathon: public repo, all new work. Meta models must really be used (Muse Spark, Muse Voice Transcribe, SAM 3.1, Muse Spark Open). Deadline Thu Nov 5, 10:00 Manila. James needs Nov 4 for the video, so the build should finish by the end of Nov 3.
- Never copy Google cookies or the Remuse browser profile. Never print `.env` or keys.
- PRs are opened, never merged (James merges).
- Restart James's Agent only when its browser isn't in use.
- Stack: Node 24 TypeScript Agent (`backend/src`), node:sqlite, React sidebar (`backend/web`, served in the side panel iframe at `127.0.0.1:3200/#/remote`), MV3 extension (`extension/`). Add no new npm dependencies unless truly needed.

## 7. Design

### 7.1 The pipeline: six roles, one rule

**The rule: every learned step carries its evidence.** A step without evidence is either dropped or turned into a question.

| Role | Job | Where | Model |
|---|---|---|---|
| Ears | Cut speech at pauses into utterances; transcribe each whole | `offscreen.js` (the existing voice detector), new `POST /sessions/:id/heard` | Muse Voice Transcribe |
| Eyes | Record clicks, typing, pages, uploads, tools, and **marks**. No hover | `content.js`, `background.js` | none |
| Note-taker | After each utterance, update the **cards** using the new **moment** | `live.ts` | Muse Spark (small, text only) |
| Planner | When teaching ends, write the Task Spec from the storyboard plus the cards. Each step cites evidence | `understand.ts` | Muse Spark |
| Checker | Drop or flag steps with no evidence. Find things he said that the task doesn't cover yet | `understand.ts` (code) + one model call | Muse Spark Open (falls back to Muse Spark) |
| Narrator | Speak the plan, listen, apply corrections, speak back what changed | sidebar + `background.js` (`chrome.tts`) + `hearSaid` | Muse Spark |

### 7.2 Eyes

- **Remove the `point` event entirely** (`content.js:153-167`). Old recordings that contain points: `buildPrompt` and `draft` ignore them.
- Screenshots are taken only for actions (click, key), pages reached without an action, marks, and the start screen.
- **Marks (drawing).** See 7.8. A mark is an event `{ kind: "mark", shape, grid, path, targets: [describe(el)…] }` with a "before" screenshot that shows the ink.

### 7.3 Ears

- While recording, `offscreen.js` runs the same pause-based detector that `converse` mode already uses (`hearing()`): speech starts when the sound is louder than the room for 0.15 s, and ends after 1.2 s of quiet. Each utterance is sent whole to `POST /sessions/:id/heard?at=<ms into recording>` (WAV). This replaces the 8 s `sendPiece` ticker and `/live`. The full recording is still kept and uploaded on stop, as today.
- The server transcribes the utterance, adds it to the live turns with its recording time, and runs the note-taker (7.4). The response tells the extension whether this utterance ended the demo (7.5).
- The final learning still transcribes the whole `voice.wav` (best timing and context). The live utterances only drive the cards and the end phrase. *(My call: keeps the proven path; the cost is one extra transcription.)*
- The offscreen document reports whether he is speaking right now (`hearing: true/false`), so the sidebar can show "Hearing you…" before the caption arrives. *(How it's relayed, a status field on the extension or a message, is left to the builder.)*

### 7.4 Moments and cards

**Moment** (built in code, `moments(session)` in `understand.ts`): one utterance, plus the actions from 1 s before it starts until the next utterance starts, plus the frames of those actions. Actions with no speech around them form their own moment ("silent actions"). The storyboard is the list of moments in time order. Both the note-taker and the planner use it in place of the flat mixed list.

Example of what Muse Spark gets:
```
Moment 4 (31.2-36.0s) said: "now open Analytics, I want the views"
  #12 click tab "Analytics"   [frame after]
```

**Cards** are the live notes. They are kept in memory while recording and saved on the session (`sessions.cards` JSON) when it ends.

```ts
type Card = {
  id: string;                       // c1, c2… stable across updates
  kind: "step" | "rule" | "read" | "question";
  text: string;                     // plain words: "Open the Analytics tab", "Read the views"
  quote?: string;                   // his words this came from
  events?: number[];                // event #s it came from (clicks, marks…)
};
```

- **The note-taker call** (one per utterance; it waits if one is already running, as `redraft` does today) gets the current cards and the new moment. It replies with operations: `add`, `edit` (by id), `remove` (by id), plus a `control` field: `"done" | "undo" | null`.
  - `"undo"` covers "scratch that" and "no, not that". It removes or edits the card he means.
  - A question card is added only when something important is unclear. It is shown, not spoken, during recording.
- **Rule for the note-taker:** a card must cite a quote or an event from the moments. A moment with a click and no speech may produce a `step` card. Nothing comes from frames alone.
- Cards replace the live `Draft` type and `draft()`. `GET /sessions/:id/live` returns `{ turns, cards, hearing, thinking, error }`.

### 7.5 Ending by voice

- **Phrase check (code, instant).** Each utterance's text is matched against end phrases, English and Tagalog: "I'm done", "that's it", "that's all", "proceed", "go ahead", "you can start", "tapos na", "ayan na", "sige na", "done showing", "okay Remuse". Match within the last few words of the utterance only.
- **Confirmation (model).** On a match, the note-taker's `control === "done"` must agree. Its prompt says "done" means done teaching, not done with a tab, field or page.
- On confirmation, the `/heard` response carries `{ control: "done" }`. `offscreen.js` tells `background.js`, which runs the same `stop()` as the button. The end phrase itself never becomes a card.
- The teaching screen always shows: Stop, the hint "or say 'I'm done'", the timer, and the hearing state. When the phrase is heard, the screen shows "Got it, you're done" for a moment before switching to Thinking.

### 7.6 Planner and checker

**Planner.** `understand()`'s prompt is built from the storyboard (moments) plus the confirmed cards ("what the person said they want; follow these"). Changes to the schema:
- Every step gets `evidence: { events: number[]; quote?: string }`. Steps that act (`click`, `fill`, `press`, `goto`, `upload`, `open_item`, `compare`) must cite at least one event. `extract`/`report` steps and outcome steps may cite only a quote. Outcome steps that weren't demonstrated keep `demonstrated: false` and need a quote saying what to do.
- `fromEvent` is set from `evidence.events[0]` (existing code depends on it).
- Rules keep `said` (already required).
- The prompt line about pointing is replaced by one about marks: "a mark is the person circling or underlining something on purpose. Treat it like a click for knowing what to read or what a rule is about; don't turn a mark into a click step."

**Checker** (runs in `normalize()`; the coverage part runs once after it):
1. *Evidence (code).* An acting step whose cited events don't exist, or that cites none: if its `target` matches an event's target by role and name, cite that event. Otherwise drop the step and add a question: "I wasn't sure about '<describe>'. Did you do that?" Extract/report steps with neither events nor a quote: keep them only if a variable or a card asks for that value.
2. *Coverage (one model call: Muse Spark Open, falling back to Muse Spark).* Input: the utterances, the cards and the spec's steps and rules. Output: things he asked for that the spec doesn't do, as at most 3 short questions, each with the quote.
3. The questions are saved on the spec as `questions: { text: string; quote?: string }[]` (new optional field) for the review (7.7).

### 7.7 The spoken review loop

When learning finishes, the sidebar stays in teaching mode and switches to **Review**:

1. **Readback.** Remuse speaks: "Here's my plan." Then one line per step: "Step 1: <describe>." Rules come next ("If <said>, I'll <then>."), then the checker's questions ("One thing: you said '<quote>'. <question>"). The line being spoken is highlighted. The lines come from code (step `describe`, rule `said`/`then`, `questions`), with no model call. Long plans: steps first, then "And N more steps, all on the next screen." when over 8.
2. **Listening.** After the readback the mic opens (the existing `converse`), with a big visible "Listening, tell me what to change, or say 'looks good'".
3. **His reply**, via `hearSaid` → `sortSaid`, with intents:
   - `change` (extended: it may name a step number). `applyFeedback` runs, then Remuse **speaks the `changes`** ("Got it. Step 2 now reads the views from Reach."), highlights the changed steps, and keeps listening.
   - `approve`: "Great, I'll try it once on your example." Practice starts (the existing `autoPractice` already runs after learning; review shows its result). Then teaching mode exits to the normal sidebar.
   - `run`, `schedule`: as today, plus a spoken confirmation.
   - `teach` ("let me show you again"): a new recording starts, as today.
   - `none`: ignored silently.
4. Buttons stay for everything: **Looks right**, **Show you again**, **Stop listening**, and a collapsed "Type instead" box (the existing textarea).
5. The mic closes after 2 quiet minutes, as today, and the screen says so.

**Speaking** uses `chrome.tts` in `background.js` (new `tts` permission). It works without a click in the page, which the shortcut path needs, and it gives an `end` event per line. Voice: "Google US English" if present, otherwise the first English voice. The sidebar asks the extension to speak with a new bridge message `speak { lines }` (add `speak`/`hush` to `ALLOWED` in `sidepanel.js`). The extension reports `speaking: { line }` in `status`.

**Turn-taking (half-duplex).** While Remuse speaks, the offscreen detector ignores sound, so Remuse doesn't hear itself. He can cut it off with the shortcut or the Stop listening button. Speaking over it on headphones is a stretch goal, not a requirement.

### 7.8 Drawing marks

- **Gesture:** while recording, drag with the **right mouse button** to draw. A right-drag longer than 20 px draws and suppresses the context menu. A plain right-click still opens the menu. **Alt+Shift+D** toggles a pen mode where the left button draws, for trackpads. *(My call on both gestures.)*
- **Overlay:** a full-viewport canvas in a closed shadow root, created only while a stroke is being drawn or the pen is on (`pointer-events: none` otherwise). The ink stays 1.5 s, then fades. The background takes the "before" screenshot while the ink is visible.
- **What's marked:** the stroke's bounding box is classified as a circle (closed, roughly round), an underline (flat) or a line. For a circle: elements mostly inside the box, smallest meaningful ones first. For an underline: the elements just above the line. At most 3 targets, through the existing `describe()`.
- **Canvas and charts** (no meaningful element inside, e.g. `canvas`, `svg`, Google Sheets cells): the server runs **SAM 3.1** (`sam()` in `meta.ts`) on the screenshot with a phrase from the utterance spoken during the mark, and keeps the box that overlaps the ink most. It is saved on the mark as `samBox` plus the phrase.
- Content scripts learn that recording is on through a broadcast from `background.js` (`{ type: "recording", on }` to all tabs on start and stop). Drawing does nothing when not recording.
- A mark becomes a card through the note-taker ("You marked: Views 2,607").

### 7.9 Shortcuts (`chrome.commands`)

- `teach`, **Alt+Shift+R**: start teaching (opens the side panel, then starts the recording), or stop it if one is running.
- `pen`, **Alt+Shift+D**: toggle the pen (only while recording).
- Both can be changed at `chrome://extensions/shortcuts`. The teaching screen shows the actual bound keys (`chrome.commands.getAll`).
- `chrome.sidePanel.open()` is allowed from a command handler (it counts as a user gesture).

### 7.10 Teaching mode (the sidebar screen)

When a recording starts, or a learning or review for it is in progress, `Remote` renders `TeachMode` **instead of** everything else: no task list, no Connected sites, no practice cards from other tasks.

```
┌──────────────────────────────┐
│ Remuse                   0:42│  small header, timer
│                              │
│            (orb)             │  Muse on top
│          Listening           │  ONE big state word
│                              │
│  "now open Analytics, I want │  last utterance, large (20px),
│   the views"                 │  fades in; "Hearing you…" while talking
│                              │
│  ─────────────────────────── │
│  1  Open YouTube Studio      │  cards, roomy, newest at bottom,
│     you clicked "Analytics"  │  each with its small evidence line
│  2  Read the views           │
│     you said "I want the views"
│  ?  Every video, or newest?  │  question card
│                              │
│ ┌──────────────────────────┐ │
│ │ ■ Stop   or say "I'm done"│ │  fixed bottom bar
│ │ Alt+Shift+R · Alt+Shift+D │ │  real bound keys
│ └──────────────────────────┘ │
└──────────────────────────────┘
```

States, each with its own big word: **Listening** (recording, quiet) · **Hearing you** (he's speaking) · **Got it, you're done** · **Thinking** (with the learning stage as the small line) · **Speaking** (readback; the spoken line highlighted) · **Listening for changes** (review mic open) · **Changing it** · **Practicing**.

Review layout: the same frame. The cards area becomes the numbered plan (steps, then rules, then questions), and the bottom bar becomes **Looks right** · **Show you again** · **Stop listening**, plus "Type instead". Tapping a step shows its evidence (the quote and the clicked or marked thing).

Visual direction: the existing tokens, orb and type scale. Much more space, one idea per row, nothing under 13 px in teaching mode.

## 8. Data and API changes (summary)

- Events: new `mark` kind. `point` is no longer produced.
- `sessions.cards` (TEXT JSON), saved at finish.
- Spec: `steps[].evidence`, optional `questions[]`.
- `POST /sessions/:id/heard?at=` (WAV) → `{ text, control }`. `/live` POST is removed. `GET /sessions/:id/live` → `{ turns, cards, hearing, thinking, error }`.
- `GET /sessions/:id/say` result adds `speak?: string[]` (what to say back).
- Extension: `commands` + `tts` permission; bridge messages `speak`, `hush`; `status` adds `speaking`, `hearing`; tab broadcast `recording`.

## 9. Order and cut line

1. **Grounding** (Nov 1): no hover, utterance capture, moments, cards + note-taker, evidence in the planner, checker. *This alone fixes "dumb and blind".*
2. **Teaching mode + voice end + shortcut** (Nov 2).
3. **Spoken review loop** (Nov 3 morning).
4. **Drawing marks** (Nov 3 afternoon).

If behind, cut in this order: SAM-on-canvas for marks → drawing entirely → speaking over Remuse. Never cut 1 or the approval gate.

## 10. How we know it works

Automated (no model calls, run with `node`):
- `moments()` groups actions with the right utterance, and makes silent moments.
- The end-phrase matcher: hits on "okay that's it", "tapos na", "proceed"; misses "I'm done with this tab", "that's it for the title".
- Evidence checker: an acting step with no evidence is dropped and becomes a question; one with a matching target is re-cited.
- Readback lines from a spec (steps, rules, questions, the over-8 case).
- A recorder test: a hover with no click produces no event.
- The existing e2e suites still pass on the isolated port (3299).

Live (James's acceptance, the same YouTube Studio task that failed):
- Hovering over things while talking adds no card and no step.
- Every step in review shows where it came from.
- "Okay, that's it" ends it. "I'm done with this tab" doesn't.
- Remuse reads the plan aloud. "No, step 2, use the Reach tab" changes step 2, and it says so.
- Alt+Shift+R starts teaching from any tab.
- Circling the views number makes a "You marked" card.

## 11. Calls I made (James can overrule any)

- `chrome.tts` in the extension instead of the page's speech API (works from the shortcut, no click needed). Default voice "Google US English".
- Hover pointing removed entirely, not just filtered.
- Right-drag to draw, Alt+Shift+D pen, Alt+Shift+R teach.
- The end-phrase list in 7.5.
- Whole-recording transcription kept for the final learning; live utterances for cards and the end phrase.
- Questions are shown silently during recording and spoken only in review, so Remuse never interrupts a demo.
- Half-duplex turn-taking.

## 12. Left to the builder

Exact prompts, card visuals within 7.10, loudness thresholds, the shape classifier's details, how `hearing` is relayed, file splits, and test layout.
