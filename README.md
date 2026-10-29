# Showrun

Show it once, it does it forever, and it knows when to stop and ask.

Showrun learns a browser task by watching you do it once (screen, clicks, voice), turns it into an editable Task Spec, then runs it on new inputs with a check after every step. Anything irreversible (refund, send, pay, submit) waits for your approval.

Built for the Meta developer hackathon, Indie Developer track. All code in this repo was written during the hackathon window.

## How it works

1. **Record.** A Chrome extension captures every click and typed value, a screenshot just before and just after each action, and your voice. Muse Voice Transcribe turns the voice into timed text that lines up with the clicks.
2. **Understand.** Muse Spark reads the event log, the key frames and what you said, and writes a **Task Spec**: the steps, the values to read on each page, your rules in your own words, what each decision does, and what the screen should look like after every step. Outcomes you didn't demonstrate are inferred from the screen and marked for review.
3. **Review.** You check the spec in the Showrun page and edit it if needed. Each save is a new version.
4. **Build.** Muse Spark writes the rules and the data extraction as JavaScript. Showrun runs that code against your demo (it must read the same values and reach the same decision you did) plus tests Muse Spark writes for each rule. Dates, thresholds and rule order are computed in code, not guessed.
5. **Run.** Playwright repeats the task on every item in the list:
   - Finds elements by role and name first, then the recorded selector. If the page was redesigned, Muse Spark finds the element on a screenshot, SAM 3.1 snaps the click to the exact element, and the spec is updated.
   - Reads values with the generated code; if the page wording changed, Muse Spark reads them instead.
   - Checks every step against the page, and has Muse Spark look at the screen after every irreversible action.
   - Stops for your approval before refund, replace, send and similar clicks.
   - Asks you when an item is outside the scope of your rules or a value can't be read, instead of guessing. Your answer is remembered for similar items in the same run and saved into the next spec version.

## Status

| Part | State |
|---|---|
| `mock-apps/`: Inbox, store admin, courier tracker | Done |
| `extension/`: Chrome recorder (clicks, typing, before/after screenshots, voice) | Done, end-to-end test passes |
| `backend/`: sessions, Understand, Build, runner, review and run UI | Done, first full runs pass (see log) |
| `scripts/risk-tests.mjs`: day-1 Meta API checks | Run, all pass |

## Run it

Needs Node 24+ and a Meta API key in `.env` at the repo root (`MODEL_API_KEY=...`, gitignored).

```bash
cd mock-apps && npm install && npm run build && npm start      # demo apps, http://localhost:3100
cd backend && npm install && npx playwright install chromium     # once
cd backend && npm start                                          # Showrun, http://127.0.0.1:3200
```

1. Open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick the `extension/` folder.
2. Click the Showrun icon, name the task, press **Start recording**. The first time, a tab asks for the microphone; allow it, then stop and start again.
3. Do the task once and say your rules out loud ("if the order is more than 30 days old, decline").
4. Press **Stop recording**, open http://127.0.0.1:3200, pick the recording and press **Write the Task Spec**.
5. Review it, press **Build the rules into code**, then **Run on the list**. The run opens a browser window you can watch; approvals and questions appear on the run page.

`HEADLESS=1 npm start` hides the browser window.

## Mock apps

Three fake apps in one Next.js project. All people, products, the store (Kalye Goods) and the courier (Bilis Express) are made up. State lives in memory.

| URL | What it is |
|---|---|
| `/inbox` | 15 customer emails, some with a photo attached |
| `/store` | Kalye Goods admin: orders, Refund / Replace |
| `/courier` | Bilis Express tracker: delivered, in transit, lost |
| `POST /api/reset` | Re-seed everything |
| `POST /api/layout?v=v2` | Switch the store admin to the redesigned layout (new labels, new positions) |
| `GET /api/state` | Full state plus the expected outcome per email, used to score runs |

The 15 emails split as 4 replace, 4 refund, 3 lost (refund and apologize), 2 decline (over 30 days, one with a damage photo) and 2 wrong-item emails the rules don't cover, so Showrun has to ask. `npm run check` confirms the seed matches the rules.

## Meta models

| Stage | Model | Job |
|---|---|---|
| Record | Muse Voice Transcribe | Voice to timed text |
| Understand | Muse Spark | Key frames + event log + transcript to a Task Spec |
| Build | Muse Spark | Writes the rules and extractors as tested JavaScript (Muse Code has no API) |
| Run | Muse Spark | Judges request type, checks photos for damage, checks the screen after irreversible steps, reads values when the wording changed, finds elements on screenshots |
| Run | SAM 3.1 | Snaps a click to the exact element when the layout changed |

## Tests

- `cd backend && npm run test:recorder`: loads the extension in Chromium, plays `scripts/fixtures/narration.wav` as the mic, clicks through the hero case on the mock apps and checks the recorded session.
- `cd mock-apps && npm run check`: the seed data agrees with the spoken rules.
- `node --env-file=.env scripts/risk-tests.mjs`: the day-1 Meta API checks.

See [docs/log.md](docs/log.md) for what was tried and what happened.
