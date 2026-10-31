// Understand: Muse Spark reads the recording (events, key frames, transcript) and writes a Task Spec.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { askJson, text, png, type Part } from "./meta.ts";
import { IGNORED, moments } from "./moments.ts";
import { checkEvidence, type Question } from "./evidence.ts";
import type { Card } from "./notes.ts";

export type Target = { role?: string; name?: string; selector?: string; fuzzy?: boolean };
export type Step = {
  id: string; do: "open_item" | "goto" | "click" | "fill" | "press" | "extract" | "compare" | "report" | "upload";
  message?: string;
  // upload only: which file to send from one of the person's allowed folders.
  file?: { folder: string | null; pick?: "next" | "newest" | "dated"; ext?: string[] }; // report only: what to tell the person, with {{variables}}
  url?: string; target?: Target; value?: string; key?: string; vars?: string[];
  // Which browser tab this step happens in, by a name for what the tab is for ("inbox", "sheet"). Unset = the current tab.
  tab?: string;
  describe: string; expect?: { urlIncludes?: string; textIncludes?: string; looks?: string };
  irreversible?: boolean; fromEvent?: number | null; healed?: string;
  // What this step came from: the events it repeats (indexes into the recording) and the person's words.
  evidence?: { events: number[]; quote?: string };
  account?: string; // the Google/YouTube account this step was done as in the demo (from its event)
  // The page's own WebMCP tool for this action: used when the page offers it, else the robot clicks.
  tool?: { name: string; args: Record<string, string> };
  // compare only: open the top `max` results on this page, read `vars` on each, keep the best by the person's rule.
  resultEvent?: number; resultSelector?: string; resultHref?: string; max?: number; said?: string;
};
export type Variable = {
  name: string; kind: "text" | "vision" | "judge" | "computed"; description: string;
  demoValue?: unknown; question?: string; options?: string[]; from?: string[];
  candidate?: boolean; // read on each compared result, not on the item
};
export type Rule = { if: string; then: string; said?: string; learned?: boolean };
// Where the items come from: links on a page ("list"), rows the person gives each run ("rows"), or
// nothing at all: the task runs once by itself, like a check or an update ("once").
export type Inputs = {
  source?: "list" | "rows" | "once"; itemName: string;
  listUrl?: string; itemEvent?: number; itemSelector?: string;
  columns?: { name: string; describe: string; demoValue: string }[];
};
export type Spec = {
  title?: string; goal: string; scope: string;
  inputs: Inputs;
  // How often the person said to repeat it, if they did.
  schedule?: { everyMinutes?: number; time?: string; days?: string; said?: string };
  // An allowed folder (by name) where every file the task downloads is saved, or null.
  saveDownloads?: string | null;
  // Google apps can be signed in as several accounts at once: the one each site (host) was used as in the demo, or,
  // for a site used as several, all of them (each step then carries its own account when known).
  accounts?: Record<string, string>; accountSets?: Record<string, string[]>;
  scopeTypes: string[]; variables: Variable[]; steps: Step[]; rules: Rule[];
  outcomes: Record<string, { describe: string; steps: Step[]; reply?: string; demonstrated: boolean }>;
  // What Remuse wasn't sure about after learning, asked out loud one at a time in the review.
  questions?: Question[];
};

