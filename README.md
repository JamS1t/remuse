# Showrun

Show it once, it does it forever, and it knows when to stop and ask.

Showrun learns a browser task by watching you do it once (screen, clicks, voice), turns it into an editable Task Spec, then runs it on new inputs with a check after every step. Anything irreversible (refund, send, pay, submit) waits for your approval.

Built for the Meta developer hackathon, Indie Developer track. All code in this repo was written during the hackathon window.

## Status

| Part | State |
|---|---|
| `mock-apps/`: Inbox, store admin, courier tracker | Done |
| Chrome extension recorder | Not started |
| Backend (Node + SQLite) | Not started |
| Playwright runner | Not started |
| `scripts/risk-tests.mjs`: day-1 Meta API checks | Run, all pass (see log) |

## Mock apps

Three fake apps in one Next.js project. All people, products, the store (Kalye Goods) and the courier (Bilis Express) are made up. State lives in memory.

```bash
cd mock-apps
npm install
npm run build && npm start   # http://localhost:3100
npm run check                # seed matches the demo's decision rules
```

| URL | What it is |
|---|---|
| `/inbox` | 15 customer emails, some with a photo attached |
| `/store` | Kalye Goods admin: orders, Refund / Replace |
| `/courier` | Bilis Express tracker: delivered, in transit, lost |
| `POST /api/reset` | Re-seed everything |
| `POST /api/layout?v=v2` | Switch the store admin to the redesigned layout (curveball 2) |
| `GET /api/state` | Full state plus the expected outcome per email, for scoring runs |

The 15 emails split as 4 replace, 4 refund, 3 lost (refund and apologize), 2 decline (over 30 days, one with a damage photo) and 2 wrong-item emails the rules don't cover, so Showrun has to ask.

## Meta models

| Stage | Model | Job |
|---|---|---|
| Record | Muse Voice Transcribe | Voice to timestamped text |
| Understand | Muse Spark | Key frames + event log + transcript to a Task Spec |
| Build | Muse Spark | Writes the decision rules and data extraction as real functions (Muse Code has no API) |
| Run | SAM 3.1 + Muse Spark | Find elements on screen when DOM selectors fail |

See [docs/log.md](docs/log.md) for what was tried and what happened.
