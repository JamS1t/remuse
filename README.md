<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/colour/remuse-horizontal-gradient-on-dark.svg">
    <img alt="Remuse" src="brand/colour/remuse-horizontal-gradient-on-light.svg" height="56">
  </picture>
</h1>

Show it once, it does it forever, and it knows when to stop and ask.

Remuse learns a browser task by watching you do it once (screen, clicks, voice), turns it into an editable Task Spec, then repeats it on new items with a check after every step. Anything irreversible (pay, check out, send, refund, submit) waits for your approval.

It works on the sites you already use, with the logins you already have, and keeps working when Chrome is closed.

Built for the Meta developer hackathon, Indie Developer track. All code in this repo was written during the hackathon window, with Claude Code as a coding assistant.

## What it's for

Anything you do in a browser the same way again and again, on real sites:

- **Check numbers on a schedule.** Open YouTube Studio every hour, read a video's views, impressions and CTR, and tell you what changed.
- **Post the same thing everywhere.** Take the next video from a folder, upload it to X, TikTok and Instagram in three tabs with its caption, and wait for one OK before posting.
- **Move data between sites.** Read an invoice in one tab, type it into a sheet or tracker in another, then mark it done in the first.
- **Work through an inbox.** Read each email, look up the order, and refund, replace or reply by your rules. It asks you about anything your rules don't cover.
- **Shop or compare.** Search a store for each item on a list, open the top results, and pick the best by your rules.

You teach it by doing the task once and talking through why. There's nothing to code and no workflow builder.

## Two parts

- **Remuse Agent** (`backend/`): a small program on your PC that starts with Windows. It keeps your tasks and schedules, runs them in its own browser, and asks you through Windows notifications when it needs an OK. It runs whether Chrome is open or not.
- **Remuse in Chrome** (`extension/`): the Remuse button in the toolbar opens a sidebar:
  - **Watch me** records a task in any tab, voice included.
  - **Again** repeats a saved task now, or on a schedule.
  - **Connected sites** shares your existing login for the sites you choose with the Agent. It stays on your PC, so you never sign in twice.
  - Live progress and approval cards also show here. There's no chat: you teach it by showing it.

## How it works

1. **Record.** The extension captures every click and typed value, what you point at with the mouse while talking ("this number here"), a screenshot just before and just after each action, any WebMCP tools the page offers, and your voice. Muse Voice Transcribe turns the voice into timed text that lines up with the clicks.
2. **Understand.** Muse Spark reads the event log, the key frames and what you said, and writes a **Task Spec**:
   - **Where items come from:** a list on a page (emails, orders), or rows you paste each time (a shopping list).
   - **Steps:** what to do for each item.
   - **Values:** what to read on each page.
   - **Your rules:** in your own words.
   - **Outcomes:** what each decision does.
   - **Checks:** what the screen should look like after every step.
   - **Compare:** if you opened several results and picked one, a step that opens the top results, reads the same values on each and keeps the best.
