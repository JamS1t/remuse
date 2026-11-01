# Self-healing runs: design

Status: draft v2 for James's approval (2026-10-31). The video it has to support is `docs/video-script.md` (v2). The research
behind it is `.superpowers/self-healing-research.md` (local, not committed); the main sources are at the end.

## Why

Remuse doesn't exist for run #1: a prompt agent can do a chore once while you watch. Remuse exists for runs #2 to #500,
and for when Chrome is closed. You show a chore once while talking, and it runs it from then on, the same way every time,
started by a folder or a schedule. That only holds if Remuse keeps working when websites change, and never does something
wrong quietly while nobody is watching.

On 2026-10-31 it failed that test. In Google Sheets, a step couldn't find the Name Box. Remuse's only repair move
("point at a replacement on a screenshot") picked the "Search the menus" toolbar, typing failed, and it gave up and read
the error out loud. It also announced it had updated the task with a fix that never worked.

James: "instead of just crying out loud because of an error, why can't he just solve it himself, because he already has
a goal in mind." Also: "one wrong move and our users will be gone, and that will be a domino effect." And: "this is a
hackathon entry, so we must show that our agent can self heal and think through towards a set goal, instead of just
surrendering."

Research agrees that both can be had at once. Self-repair works when the page itself proves every fix. Self-critique
without new evidence makes agents worse, and AI judges pass about 30% of failed runs.

## What James decided

1. When a step fails, Remuse fixes it itself and keeps going. Afterwards it tells him what it decided and why.
2. Critical steps are prepared up to the final button and left for him. That covers send, submit, turn in, publish, pay,
   checkout, delete and the rest of the irreversible list. Remuse never presses them on its own.
3. Ambitious, not conservative: try many different ways toward the goal. Give up only after really running out of ideas,
   and then leave things prepared, with what it tried and its best next idea. Never just "I can't".
4. Silent mistakes lose users:
   - the wrong place, row or column;
   - the same thing done twice;
   - the wrong value (a subtotal instead of the total);
   - a dependent step done after a failed one;
   - a "fixed it" report with nothing behind it.
5. If one item in a batch can't be proven, Remuse finishes the others and leaves that one prepared, with notes.
6. Order of work: proof checks first, then the self-healing loop, then learning, the live reasoning display, and the demo.
7. Practice stays look-only, as today: it stops before the first change to data. Healing is proven, and fixes are learned,
   in real runs.
8. If Remuse gives up partway through writing something, it clears only what it wrote for that item, checks it's gone,
   and reports where it stopped.
9. Every value Remuse is about to write or submit gets a second, independent read. If the two reads disagree, the item
   waits for him.
10. The demo uses real sites with real changes: no mock site, no fault switch.
11. **The model split is strict, and it's what the video shows:**

    | Model | Job |
    |---|---|
    | Muse Voice Transcribe | hears the person |
    | Muse Spark | understands the demo, writes the rules and the procedure, and reasons when a step breaks |
    | Muse Spark Open (`meta-models/muse-spark-open-1026`, open weights) | checks step results and outcomes independently, and reads values a second time |
    | SAM 3.1 | outlines pen marks during teaching, and the proof in screenshots |

12. The clarifying question stays where it's built: in the readback right after recording.
13. The hero chore is Google Classroom submission, because schools block the API for student accounts. The engine stays
    general, with small plug-ins for Classroom, Sheets and stores, so Remuse never reads as an app for one site.
14. The real layout change for the heal is Classroom in a half-width window, where buttons collapse into icons and menus.

## Goals

- **G1. Proof before progress.** Every step ends verified, failed or unverified, and says where the proof came from: read
  back from the page, judged from the screen, or none. A step that writes or attaches counts as done only when the page
  proves it.
- **G2. Safe writes.** Before writing, Remuse checks where it's about to write and that the item isn't already there.
  After writing, it reads it back. Steps that depend on a write run only once that write is verified.
