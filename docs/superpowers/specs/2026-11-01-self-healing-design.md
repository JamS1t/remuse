# Self-healing runs: design

Status: draft for James's approval (2026-10-31). Research behind it: `.superpowers/self-healing-research.md`
(local, not committed); the main sources are listed at the end.

## Why

On 2026-10-31 James practiced his receipts task (Gmail receipt → a row in Google Sheets → archive the email). In Sheets
the step "type A1 in the Name Box" failed: Sheets' Name Box has no label, so Remuse couldn't find it. Its only repair
move ("look at the screenshot and point at a replacement") picked the "Search the menus" toolbar, typing into that
failed, and Remuse gave up and read the error out loud. It also logged "Updated the task so the next email uses it
directly" for a fix that never worked. A quick fix (the Name Box's fixed id) is already on main; this design is about
the agent itself.

James's words: "instead of just crying out loud because of an error, why can't he just solve it himself, because he
already has a goal in mind... that was what we are building, right?" And: "one wrong move and our users will be gone,
and that will be a domino effect." And, against playing it safe: "this is a hackathon entry, so we must show that our
agent can self heal and think through towards a set goal, instead of just surrendering."

So Remuse has to do two things at once: keep working toward the goal when a step breaks, and never do something wrong
quietly. The research says these fit together. Self-repair works when every fix is proven by the page itself;
self-critique without new evidence makes agents worse, and AI judges pass about 30% of failed runs.

## What James decided

1. When a step fails, Remuse fixes it itself and keeps going. Afterwards it tells him what it decided and why.
2. Critical steps (send, submit, publish, pay, delete and the rest of the irreversible list) are prepared up to the
   final button and left for him. Remuse never presses them on its own.
3. Ambitious, not conservative: try many different ways toward the goal. Give up only after really running out of
   ideas, and even then leave everything prepared, with what it tried and its best next idea, never just "I can't".
4. Every silent mistake loses trust: wrong row, the same receipt logged twice, the wrong column, the wrong number (a
   subtotal instead of the total), archiving after a failed log, a report that says "fixed it" when nothing was saved.
5. If one item out of ten can't be proven, Remuse finishes the other nine and leaves that one prepared, with notes.
6. Order of work: proof checks first, then the self-healing loop, then learning, the live reasoning display, and the
   demo.
7. Practice stays look-only, as today: it stops before the first keypress or click that would change his data. Healing
   is proven, and fixes are learned, in real runs.
8. If Remuse gives up partway through writing a row, it clears only the cells it typed for that item, checks they are
   empty again, and reports where it stopped. No half rows are left behind.
9. Every value Remuse is about to write gets a second, independent read, and the two reads must agree. If they don't,
   the item waits for him.
10. The demo uses real changes in real apps, not a mock site or a fault switch: "we can still experience self healing and
    changes in the real life applications."

## Goals

- **G1. Proof before progress.** Every step ends verified, failed or unverified, and says where the proof came from (read
  back from the page, judged from the screen, or none). A step that writes something only counts as done when it is
  verified by reading the page.
- **G2. Write safety.** Before writing, Remuse checks where it is about to write and that the item isn't already there.
  After a write, it reads it back. Steps that depend on an earlier write (archive after logging) run only when that write
  is verified.
- **G3. Self-healing loop.** On a failed step, Remuse works out why, then tries different strategies toward the step's
  goal, cheapest and most predictable first, proving each attempt, remembering what failed, within a budget, and
  re-plans the step from the task's goal as a last resort.
- **G4. Learning.** A fix that is proven gets reused first next time. Fixes that stop working are dropped. James can see
  what was learned and undo it.
- **G5. Live reasoning.** While it heals, the run shows its thinking one attempt at a time (idea → action → proof →
  verdict), and the end of the run says the decisions and reasons in plain words, spoken in practice.
- **G6. A useful handoff.** When it does run out, James gets what's done and prepared, every attempt with its evidence,
  one specific question, and Remuse's best next idea.

## Non-goals

- Healing irreversible steps automatically. They keep the approval gate.
- Tree search, backtracking or "try several runs and keep the best" on live state. A real spreadsheet or inbox can't be
  reset between tries.
- Healing during learning (turning the demo into a task). This is about runs and practice.
- Doing tasks nobody demonstrated.
- Models other than Meta's: Muse Spark for reasoning, SAM 3.1 for outlines, Muse Spark Open as the independent checker
  where it's configured (hackathon rule: Meta models must be visibly used).

