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

Each task shows an estimate of the time it has saved you: every item Remuse really did something for (each counted once a day), times how long your demo took (talking included, capped at 15 minutes). The task list adds them up ("By an estimate, Remuse has saved you about 3 h so far"). Want to try it on one of your own tasks? [docs/try-it.md](docs/try-it.md) takes about 15 minutes, and there's a short form to tell us how it went.

## Two parts

- **Remuse Agent** (`backend/`): a small program on your PC that starts with Windows. It keeps your tasks and schedules, runs them in its own browser, and asks you through Windows notifications when it needs an OK. It runs whether Chrome is open or not.
- **Remuse in Chrome** (`extension/`): runs your tasks in your own Chrome, with the logins you already have (nothing is copied). Its tabs open in a window of their own that doesn't take focus, and Chrome keeps running in the background after you close it so schedules still run. When Chrome is fully quit, the Agent uses its own browser. The Remuse button in the toolbar opens a sidebar:
  - **Watch me** records a task in any tab, voice included.
  - **Again** repeats a saved task now, or on a schedule.
  - **Connected sites** shares your existing login for the sites you choose with the Agent. It stays on your PC, so you never sign in twice.
  - Live progress and approval cards also show here. There's no chat: you teach it by showing it.

## How it works

1. **Record.** The extension captures every click and typed value, what you point at with the mouse while talking ("this number here"), a screenshot just before and just after each action, any WebMCP tools the page offers, and your voice. Muse Voice Transcribe turns the voice into timed text that lines up with the clicks.
1b. **Follow along.** While you record, your voice goes to the Agent every few seconds: Muse Voice Transcribe hears it and Muse Spark keeps a live draft of the task in the sidebar ("I heard…", the steps so far, and a question if something is unclear, which you answer out loud). After you stop, the same card shows it checking its work, then **Looks right** or "Something's off? Tell me" right there, just by saying it: the sidebar keeps listening hands-free and works out whether you're correcting it, approving it, asking for a schedule or a run, starting to teach again, or not talking to it.
2. **Understand.** Muse Spark reads the event log, the key frames and what you said, and writes a **Task Spec**:
   - **Where items come from:** a list on a page (emails, orders), or rows you paste each time (a shopping list).
   - **Steps:** what to do for each item.
   - **Values:** what to read on each page.
   - **Your rules:** in your own words.
   - **Outcomes:** what each decision does.
   - **Checks:** what the screen should look like after every step.
   - **Compare:** if you opened several results and picked one, a step that opens the top results, reads the same values on each and keeps the best.