const SCHEMA = `{
  "title": "a short name for this task, 2-5 words, like a to-do item (e.g. \"Office supply run\", \"Answer refund requests\")",
  "goal": "one sentence",
  "scope": "which kinds of items these rules are meant for. Anything outside this must be asked about, not guessed.",
  "scopeTypes": ["the item_type options the rules are meant for; [] when items don't vary in kind"],
  "saveDownloads": "the allowed folder's name to keep downloaded files in, or null",
  "schedule": "optional, only if the person said how often: { \"everyMinutes\": 60, \"said\": \"every hour\" } or { \"time\": \"HH:MM\", \"days\": \"12345\" (1=Mon..7=Sun), \"said\": \"...\" }",
  "inputs": {
    "source": "list" | "rows" | "once",
    "itemName": "what one item is, singular: email, order, shopping list item, invoice...",
    "listUrl": "list only: page with the list of items",
    "itemEvent": <list only: event # of the click that opened the item>,
    "columns": [ { "name": "rows only: snake_case", "describe": "what goes in this column", "demoValue": "the value used in the demo" } ]
  },
  "variables": [
    { "name": "snake_case", "kind": "text" | "vision" | "judge" | "computed",
      "description": "what it is and where it is on the page",
      "demoValue": <the value in this demo>,
      "question": "vision: a yes/no question about an image on the page. judge: the question to answer from the page text",
      "options": ["judge only: the allowed answers; always include \\"other\\""],
      "from": ["computed only: the variables it is computed from"],
      "candidate": true | false }
  ],
  "steps": [
    { "id": "s1", "do": "open_item" | "goto" | "click" | "fill" | "press" | "extract" | "compare" | "report" | "upload",
      "file": { "folder": "upload only: the allowed folder's name, or null", "pick": "next" | "newest" | "dated", "ext": ["optional file types, e.g. jpg, mp4"] },
      "message": "report only: the update to give the person, with {{variables}}",
      "url": "goto only, may contain {{var}}",
      "target": { "role": "...", "name": "...", "selector": "..." },
      "value": "fill only, use {{var}} for anything that changes per item",
      "key": "press only, e.g. Enter, Tab, Control+End",
      "vars": ["extract: variables to read on the current page. compare: the candidate variables read on each result"],
      "resultEvent": <compare only: event # of the click that opened one result in the demo>,
      "max": <compare only: how many results to compare, default 5>,
      "said": "compare only: the person's own words for what makes one result better",
      "tab": "only when the task uses more than one tab: a short name for what this tab is for, e.g. \"inbox\", \"sheet\", \"store\"",
      "describe": "short plain sentence",
      "expect": { "urlIncludes": "optional, may use {{var}}", "textIncludes": "optional: words that are always there after this step (a heading, label or tab name), may use {{var}}; never a number or value that changes between runs (a count, %, duration, date, price, this item's own data)", "looks": "what the screen should show after this step" },
      "irreversible": false,
      "tool": { "name": "optional: a WebMCP tool the page offered that does this same action", "args": { "<param>": "value or {{var}}" } },
      "evidence": { "events": [<the event #s this step repeats>], "quote": "<the person's words it came from, if they said it>" } }
  ],
  "rules": [ { "if": "condition in plain words using variable names", "then": "<outcome key>", "said": "the user's own words" } ],
  "outcomes": {
    "<outcome key>": { "describe": "...", "steps": [ <steps, same shape> ], "reply": "optional message text with {{var}} placeholders", "demonstrated": true | false }
  }
}`;