## Anti-goals (failure even if it "works")

- Any of the six silent mistakes in decision 4.
- Saying "fixed" without proof from the page, or labelling a screen judgement as page proof.
- Saving a fix into the task that wasn't proven.
- Repeating an attempt that already failed, or looping.
- Pressing anything irreversible while healing, or typing anything other than the step's own value.
- Giving up while sensible untried ideas remain.

## Constraints

- Deadline Thu 2026-11-05 10:00 Manila. Build 2026-11-01 to 11-03; the video is made 2026-11-04.
- Public repo; every commit inside the hackathon window; no copied code from other projects.
- The approval gate and the step checks are never cut.
- Runs happen in Remuse's own (hidden) browser or in James's Chrome over CDP. Both must work.
- Tests: model-free checks for logic; end-to-end tests with real models on their own ports (never 3200, James's Agent).
- PRs are opened, not merged, unless James asks.

## Design

### 1. Proof layer (day 1)

**Verdicts.** The step check returns `{ result: "verified" | "failed" | "unverified", proof: "page" | "screen" | "none",
why }`, and the run log shows it. Rules:

- A page check that fails is a failure. The screenshot judge can't overrule it. Today it can; that is one of three
  trust bugs to fix.
- The screenshot judge can block a pass ("the page text is there, but the screen shows an error dialog"). It can't
  turn a failure into a pass.
- "No error came up" is unverified, not a pass.
- A step that writes (fill, typing into a cell, a press that commits typing, a click whose expected result is saved
  data) needs page proof to be verified. Unverified writes stop the item's dependent steps.

**Better page checks.**
- Text checks look for text that newly appeared (there after the step, and not there before, or there more times). That
  stops a check from passing because the words are elsewhere on the page, for example in the still-open receipt email.
  If the expected text was already there before the step, the check proves nothing: the step is unverified, not failed.
  (James's receipts task checks every Sheets step with "Receipts", which is always on screen.)
- A typed field is read back. A field that can't be read back is unverified, not a pass.

**Second read of every value to write.** Before writing, each value is read a second time, independently: by Muse Spark
Open (Meta's open-weights model) when its key is set, otherwise by a second Muse Spark look at a fresh screenshot
without the first answer. Both must agree, after normalizing (₱451 = 451.00). If they disagree, the item waits for
James with both readings shown. This targets the "subtotal instead of total" mistake, which proof checks alone can't
catch.

**Writing by column name.** Values go under their column's header ("Total"), read from the sheet each time, not into a
fixed column position. If the column moved or a new one was inserted, Remuse writes under the right header and says so.
This is a real-life heal James can show on camera by editing his own sheet.

**Google Sheets read-back.** The grid is drawn on a canvas, so its text isn't in the page. Day 1 starts with a short
spike to pick the method:

- First choice: read the sheet's values as CSV through the signed-in browser (Sheets' own export link for that tab).
  It gives the whole sheet in one call, before and after writing. Not yet proven to work in Remuse's browser.
- Fallback: go to the cell with the Name Box (Ctrl+J, documented by Google), and read the formula bar.

With that:
- **Before writing a row:** find the next empty row, and check whether this item is already logged by its key (for
  receipts: merchant + date + total). If it is, mark the item "already logged", write nothing, and say so.
- **After writing:** exactly one new row, holding the expected values in the expected columns. Otherwise the write
  failed.
- **Before retrying a write that failed unclearly:** read the sheet again, so a write that actually landed isn't done
  twice.

**Dependent steps.** A step that comes after a write in the same item (in the receipts task, archiving) runs only when
every write before it is verified. Archive is on the irreversible list, so in a run it is also prepared for James's OK
unless he allowed it; this rule applies on top of that.

**Already logged.** When the item is already in the sheet, nothing is written, and the dependent step (archive) isn't
done by itself either: it waits for James's OK with a note naming the row it found. Two genuine identical purchases
(same merchant, day and amount) must never be archived away unlogged.

**Three trust bugs to fix first** (from reading the code):
1. A vision "fix" is written into the task and announced before its step is checked (`findByVision`).
2. The screenshot judge can turn a failed page check into a pass (`check`).
3. Steps pass with no proof: unreadable fields, "no error came up", page-wide text matches.

### 2. Self-healing loop (day 2)

**When it runs.** A step throws (not found, couldn't act) or its verdict is failed. Not for irreversible steps, not on
a sign-in page (the existing sign-in flow handles that), and not after the run is stopped. In practice it heals only
the look-only part (practice still stops before the first change to data).

**What it heals: the step as a person names it.** Healing works on a step as `readback.ts`'s `shownSteps()` groups it
("Go to the next empty row" = Name Box + Ctrl+End + Down; "Type the total" = the typing + its Tab), not on single
keypresses. The group's goal is what has to be reached, the safety rules apply to the group (Enter is allowed if the
group itself presses Enter), and attempt memory and learned fixes are keyed by the group.

**If the action already ran.** When a step's action ran but its check failed, Remuse may only act again if the action
didn't change data (navigation, opening a menu), or after reading the data back proves the first try didn't land. A
write is never repeated blindly.

**Step 1: diagnose, in code, no model.** Sign-in page? A dialog or overlay in the way? Still loading? On the wrong page
or tab? Target there but hidden or disabled? The diagnosis picks where on the ladder to start, and is the first line
of the reasoning shown to James.

**Step 2: climb the ladder.** Cheap, predictable rungs first; each attempt is proven before it counts.

1. Wait for the page to settle, then look again.
2. Close what's in the way (Escape, a dialog's close button), then look again.
3. Other ways to find the same thing: a looser name, the recorded selector, its visible text, its label, and known
   fixed handles for sites Remuse knows (Sheets' Name Box `#t-name-box`).
4. Known keyboard routes for the step's purpose (Sheets: Ctrl+J for the Name Box, Ctrl+End and arrows for the next
   row). Kept in a small per-site table.
5. Muse Spark chooses from what's on the page. It gets the step's goal and why it's there (the person's words from the
   demo), the task's goal, every attempt so far and how it failed, a screenshot, and a numbered list of the page's
   usable elements (kind, name, id, whether it takes typing, where it is). It answers with one move (click, type, key,
   scroll, wait, or "this step is already done") and why, or "none of these". Choosing from a list is about twice as
   accurate as pointing at a picture, and "none" stops it from inventing a target.
