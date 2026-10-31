# Remuse: 3-minute video script and shot list (v2)

## The idea the video sells

Remuse doesn't exist for run #1. If you only need a web chore done once while you sit at your desk, a prompt agent is
fine. **Remuse exists for runs #2 to #500, and for when Chrome is closed.**

**Tagline:** "Show it once. Remuse learns your way, runs it like code, and fixes itself when the website changes."

**Four truths the video proves:**

1. **No prompt when you're not there.** A prompt extension needs you in Chrome, typing. Remuse starts by itself: a file
   lands in a watched folder, or a schedule fires, with Chrome closed.
2. **Showing beats prompting.** Doing item #1 while talking for 15 seconds, and circling what matters with the pen, is
   faster and more exact than writing a long prompt full of edge cases.
3. **Run #50 behaves like run #1.** A prompt agent re-reads the screen and re-thinks every click of every item, so batches
   are slow and drift. Remuse turns the demo into a fixed procedure plus rules code (written by Muse Spark) and replays it.
   It only calls a model to read a value, apply your judgment, check a result, or heal.
4. **Proof and a gate.** Every step is checked against the page. Muse Spark Open checks results independently, and SAM 3.1
   outlines what you marked and the proof. Remuse stops before Turn in, Checkout, Publish or Send, and you press.