const INSTRUCTIONS = `You are Remuse. A person recorded themselves doing a browser task once, on any website, while explaining their reasoning out loud. Turn the recording into a Task Spec that a browser robot will repeat on new items.

Where items come from ("inputs.source"):
- "list": the person opened one item from a list on a page (emails, orders, tickets, listings) and the robot should do the same for every item in that list. Set listUrl and itemEvent.
- "rows": the task starts from values the person brought (a product to buy, a name to look up, a form to fill), so next time the robot needs a new value for each run. Make one column per value that changes per item, with what they typed in the demo as demoValue, and use {{column_name}} wherever it was typed or appeared in a URL. A shopping list, a list of names, a CSV are all "rows".
- "once": there is nothing to go through. The task is a check, an update or a report on the same pages each time (e.g. "every hour tell me my video's views, CTR and average view duration"). It runs as a single item; start with a "goto" to the first page the person opened.

Rules for the spec:
- "steps" are what to do for EVERY item before deciding. For "list", the first step is "open_item". For "rows", start with a "goto" to where the person started. Put an "extract" step right after the step that lands on the page holding those variables.
- Copy each target's role, name and selector from the event log exactly. If a name or typed value was this item's data (a product name, order number, customer name), replace it with {{variable}} or {{column}}.
- Variable kinds: "text" = read from the page text by code (numbers, prices, dates, statuses, names). "vision" = yes/no about an image on the page; its value is true/false. "judge" = classify the page text into one of "options" (always include "other"). "computed" = derived in code from other variables (e.g. days_since_order from order_date and today, price_per_unit from price and pack_size).
- Comparing: if the person looked at several results (search results, listings, offers) and picked one, add ONE "compare" step on the results page instead of the individual clicks. Its "vars" are the variables read on each result (mark them "candidate": true; computed ones like price_per_unit may be candidates too), "resultEvent" is the click that opened a result, and "said" is how they said they choose. After a compare step the robot is on the best result's page, and every candidate variable is also available as best_<name>, plus best_url and best_title, and candidates_found (a number). Steps after it act on the chosen result.
- Kinds of items: if the items in a "list" can be of different kinds that need different handling (types of request, categories), add a judge variable named "item_type" on the item page with the kinds the rules handle, other kinds you can foresee, and "other". "scopeTypes" lists only the kinds the rules are meant for; anything else makes the robot ask the person. Be strict: asking is cheap, a wrong action is not. Skip item_type when every item is the same kind of thing. Items that are messages from people (emails, tickets, chats, inquiries, complaints) usually vary in kind, even if the demo showed only one: add item_type for them, unless the person's words clearly cover every message the same way ("reply thanks to every email"), with the kinds of request the person's rules were said for in scopeTypes, plus the other kinds such messages commonly are (e.g. for complaints: damaged item, lost parcel, change of mind, wrong item received, late delivery, other). A rule like "otherwise refund" covers the kinds the person was talking about, not every message: a kind they never mentioned is asked about.
- "rules" come from what the person SAID, in their order; first match wins. Quote their words in "said". Write conditions with the variable names. If they gave a fallback ("otherwise ..."), make it the last rule with "if": "otherwise". If the only decision is "do it" (e.g. buy the best one), use one rule {"if": "otherwise", "then": "<that outcome>"}; add a rule like "if candidates_found is 0 then skip" when nothing qualified.
- One outcome per distinct action, with short snake_case keys. Do not add an "ask" outcome; the robot asks by itself. An outcome may have no steps ("skip").
- Outcome steps run right after the last main step, on whatever page it left open. If an outcome acts on a different page, its first step is a "goto" to that page, with {{variables}} in the URL.
- Free text the person typed (notes, messages, replies) must work for any item: rewrite it generically with {{variables}}. If an outcome sends a message, put the text in "reply" and fill it with "{{reply}}".
- For outcomes NOT demonstrated, write the steps you can infer from what was visible on screen and set "demonstrated": false.
- Mark "irreversible": true on any step that pays, buys, checks out, places an order, sends a message, submits, refunds, books, transfers or deletes. Adding to a cart is not irreversible; checking out is.
- Built-in variables: {{item_url}} (list items), {{today}} (YYYY-MM-DD), {{reply}}.
- Every step gets an "expect" so the robot can check its own work.
- Evidence: every step says what it came from. "evidence.events" lists the event #s of what the person did that the step repeats; goto, click, fill, press, upload, open_item and compare steps must cite at least one (a goto cites the start or page event that showed that page). "evidence.quote" is their words, when they said it. Never add a step the person didn't do or ask for, and never take one from a frame alone. Outcomes that weren't demonstrated are the only exception.
- Reports: when the person wants to be told something (an update, a summary, an alert), the outcome ends with a "report" step. Its "message" is short and readable, with {{variables}}, e.g. "Views {{views}} ({{views_change}} since last time), CTR {{ctr}}%". Reports are not irreversible. Read every number they mentioned with extract steps.
- Changes since last time: {{prev_<name>}} holds a variable's value from the previous run of this task (null on the first run). For "how much did X change", add a computed variable like ctr_change from ctr and prev_ctr: a string with a sign, e.g. "+0.6" or "-1.2", and null when prev_ctr is null. In the report message put changes in parentheses, e.g. "CTR {{ctr}} ({{ctr_change}} since last time)"; that part is left out automatically when there is no previous value.
- Uploading: an "upload" line means the person chose a file to upload. Keep the click that opened the file picker if there was one, then add {"do": "upload", "target": <the file input from the upload line>, "file": {...}}. "folder" is the allowed folder (listed below) whose files look like the one chosen; null if none fits (the person will pick one). "pick": "next" = the oldest file not uploaded yet, for a posting queue (the default); "newest" = whatever arrived most recently ("the latest file"); "dated" = the file whose name carries today's date and a time not later than now ("the one labelled for today"). After an upload step, {{file_name}} is the file's name and {{file_caption}} the text of a .txt file with the same name (null if none): use it for a caption or description box. Posting, sharing or publishing is irreversible.
- Downloads: if the person downloaded something they want kept, set "saveDownloads" to the allowed folder they meant; otherwise null.
- Schedule: if the person said how often ("every hour", "every morning at 9"), fill "schedule". Don't invent one.
- Tabs: event lines carry tab=T1, T2... when the person worked in more than one browser tab. A "tab" line is the person switching to another open tab; its frame shows that tab. Steps after it happen in that tab, and a tab they only read from or talked about still gets its steps (a goto, an extract). Then give EVERY step (main and outcome steps) a "tab": a short name for what that tab is for ("inbox", "sheet", "store", "x", "tiktok"), the same name each time the person returned to that tab. The robot keeps every tab open and switches between them, so a tab is found as it was left: don't repeat a "goto" when the person just switched back. The first step in a new tab is normally a "goto" to the page it showed first. If a click made the site open a new tab, give the following steps a new tab name and no "goto"; the robot follows the tab the site opened. Values read in any tab can be used in any other tab with {{variables}}, e.g. read an order number in "inbox" and type it in "store". If the person did the same thing on several sites (posting to several networks, checking several stores), keep one tab per site and keep the irreversible steps (post, pay, send) last, after everything is prepared in every tab.
- Spreadsheets (Google Sheets): the grid is drawn, not made of fields, so clicks on it say little; input and key lines carry cell=B2 (the cell typed into) and the voice and frames say what goes where. To write a cell: a "fill" step with target {"role":"textbox","name":"Name Box"} and the cell address as value, then "press" Enter with the same target, then a "fill" step with NO target and the value (it types into the selected cell), then "press" Enter or Tab with no target. When the person adds a new row each time (a log, a tracker), don't use a fixed row: fill the Name Box with "A1", press Enter on it, then "press" Control+End, Home and ArrowDown (each a step with no target) to land on the first empty row, then type each value with "press" Tab between them.
- Marks: a mark is the person circling or underlining something on purpose, drawn on the page ("on" is what's inside the circle or above the line; its frame shows the ink). Treat it like a click for knowing what to read or what a rule is about; don't turn a mark into a click step. Words like "this", "here", "that number" said around a mark mean the thing marked.
- WebMCP: "tools" lines list actions a page offers to agents directly. When a step does what one of those tools does (e.g. the Refund button and a refund_order tool), keep the step as recorded and add "tool" with the tool name and its args, using {{variables}}. The robot calls the tool when the page offers it and clicks otherwise.

Reply with ONLY the JSON object, in this shape:
${SCHEMA}`;

