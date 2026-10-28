# Build log

## Thu Oct 29

- Built the three mock apps (`mock-apps/`, Next.js 16.4). One app, three sections, in-memory state, server actions for Refund / Replace / Send reply.
- Seed: 15 emails across all four rule paths plus two wrong-item emails outside the rules. `npm run check` re-applies the spoken rules to the seed and fails if any email's expected outcome disagrees.
- Store admin has a second layout (`POST /api/layout?v=v2`): different markup, labels ("Issue refund", "Ship a new one") and button positions. Built now because it was a few extra lines in the same pages.
- Attachments are hand-drawn SVGs, not photos. If the SAM 3.1 damage check struggles with drawings, swap in real photos of our own items.
- Dates render in Manila time; UTC put the replacement on the wrong day.
- Risk tests (video input, SAM 3.1 on UI screenshots, latency per call, credit burn): blocked, no Meta API key on this machine yet.