- **G3. Self-healing loop.** On a failed step, Remuse works out why, then tries different strategies toward the step's
  goal, cheapest and most predictable first. Each attempt is proven. It remembers what failed, stays within a budget,
  and re-plans the step from the task's goal as the last resort.
- **G4. Learning.** A fix that's proven gets reused first next time. Fixes that stop working are dropped. James can see
  what was learned and undo it.
- **G5. Live reasoning.** While it heals, the run shows its thinking one attempt at a time (idea → action → proof →
  verdict). The run ends with its decisions and reasons in plain words.
- **G6. Batches from a folder.** Several files dropped at once become one run with one item per file. Each item is
  matched, prepared and proven on its own. The run ends with "N ready for your OK" and **Approve all**.
- **G7. Ask instead of guess.** An item that fits nothing (no assignment matches the file) or fits several waits for
  James with a specific question. The rest of the batch carries on.
- **G8. One engine, small plug-ins.** Everything above works on any site. Site knowledge comes in small plug-ins:
  Classroom, Sheets and stores.

## Non-goals

- Healing irreversible steps automatically. They keep the approval gate.
- Tree search, backtracking or "run it several times and keep the best" on live data. A real inbox, class or sheet can't
  be reset between tries.
- Healing during learning (turning the demo into a task), or asking questions in the middle of recording.
- Doing chores nobody demonstrated.
- Models other than the four above.
- Automating Facebook or Instagram (Meta's terms forbid it, and the hackathon disqualifies policy violations).

## Anti-goals (failure even if it "works")

- Any silent mistake in decision 4.
- Saying "fixed" without proof from the page, or labelling a screen judgment as page proof.
- Saving an unproven fix.
- Repeating an attempt that already failed, or looping.
- Pressing anything irreversible while healing, or typing anything but the step's own value.
- Giving up while sensible untried ideas remain.
- A model doing a job the video says another model does.

## Constraints

- Deadline Thu 2026-11-05 10:00 Manila. Build 2026-11-01 to 11-03; video 2026-11-04.
- Public repo; every commit inside the hackathon window; no code copied from other projects.
- The approval gate and the step checks are never cut.
- Runs happen in Remuse's own browser (hidden, Chrome closed) or in James's Chrome over CDP. Both must work.
- Tests: model-free checks for logic, and end-to-end tests with real models on their own ports (never 3200, James's Agent).
- PRs are opened, not merged, unless James asks.

## Design

### 0. Shape: one engine, small plug-ins

**The engine** (runner + checks + healing) knows nothing about any one site. It works from three things:

- **the page:** elements, values, text that newly appeared, the URL;
- **the task:** each step's goal, the person's words behind it, the task's goal;
- **the models**, each in its own job (decision 11).

**A plug-in is a small file per site.** It is matched by address and can offer:

- **fixed handles:** elements that never move, e.g. Sheets' Name Box `#t-name-box`;
- **keyboard routes for a purpose:** Sheets: Ctrl+J for the Name Box, Ctrl+End for the last row;
- **read-back:** how to prove a step worked on that site:
  - *Classroom:* the file chip with the file's name in "Your work", and the assignment's status;
  - *Sheets:* the cell's value;
  - *stores:* the cart's line item, quantity and price;
- **checks before writing**, such as duplicates;
- **cleanup** of its own partial writes.

A site with no plug-in still gets everything in §1–§5 through the generic defaults (field read-back, newly appeared
text, choosing among the page's elements). Plug-ins for the demo: **Classroom** (hero), **Sheets** (James's receipts),
**stores** (scene 5). The plug-in format is the builder's call; it should stay a plain object of functions, no framework.

### 1. Proof layer (day 1)

**Verdicts.** The step check returns `{ result: "verified" | "failed" | "unverified", proof: "page" | "screen" | "none",
by, why }`, and the run log shows it.
- **A failed page check is a failure.** A screen judgment can't overrule it. Today it can; that's one of three trust
  bugs.
- **A screen judgment can block a pass** ("the text is there, but an error dialog is showing"). It can never turn a
  failure into a pass.
- **The judge is Muse Spark Open** where its key is set (`by` says so). Without it, Muse Spark judges and `by` says that
  instead. The video only shows the Open label when Open really did it.
- **"No error came up" is unverified,** not a pass.
- **A step that writes or attaches needs page proof** to be verified. An unverified write stops the item's dependent
  steps.

**Better page checks.**
- **Text checks count only text that newly appeared:** there after the step, and not there before, or there more times.
  Text that was already there proves nothing, so the step is unverified, not failed. (James's receipts task checks every
  Sheets step with "Receipts", which is always on screen.)
- **A typed field is read back.** A field that can't be read back is unverified.
- **Plug-in read-backs come first where a plug-in has one.** Classroom: "Lab5.pdf is attached to Lab Report 5", read
  from the file chip.

**Second read of every value to write or submit.** Before it's used, each value is read again independently:
- **Who reads it:** Muse Spark Open, or, without its key, a second Muse Spark look at a fresh screenshot that doesn't see
  the first answer.
- **The match:** both must agree after normalizing (₱451 = 451.00).
- **If they disagree:** the item waits, showing both readings.
- **What it catches:** "subtotal instead of total". Proof checks alone can't.

**Writing into tables by column name** (Sheets plug-in). Values go under their header ("Total"), read from the sheet
each time, never into a fixed column. If the column moved, Remuse writes under the right header and says so. The grid
is drawn on a canvas, so day 1 starts with a short spike to pick how to read it back:
- *First choice:* the sheet as CSV through the signed-in browser.
- *Fallback:* Ctrl+J to the cell, then read the formula bar.

**Before writing:**
- the place is empty, or the item is already there (receipts: merchant + date + total);
- if it's already there, nothing is written, and the dependent step (archive) waits for James with a note naming where
  it found it.

**After writing:** exactly one new entry, holding the expected values.

**Before retrying a write that failed unclearly:** read the place again, so a write that did land isn't done twice.

**Dependent steps.** A step after a write in the same item (archive, turn in) runs only when every write before it is
verified. Irreversible steps are prepared for James's OK anyway; this rule applies on top of that.

**The never-press-alone list gains "turn in"** ("checkout" and "place order" are already on it), with a test.

**Three trust bugs to fix first:**
1. A vision "fix" is written into the task and announced before its step is checked (`findByVision`).
2. The screen judge can turn a failed page check into a pass (`check`).
3. Steps pass with no proof: unreadable fields, "no error came up", page-wide text matches.

### 2. Self-healing loop (day 2)

**When it runs.** A step throws (not found, couldn't act) or its verdict is failed. Not for irreversible steps, not on
a sign-in page (the existing sign-in flow handles that), and not after a stop. In practice it heals only the look-only
part.

**What it heals: the step as a person names it.** Healing works on a step as `shownSteps()` groups it ("Go to the next
empty row", "Attach the file"), not on single keypresses. The group's goal is what must be reached. The safety rules
apply to the group: Enter is allowed only if the group itself pressed it. Attempt memory and learned fixes are keyed by
the group.

**If the action already ran.** Remuse may act again only if the first action didn't change data (navigation, opening a
menu), or if reading back proves the first try didn't land. A write is never repeated blindly.

**Step 1: diagnose, in code, no model.**
- a sign-in page;
- a dialog or overlay in the way;
- still loading;
- the wrong page or tab;
- a narrow window with the layout collapsed;
- the target there but hidden or disabled.

The diagnosis sets where on the ladder to start, and it's the first line James sees.

**Step 2: climb the ladder.** Cheapest and most predictable first. Each attempt is proven before it counts.
1. Wait for the page to settle, then look again.
2. Close what's in the way (Escape, a dialog's close button), then look again.
3. Find it another way: a looser name, the recorded selector, its visible text, its label, or a plug-in's fixed handle.
4. A plug-in's keyboard route or menu path for the step's purpose.
5. **Muse Spark chooses from the page's real elements.**
   - *What it gets:* the step's goal, the person's words behind it, the task's goal, every attempt so far and why each
     failed, a screenshot, and a numbered list of usable elements (kind, name, id, takes typing or not, where it is,
     whether it's inside a collapsed menu).
   - *What it answers:* one move (click, type, key, scroll, open a menu, wait, or "this step is already done") with its
     reason, or "none of these".
   - *Why a list:* choosing from a list is about twice as accurate as pointing at a picture, and "none" stops it inventing
     a target.
   - *The demo heal happens here:* in half-width Classroom, "Add or create" is gone and the "+" menu does the same job.
6. **Point at the screen** with the existing Muse Spark look and SAM 3.1 edges. Only when the list has nothing and the
   page is drawn rather than built from elements (a canvas).
7. **Re-plan:** Muse Spark writes up to 3 small, reversible steps that reach the same goal another way. Each passes the
   safety check, and together they must pass the original step's check.

Rungs 5–7 can repeat, each time with the new evidence.

**Safety check, in code, before every attempt:**
- never click or press anything named on the irreversible list;
- no Enter or Ctrl+Enter unless the step itself pressed it;
- typing only into something that takes typing, and only the step's own value;
- no leaving the step's site, except to links already in the task;
- uploads only of the item's own file, into the step's own upload control;
- no downloads.

**Attempt memory.** Every attempt is logged (strategy, target, what changed on the page, verdict). The same strategy on
the same target is never tried twice. "Nothing changed on the page" counts as a failure. The log goes into every new
Muse Spark move.

**Budget per failed step** (my numbers): up to 6 different attempts, about 90 seconds, about 8 model calls.

**When it succeeds:** the step is verified with its proof, the item continues, and the fix is kept as a proposal (§3).
The proof screenshot has the proven element outlined by SAM 3.1.

**When it runs out:**
1. If it wrote part of something for this item, it cleans up only that (plug-in cleanup), checks it's gone, and says
   so.
2. *Batch, scheduled or hidden run:* the item ends as "needs you", with a screenshot of where it stopped, and the run
   moves on. The item isn't marked handled, so the next run tries it again from a clean start.
3. *Visible run in James's Chrome:* the existing handoff asks him, with the handoff package (§5).
4. *Practice:* the package is what the review says out loud.

### 3. Learning (day 3)

- **Proposed:** once its step is verified.
- **Learned:** once its whole item finishes verified. Learned fixes are tried first next time.
- **Dropped:** after 2 failures in a row.
- **Storage:** its own table, keyed by task and step group, not written into the task spec. That makes it easy to show
  and undo, and the spec stays what James taught. (My call.)
- **On the task page:** "What Remuse learned" lists each step, its fix, when it was proven, and an undo button.

### 4. Batches, matching and approve-all (day 3)

- **One run per batch:** files that land in a watched folder together (within a few seconds) become one run with one
  item per file. Today each file starts its own run, one after another.
- **Matching:** each item is matched to its place on the site by the person's spoken rule (Classroom: the course code in
  the file name → the assignment). Exactly one match goes ahead. Zero or several matches means the item waits with a
  specific question ("No assignment matches 'Essay2'. Which one?"), and the others carry on. Never a guess.
- **The end of the run:** every prepared item stops at its gate. The notification says **"N ready for your OK"**, and
  the run page offers **Approve all** (it already exists) or one at a time, each with its proof.

### 5. Live reasoning, report and handoff (day 3)

- **Live:** one line per attempt in the run page and the sidebar's "Working it out" block, with before/after pictures
  and a proof label ("read back from the page", "judged from the screen", "not proven"). For example: "Goal: attach
  Lab7.pdf. 'Add or create' isn't on the page; the window is narrow. Idea 1 ✗ not there. Idea 2: the '+' menu ✓ Lab7.pdf
  attached, read back from the page."
- **End of run:** the decisions it made and why, at the top of the run, and in the notification for scheduled runs.
- **Handoff package** (when it runs out): what's done and prepared; each attempt with its evidence; one specific
  question; Remuse's best next idea.

### 6. Critical steps

The approval gate stays as it is, plus "turn in". In a hidden run, Remuse does everything up to the gated step, leaves
it prepared, and asks for his OK. Healing never runs on gated steps.

## Demo

`docs/video-script.md` v2 is the authority. What it needs from this design:

- **Scene 3:**
  - a batch from the folder with Chrome closed;
  - Classroom read-back proof with the SAM 3.1 outline, and the Muse Spark Open check label;
  - one file that matches nothing and gets a question;
  - "turn in" gated, then Approve all.
- **Scene 4:** a real heal in half-width Classroom, through rung 5 (the "+" menu chosen from the page's elements), proven
  by read-back, then "learned". Then a spoken change to the task (that already works).
- **Scene 5:** the stores plug-in (cart read-back, stops at Checkout) and the hourly YouTube report (works today).

## Testing

- **Model-free checks:**
  - the safety check;
  - the verdict rules (a failed page check stays failed; unverified writes block dependent steps);
  - "newly appeared" text;
  - attempt memory (no repeats; unchanged = failed);
  - the ladder order;
  - the fix lifecycle;
  - batch grouping;
  - the matching rule (0 or several matches → ask);
  - "turn in" is gated.
- **End-to-end, real models, own ports:**
  - a control collapsed into a menu at a narrow width: healed from the page's elements and read back;
  - the only button left sends: it never sends;
  - three files at once: one run, two prepared, one question, Approve all;
  - the same receipt twice: the second is "already logged" and its archive waits;
  - a write that can't be verified: no dependent step;
  - a moved Total column: written under "Total" and read back;
  - two reads that disagree: the item waits;
  - giving up mid-write: its own partial write is cleaned up and checked;
  - a wrong vision guess: never saved;
  - no repeated attempts.
- **Real world, before the video:**
  - Classroom: half-width heal, the file picker upload, and the Turn in gate on James's school account;
  - the receipts task on the test emails;
  - the store compare;
  - the YouTube report.

## Left to the builder

- Prompt wording.
- How the element list is built and trimmed.
- The plug-in object's exact shape.
- Which steps count as writes.
- The fixes table's layout.
- How the trace looks, in Remuse's existing design.
- Which Sheets read-back wins the spike.
- How long the folder waits to group a batch.

## Calls I made (for James to check)

- Fixes are kept in their own table, not written into the task.
- Budget: 6 attempts, about 90 seconds, about 8 model calls per failed step.
- Text checks count only newly appeared text; text that was already there leaves the step unverified.
- Healing works on the step as a person names it, not on each keypress.
- A write is never repeated without reading back first.
- Something already logged isn't followed by its dependent step by itself; that waits for you, with where it was found.
- Batch, scheduled and hidden runs move on after an item runs out; a visible run asks you.
- Files that land together within a few seconds are one batch.
- Without the Muse Spark Open key, Muse Spark does the checking, and the run says so (no Open label).

## Main sources

- **Google Sheets keyboard help:** support.google.com/docs/answer/1632199
- **Anthropic's computer-use guidance:** claude.com/blog/best-practices-for-computer-and-browser-use-with-claude, and
  anthropic.com/engineering/building-effective-agents
- **OpenAI's Operator system card:** confirmations cut serious mistakes by about 90%
- **Stagehand caching docs:** "a wrong cached click is worse than a slow click"
- **browser-use's agent source**
- **UiPath Healing Agent docs**
- **arXiv:**
  - SeeAct 2401.01614 (choosing from a list vs pointing at a picture)
  - AgentRewardBench 2504.08942 (judges under 70% precision)
  - Huang et al. 2310.01798 (self-correction without feedback hurts)
  - Voyager 2305.16291 (keep skills only after they're verified)
  - WebArena 2307.13854 (agents give up early)
  - Magentic-UI 2507.22358
  - ST-WebAgentBench 2410.06703