type Session = { id: string; title?: string; events: any[]; turns: { startMs: number; endMs: number; text: string }[]; cards?: Card[] };

export function eventLine(e: any, i: number, tabs: Map<unknown, string>) {
  const tab = tabs.size > 1 && tabs.has(e.tab) ? ` tab=${tabs.get(e.tab)}` : "";
  const t = e.target ? ` target={role:${JSON.stringify(e.target.role)}, name:${JSON.stringify(e.target.label)}, selector:${JSON.stringify(e.target.selector)}}` : "";
  const v = e.value !== undefined ? ` value=${JSON.stringify(e.value)}` : "";
  const k = (e.key ? ` key=${e.key}` : "") + (e.cell ? ` cell=${e.cell}` : "");
  if (e.kind === "upload") return `#${i} t=${(e.t / 1000).toFixed(1)}s upload${tab} url=${e.url}${t} files=${JSON.stringify((e.files ?? []).map((x: any) => x.name))}`;
  if (e.kind === "mark") return `#${i} t=${(e.t / 1000).toFixed(1)}s mark shape=${e.shape}${tab} url=${e.url} on=[${(e.targets ?? []).map((x: any) => `{role:${JSON.stringify(x.role)}, name:${JSON.stringify(x.label)}, text:${JSON.stringify(x.text)}}`).join(", ")}]${e.samPhrase ? ` sam=${JSON.stringify(e.samPhrase)} box=(${e.samBox?.x_min},${e.samBox?.y_min},${e.samBox?.x_max},${e.samBox?.y_max})` : ""}`;
  if (e.kind === "tools") return `#${i} tools${tab} url=${e.url} offered: ${(e.tools ?? []).map((x: any) => `${x.name}(${Object.keys(x.inputSchema?.properties ?? {}).join(", ")}): ${x.description ?? ""}`).join("; ")}`;
  return `#${i} t=${(e.t / 1000).toFixed(1)}s ${e.kind}${tab} url=${e.url}${t}${v}${k}`;
}

