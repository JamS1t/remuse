---
name: Remuse
description: A local operator console where a recorded task plays back as a live rundown, cued by the user.
colors:
  paper-ground: "#fbfbf9"
  sheet-white: "#ffffff"
  ink: "#17181b"
  quiet-ink: "#5f5e58"
  wash: "#f2f1ec"
  hairline: "#e4e2dc"
  row-rule: "#efede8"
  field-stroke: "#d9d6cf"
  tally-red: "#d7372b"
  fault-red: "#b4231a"
  pass-green: "#1d7038"
  caution-amber: "#8a5300"
  rev-white: "#ffffff"
  rev-blue: "#dce7f7"
  rev-pink: "#f7dee3"
  rev-yellow: "#f6efc4"
  rev-green: "#ddefd9"
  rev-goldenrod: "#f1ddb0"
typography:
  display:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.012em"
  headline:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "-0.012em"
  title:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "\"ss01\", \"cv11\""
  label:
    fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.5
  mono:
    fontFamily: "Geist Mono Variable, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "\"tnum\""
  mono-figure:
    fontFamily: "Geist Mono Variable, ui-monospace, monospace"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.25
  script:
    fontFamily: "Courier Prime, Courier New, monospace"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.375
rounded:
  sm: "3px"
  md: "5px"
  lg: "7px"
  xl: "10px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  section: "40px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper-ground}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "32px"
  button-primary-large:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper-ground}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "36px"
  button-outline:
    backgroundColor: "{colors.paper-ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "32px"
  button-outline-hover:
    backgroundColor: "{colors.wash}"
  button-ghost:
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "32px"
  button-ghost-hover:
    backgroundColor: "{colors.wash}"
  input:
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "4px 10px"
    height: "32px"
  kbd:
    backgroundColor: "{colors.wash}"
    textColor: "{colors.quiet-ink}"
    rounded: "{rounded.sm}"
    padding: "0 4px"
    height: "20px"
  nav-link:
    textColor: "{colors.quiet-ink}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
  nav-link-active:
    backgroundColor: "{colors.wash}"
    textColor: "{colors.ink}"
  sheet:
    backgroundColor: "{colors.sheet-white}"
    rounded: "{rounded.lg}"
    padding: "0 16px"
  rundown-row:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: "10px 12px"
  rundown-row-selected:
    backgroundColor: "{colors.wash}"
  cue-card-head:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper-ground}"
    padding: "10px 16px"
  revision-chip:
    textColor: "{colors.ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.md}"
    padding: "2px 6px"
---

# Design System: Remuse

## Overview

**Creative North Star: "The Run of Show"**

Showrun is a TV rundown sheet for office work. A run is a list of items in order. Each item has a number, an outcome and a time drawn to scale, and nothing irreversible goes out until the user gives the cue. The sheet is paper-white with ink type and warm hairline rules. One red, the studio tally light, marks what is live right now. Each Task Spec version takes a colour from the script revision sequence (White, Blue, Pink, Yellow, Green, Goldenrod), and changed lines carry an asterisk in the right margin, the way a revised script page does.

The density is a working document's: 14px body, tight rows split by faint rules, numbers and timecodes in mono so columns line up. Hierarchy comes from weight, mono against sans, and the ink-on-paper inversion of the cue card. Accent colour plays almost no part. The surface sits half-screen (about 960px) beside a browser window, so the layout puts the rundown and the current cue side by side and stacks them on narrow screens with the cue on top.

The world refuses the generic dashboard: no grey card grid, no status pills with dots, no sidebar, no vertical accent bars, no gradients, no glow, no emoji. It is light only, made to sit beside the light mock apps.

**Key Characteristics:**
- Paper ground, ink type, warm hairlines; flat sheets with 1px borders.
- Tally red means live now and appears nowhere else in the UI.
- Spec versions are named and tinted with script revision colours.
- Durations are drawn as bars on one shared scale.
- Status is always a glyph plus a word.
- The user's own spoken words are set in Courier Prime, like script dialogue.
- A pending approval is an inverted ink-headed cue card that takes over the work column.

## Colors

A near-neutral warm paper palette, one live signal red, three quiet state inks, and a six-step pastel revision sequence.

### Primary
- **Ink** (ink): every primary action fill, the heading of the cue card, rundown duration bars (at 75%), the selection outline, focus outlines, and the frame of the mark. In this world, "primary" is ink, not a hue.

### Secondary
- **Tally Red** (tally-red): live now, and nothing else. Used for the live rundown row's growing bar and its timecode, the Running/Starting status, and the play cue inside the Showrun mark.

### Tertiary
- **Revision Sequence** (rev-white, rev-blue, rev-pink, rev-yellow, rev-green, rev-goldenrod): one colour per Task Spec version, cycling. It tints the full-bleed spec sheet header and fills the small version swatch. Rev Yellow also serves as the text-selection highlight.

