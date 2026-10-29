---
version: 1
slug: "backend-web"
primary_target: "backend/web"
related_targets: ["backend/public"]
---

## Scope

Showrun local web UI, `backend/web` (built into `backend/public`). The pages are Recordings (home), Recording detail, Task Spec, and Run. Mode: Operate.

## Audience and job

A small-shop ops person, not a developer. They:
- review the Task Spec Showrun wrote from their demo;
- build it and start a run;
- then sit half-screen (about 960px) beside the Playwright window, approving irreversible steps and answering questions.

Success: they always know what is running, what is waiting on them, and why each decision was made, with screenshot evidence.

## Constraints

- Standard shadcn/Radix controls throughout.
- None of these: status pills with dots, vertical accent bars for active or heading items, gradients, glow, or emoji.
- Keep plain English labels. No broadcast jargon in the UI copy.
- Light build on a low-memory machine.

## Direction contract

THESIS: A run is a live rundown. Items go in order, each has a time drawn to scale, and nothing irreversible goes out without the user's cue. The category default is a generic dashboard: a grey card grid with status pills and a sidebar. This direction refuses it.

OWN-WORLD:
- **Ground and ink:** paper-white ground #FBFBF9, ink #17181B, warm hairlines #E4E2DC.
- **Tally red #D7372B** means "live now" and nothing else.
- **Revision colors:** each spec version takes a script revision color: White, Blue #DCE7F7, Pink #F7DEE3, Yellow #F6EFC4, Green #DDEFD9, Goldenrod #F1DDB0. The color tints the whole spec sheet header and the version swatches. Changed lines carry a revision asterisk in the right margin.
- **Type:** Geist for the UI, Geist Mono for timecodes and counts. The user's own spoken words are set in Courier Prime, like script dialogue.
- **Rules:** status is a glyph plus a word, never hue alone. One strict 4px grid.

STORY: The user sees what Showrun learned, in their own words, then checks it, builds it and runs it. During the run they see each item's outcome and the reason for it, and they give the cue on every refund or send.

FIRST VIEWPORT (Run page, 960px):
- **Top bar:** wordmark, then Recordings and Runs.
- **Header row:** run title, a status word with its glyph, a done count, the score, and Stop.
- **Left (about 400px):** the rundown table. Columns: No., item, outcome, time. The time is drawn as a bar on one shared scale, and the live row's bar grows in tally red.
- **Right:** the selected item's decision, reason, log and before/after screens. When approval is needed, a "Waiting for your OK" card owns the right column: a large screenshot, then Approve (A), Approve all remaining, and Skip (R).

FORM: Run of Show (TV rundown sheet with colored script revisions). It was #6 on the ordered list, the assigned direction. Seed key 61f78284.

RAISES:
- **From the Labanotation score:** durations are drawn to exact scale.
- **From the vertical feed:** a pending approval owns the work area, with keyboard cues.
- **From the emission-line rail:** status never relies on hue alone.
- **From the Crouwel grid:** one strict grid.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

DECISION (finish review): the rundown keeps outcome as a second line under the item, column header "Item and outcome", because at the 960 half-screen the rundown is about 420px and a fourth column would truncate both the name and the outcome.