export type FolderHint = { name: string; files: string[] };
export function buildPrompt(s: Session, dir: string, folders: FolderHint[] = []): Part[] {
  const parts: Part[] = [text(INSTRUCTIONS), text(`Allowed folders (name: newest files): ${folders.length ? folders.map((f) => `\n- ${f.name}: ${f.files.join(", ") || "(empty)"}`).join("") : "none yet"}`), text(`Task name given by the person: ${s.title ?? "(none)"}\n\nThe recording, moment by moment, in time order. A moment is one thing the person said ("said") with what they did around it; a "silent" moment is what they did without talking. Event lines start with their event #; frames are screenshots.`)];
  // The notes taken live while they taught: what they said they want, in their words.
  if (s.cards?.length) {
    const at = new Map(s.events.map((e, i) => [e.id, i]));
    parts.push(text(`What the person said they want while teaching (notes taken live, each from their words or actions; follow these):\n${s.cards.map((c) => `- [${c.kind}] ${c.text}${c.quote ? ` (said "${c.quote}")` : ""}${c.events?.some((e) => at.has(e)) ? ` (events ${c.events.filter((e) => at.has(e)).map((e) => `#${at.get(e)}`).join(" ")})` : ""}`).join("\n")}`));
  }
  // Browser tabs as T1, T2... in the order the person first used them (clicked, typed or drew in).
  const tabs = new Map<unknown, string>();
  for (const e of s.events) if (e.tab != null && e.kind !== "page" && !IGNORED.has(e.kind) && !tabs.has(e.tab)) tabs.set(e.tab, `T${tabs.size + 1}`);
  // What pages offered to agents (WebMCP) isn't something the person did: listed once, before the moments.
  const offered = s.events.map((e, i) => ({ e, i })).filter(({ e }) => e.kind === "tools" && (e.tab == null || tabs.has(e.tab)));
  if (offered.length) parts.push(text(offered.map(({ e, i }) => eventLine(e, i, tabs)).join("\n")));
  let images = 0;
  let lastAction = -Infinity;
  moments(s).forEach((m, n) => {
    parts.push(text(`Moment ${n + 1} (${(m.from / 1000).toFixed(1)}-${(m.to / 1000).toFixed(1)}s) ${m.said != null ? `said: "${m.said}"` : "silent"}`));
    for (const i of m.events) {
      const e = s.events[i];
      parts.push(text(eventLine(e, i, tabs)));
      const isAction = e.kind === "click" || e.kind === "key";
      // Frames: before+after each action, and pages reached without one (typed URLs). Max 50 images per request.
      const frames: [string, string][] = [];
      if (isAction && e.before) frames.push(["before", e.before]);
      if (e.kind === "mark" && e.before) frames.push(["with the ink", e.before]);
      if ((isAction || e.kind === "start" || e.kind === "tab" || (e.kind === "page" && e.t - lastAction > 1500)) && e.after) frames.push(["after", e.after]);
      if (isAction) lastAction = e.t;
      for (const [when, f] of frames) {
        if (images >= 48) break;
        parts.push(text(`frame: event #${i}, ${when}`), png(readFileSync(join(dir, f))));
        images++;
      }
    }
  });
  return parts;
}

export async function understand(s: Session, dir: string, folders: FolderHint[] = []): Promise<Spec> {
  const spec = await askJson<Spec>(buildPrompt(s, dir, folders), "understand");
  // Before normalize, which reads each step's event (fromEvent) for the account it was done as.
  checkEvidence(spec, s.events);
  return normalize(spec, s);
}

/** Something the person said out loud while looking at a learned task, sorted by what they meant. */
/** `question`: what Remuse just asked out loud, when it's waiting for the answer. */
export async function sortSaid(spec: Spec, said: string, question?: string): Promise<{ intent: "change" | "approve" | "schedule" | "run" | "teach" | "answer" | "discard" | "stop" | "none"; schedule?: { everyMinutes?: number; time?: string; days?: string } }> {
  const r = await askJson<any>([text(`You are Remuse. You just learned a browser task from a person's demo and they're looking at your summary of it in a sidebar. The microphone is open, so what they say may be meant for you or for someone else in the room. They said: "${said}"

What do they mean? Pick one:${question ? `\n- "answer": you just asked them "${question}", and this answers it (yes, no, a choice, a value, a short reply). Prefer this over "change" and "approve" for anything that answers your question; "approve" is only for the whole task being right ("looks good", "that's it").` : ""}
- "change": they want something about the task different, added, removed or fixed ("no, take the views from the Reach tab", "also send me the subscribers", "skip the ones that are already done").
- "approve": it's right ("looks good", "yes that's it", "perfect", "okay").
- "schedule": they want it to repeat ("do this every hour", "every weekday at 9"). Give everyMinutes (15 to 1440) or time "HH:MM" (24h) and days ("1234567" = every day, "12345" = weekdays).
- "run": do it now ("try it", "go ahead and run it").
- "teach": they'll show it again or show something new ("let me show you again", "watch this").
- "discard": they want this task thrown away, not kept at all ("remove the task", "delete it", "cancel this", "never mind, forget it", "revert and go back to the dashboard", "huwag na").
- "stop": they're done talking to you for now, without approving or removing it ("stop listening", "that's all for now", "thanks", "okay bye").
- "none": not meant for you (talking to someone, thinking out loud, unrelated).

The task: ${spec.goal}. Steps: ${[...spec.steps, ...Object.values(spec.outcomes).flatMap((o) => o.steps)].map((s) => s.describe).join("; ")}.
Reply with ONLY JSON: {"intent": "...", "schedule": {"everyMinutes": n} or {"time": "HH:MM", "days": "..."} or null}`)], "sort-said");
  const intent = ["change", "approve", "schedule", "run", "teach", "discard", "stop", ...(question ? ["answer"] : []), "none"].includes(r?.intent) ? r.intent : "none";
  return { intent, schedule: intent === "schedule" && r?.schedule ? r.schedule : undefined };
}

/** The person says, in their own words, what's wrong with a learned task ("it read the wrong number",
 *  "only do posts from today", "put it in column C"). Muse Spark changes only that, and says what it changed
 *  in plain words. `lastRun` is what the task did last time, which is usually what they're reacting to. */
export async function revise(s: Session, spec: Spec, feedback: string, lastRun: string): Promise<{ spec: Spec; changes: string[] }> {
  const r = await askJson<{ spec: Spec; changes: string[] }>([
    text(`You are Remuse. A browser robot repeats a task it learned from a recording. Below is the Task Spec it follows, what it did on its last run, and the person's feedback in their own words. Update the Task Spec so the robot does what the person wants.

Rules:
- Change only what the feedback is about. Keep every other step, target, tab, rule, variable and outcome exactly as it is (same ids).
- The person isn't technical: read "the number", "that part", "the second one" against the steps and the last run to find what they mean.
- If they want something read differently, change the variable's "description" (and "demoValue" if they gave the right value), so the robot reads the right thing next time.
- If they want a new rule or a different decision, add or change a rule with "said" set to their words.
- New steps follow the same shape as the existing ones. Never remove an irreversible step's approval.

Reply with ONLY a JSON object: {"spec": <the full updated Task Spec, same shape as below>, "changes": ["<one short plain sentence per change, written to the person, e.g. 'I'll read the views from the Reach tab instead of Overview.'>"]}
The Task Spec shape is:
${SCHEMA}`),
    text(`Current Task Spec:\n${JSON.stringify(spec)}`),
    text(`Last run:\n${lastRun || "(it hasn't run yet)"}`),
    text(`The person's feedback: "${feedback}"`),
  ], "revise");
  if (!r?.spec?.steps || !r.spec.outcomes) throw new Error("Muse Spark didn't return an updated task");
  return { spec: normalize(r.spec, s), changes: Array.isArray(r.changes) ? r.changes.map(String).slice(0, 8) : [] };
}

// Fill in what code can know for sure instead of trusting the model.
export function normalize(spec: Spec, s: Session): Spec {
  // The recorded selector of one clicked item, minus its position, matches all its siblings.
  const generic = (sel?: string) => sel?.replace(/:nth-of-type\(\d+\)/g, "").replace(/:nth-child\(\d+\)/g, "");
  spec.inputs.source ??= spec.inputs.columns?.length ? "rows" : spec.inputs.itemEvent != null || spec.inputs.listUrl ? "list" : "once";
  if (spec.inputs.source === "list") {
    const ev = s.events[spec.inputs.itemEvent ?? -1];
    // Items that are links: siblings by selector. Items you click that aren't links (Discord posts, cards,
    // rows): siblings by their role, which survives the deep, class-less markup such apps use.
    const t = ev?.target;
    if (t?.selector) spec.inputs.itemSelector = !t.href && t.role && !["button", "link", "none", "presentation", "generic"].includes(t.role) ? `[role="${t.role}"]` : generic(t.selector);
    if (ev?.url && !spec.inputs.listUrl) spec.inputs.listUrl = ev.url;
  }
  const all = [...spec.steps, ...Object.values(spec.outcomes ?? {}).flatMap((o) => o.steps)];
  all.forEach((st, i) => {
    st.id ||= `s${i + 1}`;
    if (st.do === "compare") {
      st.max ??= 5;
      const ev = s.events[st.resultEvent ?? -1];
      st.resultSelector ??= generic(ev?.target?.selector);
      // The address opened in the demo: the next page event after the click, or the link itself.
      st.resultHref ??= ev?.target?.href ?? s.events.slice((st.resultEvent ?? 0) + 1).find((e) => e.kind === "page")?.url;
    }
  });
  spec.scopeTypes ??= [];
  // Which account each site was used as in the demo, from what the recorder saw (emails are case-insensitive; YouTube
  // IDs are not). One account on a site: kept for the site. Several: kept as a set, and each step gets its own.
  const ident = (a: unknown) => { const x = String(a); return x.includes("@") ? x.toLowerCase() : x; };
  const seen: Record<string, Set<string>> = {};
  for (const e of s.events) if (e?.account && e?.url) { try { (seen[new URL(e.url).host] ??= new Set()).add(ident(e.account)); } catch { /* not a web page */ } }
  const one = Object.entries(seen).filter(([, v]) => v.size === 1).map(([h, v]) => [h, [...v][0]]);
  const many = Object.entries(seen).filter(([, v]) => v.size > 1).map(([h, v]) => [h, [...v]]);
  if (one.length) spec.accounts = Object.fromEntries(one);
  if (many.length) spec.accountSets = Object.fromEntries(many);
  all.forEach((st) => { const e = st.fromEvent != null ? s.events[st.fromEvent] : null; if (e?.account) st.account = ident(e.account); });
  stableChecks(spec, all);
  return spec;
}

// A step's page check must hold on the next run too. "5.0%" or "3:04" (the demo's own numbers) stop matching as soon
// as they change, and then every run falls back to a screenshot look. Such a check keeps its longest stretch of fixed
// words, or, if it has none, the clicked label's; with neither, it is left to "looks".
const NUMBER = /[-+]?[$€£₱]?\d[\d,.:/%-]*\s*(?:%|[kKmM]\b)?/g;
export function stableChecks(spec: Spec, all: Step[]) {
  const values = [...(spec.variables ?? []).map((v) => v.demoValue), ...(spec.inputs.columns ?? []).map((c) => c.demoValue)]
    .filter((v) => v != null && typeof v !== "object").map((v) => String(v).trim()).filter((v) => v.length >= 2)
    .sort((a, b) => b.length - a.length); // longest first, so "2,595 views" goes before "2,595"
  const letters = (x: string) => (x.match(/\p{L}/gu) ?? []).length;
  const fixedPart = (x?: string) => {
    if (!x) return "";
    let cut = x;
    for (const v of values) cut = cut.split(v).join("\u0000");
    return cut.replace(NUMBER, "\u0000").split("\u0000").map((p) => p.replace(/^[\s:·•|,.()-]+|[\s:·•|,.()-]+$/g, "")).filter((p) => letters(p) >= 4).sort((a, b) => b.length - a.length)[0] ?? "";
  };
  for (const st of all) {
    let t = st.expect?.textIncludes;
    if (!t) continue;
    // This item's own value from your list is known before the step: check for the next item's value instead.
    for (const c of spec.inputs.columns ?? []) if (c.demoValue && String(c.demoValue).trim().length >= 2) t = t.split(String(c.demoValue).trim()).join(`{{${c.name}}}`);
    st.expect!.textIncludes = t;
    if (t.includes("{{")) continue;
    const changing = values.some((v) => t.toLowerCase().includes(v.toLowerCase())) || (letters(t) < 4 && /\d/.test(t));
    if (!changing) continue;
    const keep = fixedPart(t) || fixedPart(st.target?.name);
    if (keep) st.expect!.textIncludes = keep;
    else delete st.expect!.textIncludes;
  }
}
