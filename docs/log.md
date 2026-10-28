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
