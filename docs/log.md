# Build log

## Thu Oct 29

- Built the three mock apps (`mock-apps/`, Next.js 16.4). One app, three sections, in-memory state, server actions for Refund / Replace / Send reply.
- Seed: 15 emails across all four rule paths plus two wrong-item emails outside the rules. `npm run check` re-applies the spoken rules to the seed and fails if any email's expected outcome disagrees.
- Store admin has a second layout (`POST /api/layout?v=v2`): different markup, labels ("Issue refund", "Ship a new one") and button positions. Built now because it was a few extra lines in the same pages.
- Attachments are hand-drawn SVGs, not photos. If the SAM 3.1 damage check struggles with drawings, swap in real photos of our own items.
- Dates render in Manila time; UTC put the replacement on the wrong day.
- Risk tests written (`scripts/risk-tests.mjs`, fixtures in `scripts/fixtures/`), not run yet: no `MODEL_API_KEY` on this machine.
- What the [Meta Model API docs](https://dev.meta.ai/docs/models) say before testing:
  - Base URL `https://api.meta.ai/v1`, key in `MODEL_API_KEY`, Responses / Chat Completions / Messages formats.
  - Muse Spark (`muse-spark-1.3`) takes `video/mp4` directly, plus up to 50 images per request. Risk 1 likely passes.
  - Muse Spark returns points and boxes on a 0-1000 grid, so the SAM fallback ("Spark boxes the element") is a supported feature.
  - SAM 3.1 (`sam-3.1`) takes a short noun phrase and returns boxes and masks as special-token text that needs parsing.
  - Muse Voice Transcribe (`muse-voice-transcribe-1.0`, `POST /v1/asr/transcribe`) takes WAV only (mono, 16-bit, 16 or 24 kHz), up to 10 min / 32 MB, with turn-level timestamps, not word-level. The extension's WebM/Opus audio has to be converted, and timing will be matched to events per spoken turn.
  - Muse Code has no model ID on the API. It is a coding product (subscription), not something the backend can call. The "Build" stage needs a decision: generate the rule functions with Muse Spark through the API, or use Muse Code as the tool we write the code with.