6. Pointing at the screen (the existing Muse Spark + SAM 3.1 look), only when the list has nothing and the page is drawn
   rather than built from elements (a canvas, an image).
7. Re-plan: Muse Spark writes up to 3 small, reversible steps that reach the same goal another way. Each goes through
   the same safety check, and together they must pass the original step's check.

Rungs 5–7 may run more than once, each time with the new evidence.

**Safety check in code, before every attempt.** Never click or press anything whose name is on the irreversible list.
No Enter (or Ctrl+Enter) unless the step itself was that key. Typing only into something that takes typing, and only
the step's own value. No leaving the step's site, except to links already in the task. No uploads or downloads.

**Attempt memory.** Every attempt is logged (strategy, target, what changed on the page, verdict). The same strategy on
the same target is never tried twice, and "nothing changed on the page" counts as a failure. The log is fed into every
new Muse Spark move.

**Budget per failed step** (my numbers): up to 6 different attempts, about 90 seconds, about 8 model calls.

**When it succeeds:** the step is verified with its proof, the item continues, and the fix is kept as a proposal (§3).

**When it runs out:**
- *First, in every case:* if it had typed part of a row for this item, it clears only those cells, reads them back as
  empty, and says so.
- *Scheduled or hidden run:* that item ends as "needs you", with a screenshot of where it stopped, and the run moves on
  to the next item. The item isn't marked handled, so the next run tries it again from a clean start.
- *Visible run in James's Chrome:* the existing handoff asks him, now with the handoff package (§5).
- *Practice:* the package is what the review says out loud.

### 3. Learning (day 3)

- A fix starts as **proposed** once its step is verified. It becomes **learned** once the whole item finishes verified.
- Learned fixes are tried first next time, before the step's original way.
- After 2 failures in a row, a learned fix is dropped.
- Fixes live in their own table, keyed by task and step, not written into the task spec. That makes them easy to show
  and undo, and the spec stays what James taught. (My call.)
- The task page shows "What Remuse learned": the step, the fix, when it was proven, and an undo button.

### 4. Live reasoning and the report (day 3)

