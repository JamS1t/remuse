# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Local web UI served by the Showrun backend (Node 24, `backend/src/server.ts`, 127.0.0.1:3200). User chose Vite + React + Tailwind + shadcn/ui for the UI (2026-10-29), replacing the plain HTML + `app.js` version.

## Users

Primary: an ops person at a small online store, not a developer. They repeat the same browser task every day (reading customer emails, then refunding, replacing or declining orders) and want it off their plate. They keep the final say on anything irreversible.

Secondary audience: hackathon judges watching a 3-minute demo video.

## Product Purpose

Showrun learns a browser task from one recorded demo (screen, clicks, voice), turns it into an editable Task Spec, builds the rules into tested code, and runs it on new items. It checks after every step, asks when an item is outside the rules, and waits for approval before any refund, send, pay or submit. Success means the user records once and then only approves and answers questions.

## Positioning

Show it once, it does it forever, and it knows when to stop and ask. Unlike scripted RPA or a free-roaming browser agent, Showrun:
- learns rules from the user's spoken words;
- computes decisions in tested code, not by guessing;
- gates every irreversible action behind approval;
- heals itself when the page layout changes, and records each heal as a new spec version.

## Operating Context

- **Recording:** a Chrome extension records the demo. The user then opens the Showrun page to write the Task Spec, review it, build it, and run it.
- **During a run:** the Showrun page sits on half the screen (about 960px) beside the Playwright browser window it drives. Approvals and questions appear on the run page.
- **Demo:** three mock apps (Inbox, Kalye Goods store admin, Bilis Express courier) at localhost:3100.

## Capabilities and Constraints

- **Pages:**
  - Home: recordings and specs.
  - Session: the recording, with a timeline of events, screenshots and voice.
  - Spec: review and edit, versioned, with Build.
  - Run: an item list with a log, before/after screenshots, pending approvals and asks, and a score.
- **Terms:** Task Spec, step, rule, outcome, approval gate, ask, heal, learned answer, spec version.
- **Meta models:** Muse Spark, SAM 3.1 and Muse Voice Transcribe. Real Meta model use is a hackathon pass/fail check.
- **Machine:** the development machine is low on memory, so keep the build and runtime light.

## Brand Commitments

- Name: Showrun. Tagline: "Show it once, it does it forever, and it knows when to stop and ask."
- The user requires a professional, real-product look with no AI-slop tropes:
  - no status pills with indicator dots;
  - no vertical accent bars marking active or heading;
  - no gradients or decorative glow.
- No real company logos and no real customer data. Only made-up mock data.

## Evidence on Hand

- Real recorded fixture session and spec versions 1–6 in `backend/data/` (gitignored).
- Run results: v1 layout 15/15 correct; spec 6 passed 16/16 checks.
- Do not fabricate users, testimonials, metrics or customers.

## Product Principles

- The human approves anything irreversible. The gate is never hidden or skippable in the UI.
- Show evidence, not claims: screenshots and checks back every outcome.
- Ask instead of guess, and make the question fast to answer.
- Plain language for a non-developer. JSON and code are available but secondary.
