# Remuse: 3-minute video script and shot list

**Positioning:** "Show it once. Remuse learns your way, runs it like code, and fixes itself when the website changes."

**Three proofs, one per alternative:**

1. **vs prompt agents:** fast and the same every run (times measured by us, no competitor products or logos shown).
2. **vs n8n:** works on any portal you're signed into, where APIs are blocked or don't exist.
3. **vs scripts and RPA:**
   - Your spoken "why" becomes rules (Muse Voice Transcribe + Muse Spark).
   - SAM 3.1 outlines your pen marks and the visual proof.
   - It heals with proof from the page.
   - It always stops at the safety gate before anything irreversible.

**Hero:** Google Classroom assignment submission. Schools block the Classroom API for student accounts, so this chore can't be
done with n8n. It's one example of a locked portal, not the product: scene 6 shows a different chore on a different site.

**Status key**
- **[works]** works today.
- **[build]** comes with the self-healing build, Nov 1–3.
- **[verify]** has to be checked on the real site before recording.

---

## Scenes

### 1. Hook (0:00–0:12)

**Picture:** quick cuts of James's real chores in his own browser: a Classroom assignment page, two store tabs, YouTube
Studio. No other companies' AI products on screen. Title card: **Remuse: show it once.**

**Voice (James):**
> "Every week I do the same chores on websites that don't connect to anything. Automation tools need an API. AI browser
> agents think through every click, every time. Remuse is different. I show it once."

### 2. Teach it once (0:12–0:50)

**Picture:**
- James presses **Alt+Shift+S**. The sidebar turns into the listening screen (orb, "Listening").
- He opens Classroom, then the assignment "Lab Report 4".
- He clicks **Add or create → File** and picks `CS101_Lab4.pdf` from his `Ready to submit` folder.
- The file shows as attached.
- He presses **Alt+Shift+D** and circles the attachment chip with the pen.
- Cards appear in the sidebar as he talks, each quoting his words or the click it came from.

**Voice (James, natural, while doing it):**
> "When I finish a lab, I put it in my Ready to submit folder. Match it to the assignment by the course code in the file
> name. If it's already past the due date, don't upload it, just tell me. This, the file showing here, is how I know it's
> attached. And I always press Turn in myself. Okay, I'm done."

**On-screen labels (small, bottom corner, as each happens):**
- **Muse Voice Transcribe:** hears each sentence.
- **SAM 3.1:** outlines what you circled.
- **Muse Spark:** turns words + clicks into cards.

**Features:**
- [works] teach mode, the shortcut, voice end phrase, cards with evidence, pen marks, tab hopping.
- [verify] the Classroom file picker. Classroom opens Google's file picker in a frame, so the upload step must be
  rehearsed on the real page.

### 3. It reads back and asks (0:50–1:12)

**Picture:**
- Remuse speaks its plan as each step lights up in the sidebar.
- It asks: *"If two assignments have the same course code, which one should I use?"*
- James answers by voice: *"The one due soonest."* The plan updates.
- He says *"Looks good."* Remuse practices once on the example, only looking, nothing submitted, and says *"That worked."*
- In the task card he turns on **Run when a new file lands in "Ready to submit"**.

**Features:**
- [works] spoken readback, one question at a time, voice answers, practice, folder trigger.
- **On-screen label:** **Muse Spark**, "understood the demo, wrote the rules".

### 4. Runs like code, stops at the gate (1:12–1:45)