3. **Review.** You check the spec and edit it if needed. Each save is a new version.
4. **Build.** Muse Spark writes the rules, the data extraction and the ranking as JavaScript. Remuse runs that code against your demo (it must read the same values and reach the same decision you did) plus tests Muse Spark writes for each rule. Dates, thresholds, prices per unit and rule order are computed in code, not guessed.
5. **Run.** The Agent repeats the task:
   - **Finding things:** it looks for elements by role and name first, then by the recorded selector. If the page was redesigned, Muse Spark finds the element on a screenshot, SAM 3.1 snaps the click to the exact element, and the spec is updated.
   - **WebMCP:** if the page offers the action as a WebMCP tool, Remuse calls the tool instead of clicking.
   - **Checks:** every step is checked against the page, and Muse Spark looks at the screen after every irreversible action.
   - **Approvals:** it stops for your OK before paying, checking out, sending and similar steps.
   - **Questions:** it asks when an item is outside your rules or a value can't be read. Your answer is remembered and saved into the next spec version.
   - **Your turn:** if a sign-in page, a captcha or a popup gets in the way, it hands the browser to you, then tries again.
   - **Tabs:** a task can span several tabs (an inbox and a sheet, a store and a tracker, one tab per site you post to). Each step knows its tab; the Agent keeps every tab open as it was left, follows tabs a site opens by itself, and carries values read in one tab into the others.
   - **Files:** it uploads from folders you allowed (the next file in line, the newest, or the one labelled with today's date and time), with the caption from a `.txt` file of the same name, never posting a file twice; downloads go into a folder you choose.

## Install (Windows)

Needs Node.js 24+ and Google Chrome.

1. Right-click `scripts\install-windows.ps1` and choose **Run with PowerShell**. It installs the Agent, makes it start with Windows, starts it, and opens `chrome://extensions`.
2. On that page, turn on **Developer mode**, click **Load unpacked** and pick the `extension` folder.
3. Click the Remuse icon in the Chrome toolbar. The first recording asks for the microphone once.

Model calls go through the Remuse proxy (`proxy/`, hosted at showrun.sitsit.dev), so there is no API key to set up. To use your own key instead, put `MODEL_API_KEY=...` in `.env` at the repo root.

For development: `cd backend && npm start` runs the Agent in a terminal (http://127.0.0.1:3200), and `HEADLESS=1` hides its browser. The full-page UI is a React + shadcn/ui app in `backend/web`; a built copy is committed in `backend/public`. After changing it, run `cd backend/web && npm install && npm run build`.

## Meta models

| Stage | Model | Job |
|---|---|---|
| Record | Muse Voice Transcribe | Voice to timed text |
| Understand | Muse Spark | Key frames + event log + transcript to a Task Spec |
| Build | Muse Spark | Writes the rules, extractors and ranking as tested JavaScript (Muse Code has no API) |
| Run | Muse Spark | Judges item kinds, checks photos, checks the screen after irreversible steps, reads values when the wording changed, finds elements on screenshots |
| Run | SAM 3.1 | Snaps a click to the exact element when the layout changed |

## Tests

| Command | What it checks |
|---|---|
| `cd backend && npm run test:recorder` | Loads the extension in Chromium, plays `scripts/fixtures/narration.wav` as the mic, clicks through a support case on the test sites and checks the recorded session |
| `cd backend && node test/sidepanel.check.ts` | The sidebar loads the Agent, and connecting a site shares its login with the Agent (disconnecting removes it) |
| `cd backend && node test/logins.check.ts` | A shared login reaches a real site from the Agent's browser; expired cookies are dropped |
| `cd backend && node test/folders.check.ts` | Which file an upload picks (next, newest, dated), captions, and that files never leave their folder |
| `cd backend && node test/files.e2e.ts` | A posting task uploads the next file with its caption, saves its download, never reposts, skips when nothing is new |
| `cd backend && node test/tabs.e2e.ts` | A task across three tabs: reads values in a tab the site opened, types them into another tab, returns to the first tab as it was left |
| `cd backend && node test/tabs-learn.e2e.ts <narration.wav>` | Records a three-tab demo through the extension, Muse Spark learns which step happens in which tab, and the run copies new data across tabs |
| `cd backend && node test/sheets.e2e.ts <narration.wav>` | A recording past 30 s keeps the whole voice track; pointing at something (no click) is recorded; typing in a spreadsheet grid is recorded with its cell; the runner writes a cell through the Name Box |
| `cd backend && node test/webmcp.check.ts` | A page's WebMCP tool is seen and called by the Agent's browser |
| `cd mock-apps && npm run check` | The test sites' data agrees with the spoken rules |
| `node --env-file=.env scripts/risk-tests.mjs` | The day-1 Meta API checks |

Some tests use **test sites** in `mock-apps/`: a made-up inbox, store admin (Kalye Goods) and courier tracker (Bilis Express), with invented people and orders. They exist so the hard cases (a redesigned page, an item outside the rules) can be checked the same way every time. Remuse itself doesn't need them. To run them: `cd mock-apps && npm install && npm run build && npm start` (http://localhost:3100). `POST /api/reset` re-seeds them and `POST /api/layout?v=v2` switches the store to a redesigned layout.

See [docs/log.md](docs/log.md) for what was tried and what happened.