3. **Review.** You check what it will do. If something's off, say so in your own words on the task page ("the views should come from the Reach tab"): Muse Spark changes just that, tells you what it changed, and the rules are rebuilt and checked. Each change is a new version.
4. **Build.** Muse Spark writes the rules, the data extraction and the ranking as JavaScript. Remuse runs that code against your demo (it must read the same values and reach the same decision you did) plus tests Muse Spark writes for each rule. Dates, thresholds, prices per unit and rule order are computed in code, not guessed.
4b. **Practice.** Then, without being asked, it tries the task once on your own example (the very email or order you used), hidden, and stops before anything it would send, pay or submit. The sidebar says how that went against what you did: "Read the same 2 values you saw · Chose to refund, like you did · Stopped before 'send the reply'", or exactly what didn't match. It practices again after every change you ask for. A practice never waits on you, sends notifications or uses up files, and gives way the moment a real run starts.
5. **Run.** The Agent repeats the task:
   - **Plan first:** when you start a run on several items, it first opens and reads every one and decides what it would do, asking its questions right then while you're there. Then it shows the plan ("2 refund · 1 decline", each with its reason) and does nothing until you press **Go**. Go still asks before each send or payment; **Approve all and go** doesn't. Acting reuses what it read, so nothing is read or judged twice, but it checks each item is still the one it planned: if a value changed meanwhile it decides again, carrying on when the decision is the same and leaving the item alone (and saying why) when it isn't; posts opened by position are left alone if the list moved. Scheduled runs and runs you chose to do without asking skip the plan.
   - **Finding things:** it looks for elements by role and name first, then by the recorded selector. If the page was redesigned, Muse Spark finds the element on a screenshot, SAM 3.1 snaps the click to the exact element, and the spec is updated. The step keeps that screenshot with the boxes drawn on it: every element SAM 3.1 outlined, where Muse Spark pointed, and the one it used.
   - **WebMCP:** if the page offers the action as a WebMCP tool, Remuse calls the tool instead of clicking.
   - **Checks, with reasons:** every step is checked against the page, and Muse Spark looks at the screen after every irreversible action. Each step says why it counts as done, in plain words, and how it knows ("Checked on the page: the field now holds 'Refund 500'", "Looked at the screen: the page says Refunded"), next to a close-up of what it acted on. A decision lists the values it read. The sidebar shows the last few steps live while it works. When nothing on the page could confirm a step, it says so instead of claiming a check.
   - **Approvals:** it stops for your OK before paying, checking out, sending (including pressing Enter to send in a chat box) and similar steps.
   - **Questions:** it asks when an item is outside your rules or a value can't be read. Your answer is remembered and saved into the next spec version.
   - **Signing in:** if a run (hidden or not) lands on a sign-in page, it pauses, opens that page in a plain Chrome window on its own profile and notifies you. You sign in once and close the window; it reopens every tab where it was and carries on. Google sites are signed into this way, never by copying your login.
   - **Your turn:** if a captcha or a popup gets in the way, it hands the browser to you, then tries again.
   - **Tabs:** a task can span several tabs (an inbox and a sheet, a store and a tracker, one tab per site you post to). Each step knows its tab; the Agent keeps every tab open as it was left, follows tabs a site opens by itself, and carries values read in one tab into the others.
   - **Files:** it uploads from folders you allowed (the next file in line, the newest, or the one labelled with today's date and time), with the caption from a `.txt` file of the same name, never posting a file twice; downloads go into a folder you choose. A task that posts files can also run by itself **whenever a new file lands** in its folder (a schedule kind next to "every few hours" and "on days"): a file is posted once it has sat still for 10 seconds (so one still copying waits), a batch dropped at once is posted one after another, and files that arrived while the Agent was off are caught up when it starts.
   - **Only what's new:** a list task remembers each item it handled (saved as each one finishes, so after a crash only the one in progress could be repeated), and the next run, by hand or on a schedule, only does new ones: an hourly inbox task answers each email once. One you said no to stays settled. A scheduled run with nothing new stays quiet. **Do them again** and **Start fresh** are there when you want them.

## Install (Windows)

Needs Node.js 24+ and Google Chrome.

1. Right-click `scripts\install-windows.ps1` and choose **Run with PowerShell**. It installs the Agent, makes it start with Windows, starts it, and opens `chrome://extensions`.
2. On that page, turn on **Developer mode**, click **Load unpacked** and pick the `extension` folder.
3. Click the Remuse icon in the Chrome toolbar. The first recording asks for the microphone once.

Model calls go through the Remuse proxy (`proxy/`, hosted at showrun.sitsit.dev), so there is no API key to set up. To use your own key instead, put `MODEL_API_KEY=...` in `.env` at the repo root.

For development: `cd backend && npm start` runs the Agent in a terminal (http://127.0.0.1:3200), and `HEADLESS=1` hides its browser. The full-page UI is a React + shadcn/ui app in `backend/web`; a built copy is committed in `backend/public`. After changing it, run `cd backend/web && npm install && npm run build`.

## How well it works

Measured on the test sites with `node backend/test/eval.ts` (full write-up, every email, in [docs/eval.md](docs/eval.md)). Remuse learned the task from **one** recorded demo: one customer complaint handled across an inbox, a store admin and a courier tracker, with the rules said out loud. It then handled all 15 complaints by itself, without stopping for approvals, so a wrong decision would really have acted:

| | Store as recorded | Store redesigned (new labels, new layout) |
|---|---|---|
| Right decisions | **15 / 15** | **15 / 15** |
| Decided by itself (by your rules), and right | 9 / 9 | 9 / 9 |
| Wrong irreversible actions (by its own record) | **0** | **0** |
| Asked you | 3 (1 a request its rules weren't about) | 3 |
| Reused your answer instead of asking again | 3 | 3 |
| Buttons and fields found again after the redesign | – | 6 |
| Time per email | 14 s | 28 s |

Your answers were given the way a person would, so the emails it asked about count as right; "decided by itself" is the honest number for what it did alone. The evaluation found bugs, now fixed: an answer you gave for one kind of request could override your other rules, a kind check ran before your own rules, a photo that couldn't be captured counted as "no damage", and a moved button could be confused with its neighbour. These numbers were measured just before the last two of those fixes; `eval.ts` now also checks the store itself (order status and reply) after each run.

## Meta models

| Stage | Model | Job |
|---|---|---|
| Record | Muse Voice Transcribe | Voice to timed text |
| Understand | Muse Spark | Key frames + event log + transcript to a Task Spec |
| Build | Muse Spark | Writes the rules, extractors and ranking as tested JavaScript (Muse Code has no API) |
| Run | Muse Spark | Judges item kinds, checks photos, checks the screen after irreversible steps, reads values when the wording changed, finds elements on screenshots |
| Run | SAM 3.1 | Snaps a click to the exact element when the layout changed |
| Check | Muse Spark Open (open weights, `meta-models/muse-spark-open-1026`) | The independent checker: before anything irreversible that rests on a judgement ("is this item damaged?"), it answers the same question on its own, and Remuse asks you if the two models disagree; after an irreversible step, it looks at the screen to confirm it worked |

**The second model.** Muse Spark does the work, and a different model checks it, the "verifiable agent" pattern. The checker never sees the first model's answer or reasoning, only the same page text and photos. With a partner key the checker is Muse Spark Open, Meta's open-weight model, served by Baseten (put `OPEN_MODEL_KEY=...` or `BASETEN_API_KEY=...` in `.env`; for Modal or Fireworks also set `OPEN_MODEL_URL` to their OpenAI-style endpoint). The run page then says "checked by Muse Spark Open", and each checked step names it. Without a key there is no second opinion, because the same model asking itself again proves nothing, and Muse Spark checks the screen as before. If the checker can't be reached, a run carries on: it notes "no second opinion this time", and Muse Spark checks the screen. Note that with a partner key, the page text and screenshots of checked steps are sent to that partner. `node --env-file-if-exists=../.env test/open.check.ts` checks the checker for real: it must tell a refunded screen from a failed one.

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
| `cd backend && node test/sheets.e2e.ts <narration.wav>` | While recording, the voice is heard in pieces and a live draft of the task exists before you stop; a recording past 30 s keeps the whole voice track; pointing at something (no click) is recorded; typing in a spreadsheet grid is recorded with its cell; the runner writes a cell through the Name Box |
| `cd backend && node test/signin.e2e.ts` | A hidden run that hits a sign-in page pauses, opens it in plain Chrome for you, then carries on where it was |
| `cd backend && node test/clicklist.e2e.ts` | A list whose items open by clicking, not links (forum posts, cards): found by role, each opened and read; planned first, and if the list moves before Go, only posts still in their place are done |
| `cd backend && node test/chrome.e2e.ts` | With the extension linked, a run happens in your own Chrome: uses its existing login, follows a tab the site opens, closes its tabs after |
| `cd backend && node test/feedback.e2e.ts` | Feedback in plain words updates a task: only what was asked changes, you're told what changed, the rules are rebuilt, and a practice of the changed task follows by itself |
| `cd backend && node test/eval.ts [--relearn]` | The evaluation above: learns the hero task once from a recorded demo (kept in `docs/eval/hero-task.json`), runs all 15 emails on both store layouts, writes `docs/eval.md`. Needs the test sites; uses real model calls |
| `cd backend && node test/decide.e2e.ts` | The order Remuse decides in: your rules first (an old order is declined whatever kind it is), a kind your rules weren't about is asked only when it would fall to "otherwise", and your answer is reused for that kind but never over your other rules |
| `cd backend && node test/second.e2e.ts` | The second model: with a partner key, Muse Spark Open answers the same judgement on its own before an irreversible act (agrees → carries on; disagrees → asks you, even in a run started without asking), checks the screen after, gets exactly the same prompt and photo over Chat Completions with the partner key (which goes nowhere else); no key → no second opinion; partner down → the run finishes and says so |
| `cd backend && node --env-file-if-exists=../.env test/open.check.ts` | The checker model for real: a refunded screen gives ok, a failed one doesn't |
| `cd backend && node test/reasons.e2e.ts [out.png]` | On a redesigned store: every step carries its reason and how it was checked, typing shows what the field now holds, the decision lists what it read, finding the moved button keeps the marked-up screenshot (Muse Spark + SAM 3.1), and a picture never leaks to the next item |
| `cd backend && node test/plan.e2e.ts` | Plan first: questions come while it looks, the plan shows what it will do with each item and why, nothing is sent before Go, acting doesn't read or judge again, Cancel does nothing, Approve all runs through |
| `cd backend && node test/handled.e2e.ts` | A list task does each item once: the next run finds nothing new, a new email is the only one done, each one is remembered as soon as it's done, one you said no to isn't asked again, Do them again and Start fresh work, a practice still uses your example; a new file in a watched folder starts the task by itself and posts each file once |
| `cd backend && node test/practice.e2e.ts` | The practice after learning: finds the very item from the demo (even when items differ only by `?id=`), reads the same values, makes the same choice, stops before sending (a button or Enter in a chat box), flags what doesn't match, never waits on you, and gives way to a real run |
| `cd backend && node test/converse.e2e.ts <voice.wav>` | Hands-free: after learning, the sidebar listens by itself; a spoken correction is cut out by its pauses, heard, understood as a change and applied with no button; other phrases are sorted (approve, schedule, run, teach again, not meant for Remuse) |
| `cd backend && node test/webmcp.check.ts` | A page's WebMCP tool is seen and called by the Agent's browser |
| `cd mock-apps && npm run check` | The test sites' data agrees with the spoken rules |
| `node --env-file=.env scripts/risk-tests.mjs` | The day-1 Meta API checks |

Some tests use **test sites** in `mock-apps/`: a made-up inbox, store admin (Kalye Goods) and courier tracker (Bilis Express), with invented people and orders. They exist so the hard cases (a redesigned page, an item outside the rules) can be checked the same way every time. Remuse itself doesn't need them. To run them: `cd mock-apps && npm install && npm run build && npm start` (http://localhost:3100). `POST /api/reset` re-seeds them and `POST /api/layout?v=v2` switches the store to a redesigned layout.

See [docs/log.md](docs/log.md) for what was tried and what happened.