### Neutral
- **Paper Ground** (paper-ground): page background, top bar (at 95% with a 2px blur), and outline-button fill.
- **Sheet White** (sheet-white): sheets, tables, cards and screenshot captions sitting on the ground.
- **Wash** (wash): selected rows, active nav link, hover on ghost and outline controls, the rundown header (at 50%), screenshot wells, loading skeletons, and kbd keys.
- **Quiet Ink** (quiet-ink): secondary text, column headers, timecodes, line numbers, and the Waiting/Skipped/Stopped states.
- **Hairline** (hairline): every component border and the top-bar divider.
- **Row Rule** (row-rule): the fainter divider between rows inside a sheet.
- **Field Stroke** (field-stroke): input and textarea borders.
- **Pass Green** (pass-green), **Caution Amber** (caution-amber), **Fault Red** (fault-red): Done/checks pass, healed or inferred warnings, and Failed/errors. They always come with a glyph and a word.

### Named Rules
**The Tally Rule.** Tally red marks the live item and only that; its one fixed home outside a run is the play cue in the mark. It never marks an error, a link, a hover or emphasis. Errors use Fault Red, a different and deeper hue.

**The Revision Rule.** A spec version is always shown as swatch + `vN` in mono + its revision name ("v3 Pink"). Revision colours tint paper. They never fill buttons or text.

**The Glyph-and-Word Rule.** A status never relies on hue alone. Each state pairs a 14px stroke icon with a 13px medium word. When the word is dropped for space, it stays in the DOM for screen readers.

## Typography

**Display Font:** Geist Variable (with ui-sans-serif, system-ui)
**Label/Mono Font:** Geist Mono Variable (with ui-monospace)
**Script Font:** Courier Prime (with Courier New)

**Character:** Geist sets the working sheet: neutral, tight, with the `ss01`/`cv11` alternates on. Geist Mono is the stopwatch, carrying every number that might be compared down a column. Courier Prime appears only when quoting the user, so their speech reads as dialogue on a script page.