- **Live:** each attempt is one line in the run, with before/after pictures and a proof label ("read back from the
  page", "judged from the screen", "not proven"). For example: "Goal: log this receipt. The Name Box isn't where it was.
  Idea 1: … ✗ nothing changed. Idea 2: Ctrl+J → C12 now holds ₱451 ✓ read back from the page."
- **Where it shows:**
  - the run page;
  - the sidebar during a run or practice, as a "Working it out" block;
  - the end-of-run summary, for example "The Total column moved to E, so I wrote ₱451 there and read it back".
- **End of run:** a short list of the decisions it made and why, at the top of the run (what James asked for).

### 5. Handoff package

What's done and what's prepared; each attempt with its before/after evidence; one specific question; and Remuse's best
next idea. Spoken in practice, shown in runs, and in the Windows notification for scheduled runs.

### 6. Critical steps

The existing approval gate stays as it is. In a scheduled run, Remuse does everything up to the irreversible step,
leaves it prepared, and asks for his OK (the existing approval and notification). Healing never runs on those steps.

## Demo

Real apps, real changes, no mock site and no fault switch (James's call). The demo is a real run of the receipts task on
fresh test emails into his test sheet. On camera he changes his own sheet, and Remuse adapts, proves it, and says what it
did. Candidates, to rehearse on day 3 and keep whichever heals reliably:

- insert a column, or move the Total column;
- rename the "Receipts" tab;
- leave a different tab, a filter or a popup open before the run.

Gmail and Sheets also change on their own (new dialogs, layout updates); any heal that happens naturally while
rehearsing is fair to show.

## Testing

- **Model-free checks:**
  - the safety check;
  - verdict rules (a failed page check stays failed, unverified writes block dependent steps);
  - "newly appeared" text;
  - attempt memory (no repeats, "unchanged" = failed);
  - the ladder order;
  - the fix lifecycle (proposed → learned → dropped).
- **End-to-end, with real Muse Spark, on their own ports:**
  - a button moved into a menu: it opens the menu and finishes;
  - a Sheets-like page with no Name Box label: the keyboard route wins and is read back;
  - the only button left sends: it never sends;
  - the same receipt twice: the second is "already logged", and its archive waits for James;
  - a log that can't be verified: no archive;
  - the Total column moved: the value lands under "Total" and is read back;
  - the two reads of a value disagree: the item waits, with both readings;
  - giving up halfway through a row: the typed cells are cleared and read back empty;
  - a wrong vision guess: never saved;
  - no repeated attempts.
- **Real world:** James's receipts task on the five test emails, and the YouTube metrics task.

## Left to the builder

- Prompt wording, and how the element list is built and trimmed.
- Exactly which steps count as writes.
- The table layout for fixes.
- How the trace looks, following Remuse's existing design.
- Which Sheets read-back method wins the spike.

## Calls I made (for James to check)

- Fixes are kept in their own table, not written into the task.
- Budget: 6 attempts, about 90 seconds, about 8 model calls per failed step.
- Text checks count only newly appeared text; text that was already there leaves the step unverified.
- In scheduled runs, an item that runs out of ideas ends as "needs you" and the run moves on. In a visible run, it asks
  you.
- The receipts duplicate key is merchant + date + total.
- Healing works on the step as a person names it, not on each keypress.
- A write is never repeated without reading back first.
- An already-logged receipt isn't archived by itself; archiving waits for you, with the row it found.

## Main sources

- Google Sheets keyboard help: support.google.com/docs/answer/1632199
- Anthropic's computer-use guidance: claude.com/blog/best-practices-for-computer-and-browser-use-with-claude, and
  anthropic.com/engineering/building-effective-agents
- OpenAI's Operator system card (confirmations cut serious mistakes by about 90%)
- Stagehand caching docs ("a wrong cached click is worse than a slow click")
- browser-use agent source
- UiPath Healing Agent docs
- Research on arXiv:
  - SeeAct 2401.01614 (choosing from a list vs pointing at a picture)
  - AgentRewardBench 2504.08942 (AI judges under 70% precision)
  - Huang et al. 2310.01798 (self-correction without feedback hurts)
  - Voyager 2305.16291 (save skills only after they're verified)
  - WebArena 2307.13854 (agents give up early)
  - Magentic-UI 2507.22358
  - ST-WebAgentBench 2410.06703
