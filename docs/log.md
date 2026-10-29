# Build log

## Thu Oct 29

- Built the three mock apps (`mock-apps/`, Next.js 16.4). One app, three sections, in-memory state, server actions for Refund / Replace / Send reply.
- Seed: 15 emails across all four rule paths plus two wrong-item emails outside the rules. `npm run check` re-applies the spoken rules to the seed and fails if any email's expected outcome disagrees.
- Store admin has a second layout (`POST /api/layout?v=v2`): different markup, labels ("Issue refund", "Ship a new one") and button positions. Built now because it was a few extra lines in the same pages.
- Attachments are hand-drawn SVGs, not photos. If the SAM 3.1 damage check struggles with drawings, swap in real photos of our own items.
- Dates render in Manila time; UTC put the replacement on the wrong day.
- Risk tests written (`scripts/risk-tests.mjs`, fixtures in `scripts/fixtures/`). Run with `node --env-file=.env scripts/risk-tests.mjs`; results below.
- What the [Meta Model API docs](https://dev.meta.ai/docs/models) say before testing:
  - Base URL `https://api.meta.ai/v1`, key in `MODEL_API_KEY`, Responses / Chat Completions / Messages formats.
  - Muse Spark (`muse-spark-1.3`) takes `video/mp4` directly, plus up to 50 images per request. Risk 1 likely passes.
  - Muse Spark returns points and boxes on a 0-1000 grid, so the SAM fallback ("Spark boxes the element") is a supported feature.
  - SAM 3.1 (`sam-3.1`) takes a short noun phrase and returns boxes and masks as special-token text that needs parsing.
  - Muse Voice Transcribe (`muse-voice-transcribe-1.0`, `POST /v1/asr/transcribe`) takes WAV only (mono, 16-bit, 16 or 24 kHz), up to 10 min / 32 MB, with turn-level timestamps, not word-level. The extension's WebM/Opus audio has to be converted, and timing will be matched to events per spoken turn.
  - Muse Code has no model ID on the API. It is a coding product (subscription), not something the backend can call.
- Decision: the Build stage uses Muse Spark through the API to write the rule and extraction functions. Spec doc updated to match.

### Risk test results (Oct 29)

| Risk | Result | Decision |
|---|---|---|
| 1. Video input | Works (8.5 s), but read the order date wrong: 2026-10-20 instead of 2026-10-23. Three key frames got every fact right in 4.0 s with fewer output tokens. | Understand stage sends key frames (one per DOM event) as the source of truth. Video optional, for context only. |
| 2. Finding UI elements | Muse Spark grounding hit the Replace button 3 of 3 times, within 1 grid unit of the DOM box. SAM 3.1 "button" returned 2 boxes; one is exactly the Replace button. SAM boxes are in **pixels** (`w=1440;h=900` in the token), not the 0-1000 grid. | Fallback = Muse Spark grounding first; SAM 3.1 for visual checks (damage in photos, "is the button there"). Parse SAM's `<|box;x1=..|>` tokens and divide by w/h. |
| 3. Latency | Spark grounding median 3.75 s (2.9-4.3 s). Worst case ~180 calls = ~11 min per 15-email batch. | Fine because DOM selectors come first; the model is the fallback and the step check, not every click. Run checks async where possible. |
| 4. Cost | 2.1k-5.7k tokens per Spark call, most of the output is reasoning tokens (~90%). SAM reports 0 tokens, 1 image. | Set a spend limit on the Billing page. Prices still to check against dev.meta.ai/docs/pricing-rate-limits. |
| Bonus: Transcribe | Works, 4.7 s for 14.8 s of audio, transcript exact. TTS narration with no pauses came back as one turn. | Real narration has pauses, so turns should split. If a turn spans several events, assign it to the events inside its time range. |

## Thu Oct 29 (cont.): recorder, ahead of plan

- Chrome MV3 extension (`extension/`, plain JS, no build step) + backend (`backend/`, Node 24 runs the TypeScript directly, built-in `node:sqlite`, no dependencies at runtime).
- Screenshots: `captureVisibleTab` on `pointerdown` (before the click lands) and ~900 ms after. Chrome allows ~2 captures/s, so they are queued.
- Typing: `change` only fires on blur, which comes after the next `pointerdown`, so the content script flushes the focused field's value first. Without this, the reply text showed up after the Send click.
- Voice: offscreen document + MediaRecorder, then decoded and resampled to 16 kHz mono WAV in the browser for Muse Voice Transcribe (no ffmpeg). Offscreen pages can't show the mic prompt, so a one-time `mic.html` tab grants it.
- Turn times are shifted by the audio start offset (~450 ms) onto the session clock, so a turn lines up with the clicks it describes.
- Next.js client navigation doesn't reload the content script; it polls `location.href` every 250 ms.
- `npm run test:recorder` passes: 19 events for the hero case, before/after frames correct (checked by eye: Replace button, then the "Replacement sent" banner), transcript exact.
- Chrome stable no longer loads unpacked extensions from the command line, so the test uses Playwright's Chromium (`channel: "chromium"`). Loading by hand in normal Chrome still works.

## Thu Oct 29 (cont.): whole pipeline, first full runs

- **Understand** (`backend/src/understand.ts`): one Muse Spark call with the event log, ~25 key frames and the transcript in time order. About 70 s and 40k tokens for the demo. First attempt left out the "go back to the order page" step and put "wrong item" in scope; two prompt rules fixed both (outcomes must navigate to the page they act on; scope is only what the person's rules cover, and asking is cheap).
- **Build** (`backend/src/build.ts`): Muse Spark writes extractors, computed values and `decide()` as one JS object, plus its own rule tests. We run it in `node:vm` and check it against the demo (same values read, same decision) and the tests. 15/15 and 16/16 checks on the first try in two builds; one repair round with the failures is wired in.
- **Run** (`backend/src/runner.ts`): Playwright, one browser, items one by one. Role + name first, then the recorded selector only if it still names the same thing, then Muse Spark grounding + SAM 3.1. Irreversible clicks (flagged by the spec and by a hard-coded word list, so the gate never depends on the model alone) wait for approval with the element outlined on a screenshot. Muse Spark looks at the screen after every irreversible step.
- Results on the 15 seeded emails (auto-approve, a script answering the questions):
  - Original layout: every email right. Mark (wrong item) was asked about; the answer was learned and Trisha (wrong item) was handled without asking.
  - Redesigned store layout: 14/15. Buttons and fields healed ("Replace" → "Ship a new one", "Replacement reason" → "Internal note", "Refund" → "Issue refund (₱…)"). The code extractors broke on the new labels ("Ordered on", "Courier ref"), so Muse Spark now reads values when code finds nothing. The miss: grounding said "not found" once for the note field; a second, looser look was added.
- Fixed along the way: values read before a client-side page finished rendering (now re-read for up to 4 s, then ask rather than guess); the on-screen check judging a server action before it re-rendered (wait for network idle, look twice); learned rules shifting rule numbers in the explanation.
- About 3 Muse Spark calls per email on the original layout (judge + photo, two screen checks), ~6 on the redesign. A 15-email run is ~43 calls, ~95 s of model time.