### Hierarchy
- **Display** (600, 22px, ~1.25): page titles (Recordings, Runs, the run's date, the spec goal). Headings balance-wrap at -0.012em.
- **Headline** (600, 15px): section titles, the selected item's name, outcome names, and the wordmark (at -0.02em).
- **Title** (600, 13px): sub-sections inside a column ("Screens checked", "Step by step", "Changed during this run") and form labels in the cue card.
- **Body** (400, 14px, 1.5): everything else. Long prose stops at 68–72ch.
- **Label** (400–500, 12–13px): metadata lines, captions and column headers in Quiet Ink. Status words are 13px medium.
- **Mono** (400, 11.5–13px, tabular): timecodes, line numbers, counts, version numbers, variable names, typed values, and trailing dates in item labels (at 0.92em).
- **Mono Figure** (600, 22px): the score ("14 / 15"), with the denominator in Quiet Ink.
- **Script** (400, 13.5px, 1.375): the user's own words, in curly quotes, at 85% ink.

### Named Rules
**The Stopwatch Rule.** A number that can be compared or counted is set in Geist Mono. Tables also turn on tabular figures.

**The Dialogue Rule.** Courier Prime is only for words the user actually spoke. Never use it for system text, headings or decoration.

## Layout

Content sits in one centred column, at most 1240px wide, with 20px side padding (16px for the top bar on small screens), 24px top and 80px bottom. A sticky 48px top bar holds the mark, wordmark, two nav links and a right-aligned "Demo apps" menu. Sections are 40px apart. Inside a sheet the rhythm is 4px-based (4, 8, 12, 16, 24). Dense rows (rundown, step lists, checks) use 10px vertical padding, and inline gaps of 6px are common.

The Run page is two columns from 900px: the rundown at 340–420px (fixed at 460px from 1280px) and the work column taking the rest, 24px apart. Below 900px they stack with the work column (cue card, item detail) first. The rundown row is a fixed three-track grid: 32px number, flexible "Item and outcome", and a 104px time track with the bar above its timecode. Outcome sits as a second line under the item name and does not get its own column, so neither truncates at the 960 half-screen width.

The Task Spec page opens with a full-bleed header tinted with the version's revision colour, then a line-variant tab strip. Spec content uses numbered sheets with a 28px number gutter and a 16px right margin for the revision asterisk. The steps tab adds a 320px aside from 1024px.

## Elevation & Depth

The system is flat. Depth comes from paper tone (Sheet White on Paper Ground), 1px hairline borders and the Wash fill for selection. There is exactly one shadow, and it marks the one thing that needs the user: the cue card.

### Shadow Vocabulary
- **Cue lift** (`box-shadow: 0 6px 24px -12px rgba(23,24,27,.35)`): only on the pending approval/question card, together with an 80% ink border. It enters with a 300ms fade and a short slide down from the top.

### Named Rules
**The One Lift Rule.** Only a card that is waiting on the user leaves the page plane. Everything else stays flat.

## Shapes

Corners are slight and consistent: 3px for swatches and keys, 5px for nav links, chips, screenshots and fields inside forms, 7px for buttons, inputs and every sheet or card. Borders are 1px hairlines everywhere. Inner dividers drop to the fainter Row Rule, and only the cue card upgrades to an ink border. Empty states use a dashed hairline. Duration bars are 6px tall and square-ended, never rounded pills. The mark is a 4px-rounded ink square holding a tally-red play triangle.

## Components

### Buttons
Quiet and solid; shadcn Button (radix-nova) re-tokened to ink.
- **Shape:** gently squared (7px), 32px tall. Large is 36px and is used only in the cue card.
- **Primary:** Ink fill with Paper text, 14px medium, 10px side padding. One primary per action zone, such as "Build the rules into code" before a build or "Run on the list".
- **Hover / Focus:** primary fades to 80% ink. Focus shows a 3px ring at 50% ink. Pressing moves the button down 1px.
- **Outline:** a hairline border on Paper, turning Wash on hover. It is used for the secondary action and for anything already done once ("Build again", "Stop", "Approve all remaining").
- **Ghost:** no fill, Wash on hover. Used for dismissive actions ("Skip this one", "Discard changes") and the Demo apps menu.
- **Keyboard cue:** an action with a shortcut carries a Kbd key (20px, 3px corners, Wash). On the ink button the key becomes 15% paper.

### Inputs / Fields
- **Style:** a 1px Field Stroke on a transparent or Sheet White fill, 7px corners, 32px tall. Number fields use mono.
- **Focus:** the border turns ink with a 3px ring at 50% ink.
- **Choices:** radio options are bordered 5px tiles. The selected tile takes an ink border on Wash.

### Navigation
- **Top bar:** 13px medium links, Quiet Ink, 5px corners. The current page gets Wash and ink with `aria-current`. There is no underline, sidebar or icon.
- **Tabs:** a line variant: 14px medium at 60% ink, active at full ink with a 2px ink underline.
- **Crumb:** a 13px Quiet Ink link led by "←".

### Sheets / Containers
- **Corner Style:** 7px.
- **Background:** Sheet White on Paper Ground. Muted callouts ("Reply it sends") use Wash at 60%.
- **Shadow Strategy:** none (see Elevation).
- **Border:** 1px hairline, with Row Rule between rows.
- **Internal Padding:** 16px sides, 10–12px row padding.

### Status
A 14px lucide stroke icon (2.25 weight) plus a 13px medium word, in the state's colour: Waiting (dashed circle, Quiet Ink), Running/Starting (spinning loader, Tally), Needs your OK (hand, ink), Has a question (speech bubble, ink), Done (check, Pass Green), Skipped/Stopped (minus, Quiet Ink), Failed (x, Fault Red).

### The Rundown (signature)
A numbered, ordered sheet with a Wash header row ("No.", "Item and outcome", "Time", and the scale "0–33.3s" in mono). Each row has a right-aligned mono number, the item name in medium weight (two lines at most, trailing date in mono), and a status/outcome line. Its time track draws a 6px bar on the shared scale: ink at 75% when settled, 40% Fault Red when failed, 40% Quiet Ink when skipped, Tally when live. Below the bar is the mono duration. The live bar breathes between 55% and 100% opacity (900ms, `cubic-bezier(.16,1,.3,1)`, alternating), and stops under reduced motion. The selected row turns Wash.

### The Cue Card (signature)
A card for the step that needs the user. Its 14px semibold header bar is inverted, ink with paper text: a glyph, "Waiting for your OK" or "Showrun has a question", and "Item N" in mono on the right. Under it come the item, "About to **verb**…" at 16px, the decision and its reason, and a large screenshot. Then the cue row: Approve (A), Approve all remaining, and Skip this one (R) pushed to the right. A and R work as keys when focus is not in a field.

### Revision Chip and Revised Line
The chip is a 12px swatch with a 15% black border, then mono `vN`, then the revision name in Quiet Ink. It can be a link, with Wash on hover and when active. A revised line in any numbered sheet has a semibold mono `*` in a dedicated 16px right-margin column, labelled for screen readers as changed in this version.

### Shot
A screenshot on a Wash well with a hairline border and 5px corners. It has an optional 12px Quiet Ink caption strip on Sheet White, dims to 90% on hover, uses a zoom-in cursor, and opens full size in a dialog.

## Do's and Don'ts

### Do:
- **Do** keep Tally Red (`#d7372b`) for the live item only: its bar, its timecode, its Running status, plus the play cue in the mark.
- **Do** show every status as glyph + word, with the word kept for screen readers when it is visually dropped.
- **Do** set counts, timecodes, versions, variable names and dates in Geist Mono.
- **Do** name and tint every spec version with its revision colour, and mark changed lines with the right-margin `*`.
- **Do** draw durations as square 6px bars on one shared scale per run.
- **Do** give the inverted cue card and its single shadow only to a step that waits on the user, with keyboard cues on its actions.
- **Do** quote the user's spoken words in Courier Prime and nothing else.

### Don't:
- **Don't** use status pills with dots, vertical accent bars on active or heading items, gradients, glow or emoji. Emoji in source data are stripped before display.
- **Don't** add a dark theme. The UI is light only, beside light apps.
- **Don't** build the generic dashboard: no grey card grid, no sidebar.
- **Don't** use broadcast jargon in UI copy. The metaphor stays in the form, not the words ("Waiting for your OK", not "Standby for cue").
- **Don't** add shadows to sheets, tables or menus at rest.