**Picture:**
- James closes his browser.
- He drops `CS101_Lab5.pdf` into `Ready to submit`.
- A Windows notification: **"Remuse started: Submit lab report."**
- The run page shows the steps ticking past, each with its proof line (for example "Lab5.pdf is attached, read back from
  the page").
- It finishes at **"Prepared. Waiting for you at Turn in."**
- A notification: **"Ready for you: Turn in Lab Report 5."** One click from James, and it turns it in.

**Side-by-side numbers** (our own measurements only):
- by hand: **[measure] s**
- Remuse: **[measure] s**
- AI model calls during the run: **[count]**

**Voice:**
> "It learned the chore once, so it runs it like code: same steps, every time. And it never presses Turn in, send or pay
> on its own. It gets everything ready, and I press it."

**On-screen labels:**
- **Muse Spark Open** (`meta-models/muse-spark-open-1026`, open weights): independently checks each step's result.

**Features:**
- [works] folder trigger, runs with Chrome closed, the approval gate, notifications, checker().
- [build] "turn in" added to the irreversible list.
- [verify] the Muse Spark Open key is set (Baseten). Without it the checker falls back to Muse Spark, and this label
  must not be shown.

### 5. The website changes, and it fixes itself (1:45–2:22)

**Picture:**
- A real change, not a mock. James runs the next file with the browser window snapped to half the screen, so
  Classroom's layout collapses (buttons turn into icons and menus).
- If Classroom shows a new popup or banner on recording day, that's fair to show too.
- The **Working it out** panel shows one line per attempt, each with a before/after picture and a proof label:
  - *Goal: attach Lab6.pdf to "Lab Report 6".*
  - *"Add or create" isn't where it was. The window is narrow.*
  - *Idea 1: the button by its label. ✗ not on the page.*
  - *Idea 2: the "+" menu with the same job. ✓*
  - *Lab6.pdf attached, read back from the page.*
- Then: *"Learned: next time I go straight there."*
- A second item with a value it must type gets a second read: *"Two readings agree: ₱451.00."* That shows in scene 6.

**Voice:**
> "Websites change. A script breaks, and an AI agent guesses. Remuse works it out toward the goal, and only believes it
> when the page proves it."

**On-screen labels:**
- **Muse Spark:** reasons through the ideas.
- **SAM 3.1:** outlines the proof in the picture.

**Features:**
- [build] diagnosis, the strategy ladder, attempt memory, proof labels, learned fixes, the live panel.
- [verify] which real change heals reliably in rehearsal (narrow window, a popup, a different class's layout). Keep
  whichever does.

### 6. Not just school (2:22–2:45)

**Picture:**
- A second chore, taught earlier: compare the same item on two stores, counting shipping and seller rating by James's
  spoken rule (*"cheapest after shipping, but only sellers rated 4.5 and up"*).
- Remuse opens both tabs, reads the prices, shows its pick and why.
- It fills the cart and stops at **Checkout: "Ready for you."**
- Cut to a Windows notification from the **hourly YouTube Studio report**, already running on its schedule: views and
  click-through rate since last hour.

**Voice:**
> "Same idea for any site I'm signed into: my classes, my shopping, my channel."

**Features:**
- [works] the compare step with your rule, the approval gate at checkout, the hourly schedule and its report.
- [verify] the stores used allow this in their terms, and "checkout" / "place order" are on the irreversible list.

### 7. Built on Meta (2:45–3:00)

**Picture:** one clean diagram:

```
Muse Voice Transcribe   hears you
Muse Spark              understands the demo, writes the rules, reasons when a step breaks
SAM 3.1                 sees your pen marks, outlines the proof
Muse Spark Open         (meta-models/muse-spark-open-1026, open weights) checks every result independently,
                        and reads each value a second time
        runs on your PC, in your signed-in browser · stops before anything irreversible
```

Then the title card: **Remuse: show it once.**

**Voice:**
> "Four Meta models, one assistant that learns from a single demo. Remuse. Show it once."

---

## Shot list

| # | Shot | Capture | Length | Needs |
|---|---|---|---|---|
| 1 | Montage of real chores | screen, 1080p | 8 s | real pages, no other AI products |
| 2 | Title card | edit | 3 s | logo |
| 3 | Shortcut → listening sidebar | screen + sidebar zoom | 4 s | [works] |
| 4 | Teaching in Classroom, talking | screen + mic | 25 s | [verify] file picker |
| 5 | Pen circle on the attachment | sidebar + page zoom | 4 s | [works] |
| 6 | Cards with quotes | sidebar zoom | 5 s | [works] |
| 7 | Spoken readback + question + voice answer | sidebar + audio | 15 s | [works] |
| 8 | Practice "That worked" | sidebar | 4 s | [works] |
| 9 | Folder trigger on | task card | 3 s | [works] |
| 10 | Close browser, drop file in folder | desktop | 5 s | [works] |
| 11 | Started notification | desktop | 2 s | [works] |
| 12 | Run page ticking with proof lines | run page | 10 s | [works]; proof labels [build] |
| 13 | Measured times + model-call count | edit overlay | 4 s | measure in rehearsal |
| 14 | "Ready for you: Turn in" → one click | notification + page | 6 s | [build] "turn in" gate |
| 15 | Narrow window run, Working it out panel | run page + page side by side | 25 s | [build] |
| 16 | "Learned: next time…" | run page | 3 s | [build] |
| 17 | Two stores, pick + why, stop at checkout | screen | 15 s | [verify] stores |
| 18 | YouTube Studio hourly notification | desktop | 4 s | [works], schedule on |
| 19 | Meta diagram | edit | 10 s | Open key [verify] |
| 20 | End card | edit | 3 s | |

## Before recording (Nov 4)

1. The self-healing build is done and tested (Nov 1–3).
2. "turn in", "checkout" and "place order" are on the irreversible list, with a test.
3. Classroom upload through Google's file picker is rehearsed on the real page.
4. James's school Google account is signed in to Remuse's browser through the normal sign-in (never by copying cookies).
5. The Muse Spark Open key works, so scene 4 and the diagram are true. If it doesn't, drop the Open labels and the bonus
   claim.
6. Times and model-call counts are measured in rehearsal, and only those numbers go on screen.
7. The stores in scene 6 are chosen and their terms checked.
8. No Facebook or Instagram automation anywhere (Meta's terms), and no other companies' AI products or logos.