**Rules for the video:**
- **Every model claim must be true:**
  - Muse Voice Transcribe hears.
  - Muse Spark (Meta's API) understands the demo, writes the rules and reasons when a step breaks.
  - Muse Spark Open (`meta-models/muse-spark-open-1026`, open weights) checks every step's result independently and reads
    each value a second time.
  - SAM 3.1 outlines pen marks and proof.
  - These are four different jobs, never mixed up on screen.
- **Nothing on screen we didn't build:** no competitor products or logos, no fake competitor UI, no Facebook or
  Instagram automation.
- **Only measured numbers:** `[measure]` marks something we time in rehearsal, never a guess.
- **Real sites with real changes.** No mock sites, no fault switches.

**Status key:**
- **[works]** works today.
- **[build]** comes with the self-healing build, Nov 1–3.
- **[verify]** has to be checked on the real site before recording.

---

## Scene 1: Run #1 vs run #50 (0:00–0:25)

**Picture:**
- Kinetic text over James's real desktop.
- Line one: *"Run #1: a prompt agent is fine."*
- Line two: *"Run #50, with Chrome closed: ?"*
- James isn't in Chrome. He drops 3 finished files into his `Ready to submit` folder.
- A Windows notification: **"Remuse: 3 ready for your OK."**
- The comparison is honest text, not a fake competitor screen: **"Remuse: [measure] s and [count] model calls per
  item."** Next to it, *"Prompt agents re-read the screen at every step, every time."*
- If we time a real prompt agent ourselves, its number can go next to ours, with its branding blurred.

**Voice (James):**
> "If you only need a web chore done once, a prompt agent is fine. You type a paragraph and wait while it thinks through
> every click. But the second time? The fiftieth? With Chrome closed? Prompt agents start from zero every run, and n8n
> needs APIs most portals don't give you. So we built Remuse. Show it once, and it does it from then on."

**Features:**
- [works] folder trigger, Chrome closed, notifications.
- [measure] per-item time and model calls.

## Scene 2: Teach it once (0:25–1:10)

**Picture:**
- Chrome with the Remuse sidebar. The portal is Google Classroom: schools block its API for student accounts.
- James presses **Alt+Shift+S**. The sidebar goes to "Listening".
- He opens the assignment, then **Add or create → File**, and picks `CS101_Lab4.pdf`.
- He presses **Alt+Shift+D** and circles the attached file and the due date.
- **Sidebar zoom:** each sentence appears as he says it, then cards quoting his words or the click they came from. The
  circle is outlined.

**Voice (James, naturally, while doing it):**
> "When I finish a lab, it goes in my Ready to submit folder. Match it to the assignment by the course code in the file
> name. If it's already past the due date, don't upload, just tell me. This is how I know it's attached. And I always
> press Turn in myself. I'm done."

**Then the readback:**
- Remuse reads the plan aloud.
- It asks one question: *"If there's already a file attached, should I replace it?"*
- James answers by voice: *"Only if mine is newer. Otherwise ask me."* The rule updates on screen.
- He says *"Looks good."* Remuse practices once, only looking, and says "That worked."
- He turns on **Run when a new file lands in Ready to submit**.

**On-screen labels:**
- **Muse Voice Transcribe:** hears each sentence.
- **SAM 3.1:** outlines what you circled.
- **Muse Spark:** builds the task and its rules, and asks what it wasn't sure of.

**Voice-over line (optional):**
> "It's like onboarding a teammate: I do it once and say why."

**Features:**
- [works] teach mode, voice, pen marks, cards, the end phrase, readback, questions, voice answers, practice, folder
  trigger.
- [verify] the Classroom file picker. It opens in a frame, so the upload must be rehearsed on the real page.
- The question comes in the readback, right after recording, not in the middle of it. Asking mid-recording isn't built.

## Scene 3: Hands-free, at code speed, stopping at the gate (1:10–1:55)

**Picture:**
- James closes Chrome and keeps working in another app.
- He drops `Lab5`, `Lab6` and `Essay2` into the folder.
- Remuse's run page (or just the notifications) shows:
  - **Lab5 and Lab6:** steps tick past at code speed, each with a proof line like *"Lab5.pdf attached, read back from
    the page"*. The proof picture has the file outlined, and the step result is labelled *"checked independently by
    Muse Spark Open"*.
  - **Essay2:** its course code matches nothing. Remuse doesn't guess: *"No assignment matches 'Essay2'. Which one?"*
  - **The gate:** both labs stop at **Turn in**. The notification reads **"2 ready for your OK"**. James clicks **Approve
    all**, and both are turned in.

**Voice:**
> "I don't sit in Chrome or type prompts anymore. I drop files in a folder. Remuse uses my own logins, matches each file
> by my rules, proves each attachment is really there, and asks when something doesn't fit. And it never presses Turn
> in, Send or Pay on its own: I keep the last click."

**On-screen labels:**
- **Muse Spark Open** (`meta-models/muse-spark-open-1026`, open weights): independent check of every step.
- **SAM 3.1:** outlines the proof.

**Features:**
- [works] folder trigger, approval gate, Approve all, notifications, independent checker.
- [build] "turn in" on the never-press-alone list; proof lines with labels; the attachment read back from the page.
- [verify] the Muse Spark Open key is set. Without it, drop the Open labels and the bonus claim.

## Scene 4: The site changes, and it fixes itself (1:55–2:35)

**Picture:**
- A real change, not a mock. The same chore runs with the browser snapped to half the screen, so Classroom's layout
  collapses: buttons become icons and menus. If Classroom shows a popup or banner on recording day, that's fair too.
- The **Working it out** panel shows one line per idea, with before/after pictures:
  - *Goal: attach Lab7.pdf to "Lab Report 7".*
  - *"Add or create" isn't on the page; the window is narrow.*
  - *Idea 1: find it by its label. ✗ not there.*
  - *Idea 2: the "+" menu that does the same job. ✓ Lab7.pdf attached, read back from the page.*
  - *Learned: next time I go straight there.*
- Then a change James makes himself, by voice, without re-recording: *"From now on, also check the rubric is there before
  attaching."* Remuse changes just that step, says what it changed, and the step lights up.

**Voice:**
> "Websites change. Scripts break, and AI agents guess. Remuse reasons toward the goal, tries another way, and only
> believes it when the page proves it. And if my chore changes, I just tell it."

**On-screen labels:**
- **Muse Spark:** reasons through the ideas.
- **SAM 3.1:** outlines the proof.

**Features:**
- [build] the self-healing loop, proof labels, learned fixes, the live panel.
- [works] changing a task in your own words.
- [verify] which real change heals reliably in rehearsal (narrow window, popup, another class's layout). Keep whichever
  does.

## Scene 5: Not just school, and the Meta stack (2:35–3:00)

**Picture:** a 3-way split, each a real run:
1. **Classroom:** files staged from the folder.
2. **Shopping:** the same item on two stores, by James's spoken rule (*"cheapest after shipping, sellers rated 4.5 and
   up"*). It picks one, says why, and stops at **Checkout**.
3. **YouTube Studio:** the hourly report arrives as a notification while Chrome is closed.

**End card:**

```
Muse Voice Transcribe   hears you
Muse Spark              understands the demo, writes the rules, reasons when a step breaks
Muse Spark Open         meta-models/muse-spark-open-1026 · open weights · checks every result, reads every value twice
SAM 3.1                 outlines your pen marks and the proof
```

Then **Remuse: show it once.**

**Voice:**
> "Files into locked portals, prices with my own rules, hourly checks with Chrome closed. Show it once, and Remuse runs it
> your way. Built on Meta's Muse Voice Transcribe, Muse Spark, Muse Spark Open and SAM 3.1."

**Features:**
- [works] the compare step, the gate at Checkout, the hourly schedule.
- [verify] the stores' terms allow it.

---

## Shot list

| # | Shot | Length | Status |
|---|---|---|---|
| 1 | Kinetic text "Run #1 / Run #50" over desktop | 6 s | edit |
| 2 | Drop 3 files in folder, Chrome closed → "3 ready for your OK" | 8 s | [works] |
| 3 | Honest numbers card (Remuse per-item time + model calls) | 5 s | [measure] |
| 4 | Alt+Shift+S → Listening | 3 s | [works] |
| 5 | Teaching in Classroom while talking | 22 s | [verify] picker |
| 6 | Pen circle on the attachment and due date + outline | 4 s | [works] |
| 7 | Sidebar: words → cards with quotes | 5 s | [works] |
| 8 | Readback + question + voice answer + rule updates | 12 s | [works] |
| 9 | Practice "That worked", folder trigger on | 5 s | [works] |
| 10 | Close Chrome, drop Lab5/Lab6/Essay2 | 5 s | [works] |
| 11 | Run page: steps ticking, proof lines, outlined proof | 12 s | [build] labels |
| 12 | Essay2: "Which one?" | 4 s | [works]/[verify] |
| 13 | "2 ready for your OK" → Approve all → turned in | 8 s | [build] turn-in gate |
| 14 | Half-screen run, Working it out panel | 22 s | [build] |
| 15 | "Learned: next time…" | 3 s | [build] |
| 16 | Voice change "also check the rubric" → step updates | 10 s | [works]/[verify] |
| 17 | 3-way split: Classroom / two stores → Checkout / YouTube notification | 12 s | [works]/[verify] stores |
| 18 | Meta end card + title | 10 s | edit; Open key [verify] |

## Before recording (Nov 4)

1. The self-healing build is done and tested (Nov 1–3).
2. "turn in" is added to the never-press-alone list, with a test ("checkout" and "place order" are already on it).
3. Classroom upload through Google's file picker is rehearsed on the real page.
4. James's school Google account is signed in to Remuse's browser through the normal sign-in (never by copying cookies).
5. The Muse Spark Open key works. Otherwise, drop every Open label and the bonus claim.
6. Per-item time and model-call counts are measured in rehearsal. Only those go on screen. A prompt-agent number appears
   only if we really timed one, with its branding blurred.
7. The stores in scene 5 are chosen and their terms checked.
8. No Facebook or Instagram automation, no competitor logos, no fake competitor screens.
