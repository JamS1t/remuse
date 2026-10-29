// Understand: Muse Spark reads the recording (events, key frames, transcript) and writes a Task Spec.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { askJson, text, png, type Part } from "./meta.ts";

export type Target = { role?: string; name?: string; selector?: string; fuzzy?: boolean };
export type Step = {
  id: string; do: "open_item" | "goto" | "click" | "fill" | "press" | "extract" | "compare" | "report";
  message?: string; // report only: what to tell the person, with {{variables}}
  url?: string; target?: Target; value?: string; key?: string; vars?: string[];
  describe: string; expect?: { urlIncludes?: string; textIncludes?: string; looks?: string };
  irreversible?: boolean; fromEvent?: number | null; healed?: string;
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
  scopeTypes: string[]; variables: Variable[]; steps: Step[]; rules: Rule[];
  outcomes: Record<string, { describe: string; steps: Step[]; reply?: string; demonstrated: boolean }>;
};

const SCHEMA = `{
  "title": "a short name for this task, 2-5 words, like a to-do item (e.g. \"Office supply run\", \"Answer refund requests\")",
  "goal": "one sentence",
  "scope": "which kinds of items these rules are meant for. Anything outside this must be asked about, not guessed.",
  "scopeTypes": ["the item_type options the rules are meant for; [] when items don't vary in kind"],
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
    { "id": "s1", "do": "open_item" | "goto" | "click" | "fill" | "press" | "extract" | "compare" | "report",
      "message": "report only: the update to give the person, with {{variables}}",
      "url": "goto only, may contain {{var}}",
      "target": { "role": "...", "name": "...", "selector": "..." },
      "value": "fill only, use {{var}} for anything that changes per item",
      "key": "press only, e.g. Enter",
      "vars": ["extract: variables to read on the current page. compare: the candidate variables read on each result"],
      "resultEvent": <compare only: event # of the click that opened one result in the demo>,
      "max": <compare only: how many results to compare, default 5>,
      "said": "compare only: the person's own words for what makes one result better",
      "describe": "short plain sentence",
      "expect": { "urlIncludes": "optional, may use {{var}}", "textIncludes": "optional, may use {{var}}", "looks": "what the screen should show after this step" },
      "irreversible": false,
      "tool": { "name": "optional: a WebMCP tool the page offered that does this same action", "args": { "<param>": "value or {{var}}" } },
      "fromEvent": <event # this step came from, or null> }
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
- Kinds of items: if the items in a "list" can be of different kinds that need different handling (types of request, categories), add a judge variable named "item_type" on the item page with the kinds the rules handle, other kinds you can foresee, and "other". "scopeTypes" lists only the kinds the rules are meant for; anything else makes the robot ask the person. Be strict: asking is cheap, a wrong action is not. Skip item_type when every item is the same kind of thing.
- "rules" come from what the person SAID, in their order; first match wins. Quote their words in "said". Write conditions with the variable names. If they gave a fallback ("otherwise ..."), make it the last rule with "if": "otherwise". If the only decision is "do it" (e.g. buy the best one), use one rule {"if": "otherwise", "then": "<that outcome>"}; add a rule like "if candidates_found is 0 then skip" when nothing qualified.
- One outcome per distinct action, with short snake_case keys. Do not add an "ask" outcome; the robot asks by itself. An outcome may have no steps ("skip").
- Outcome steps run right after the last main step, on whatever page it left open. If an outcome acts on a different page, its first step is a "goto" to that page, with {{variables}} in the URL.
- Free text the person typed (notes, messages, replies) must work for any item: rewrite it generically with {{variables}}. If an outcome sends a message, put the text in "reply" and fill it with "{{reply}}".
- For outcomes NOT demonstrated, write the steps you can infer from what was visible on screen and set "demonstrated": false.
- Mark "irreversible": true on any step that pays, buys, checks out, places an order, sends a message, submits, refunds, books, transfers or deletes. Adding to a cart is not irreversible; checking out is.
- Built-in variables: {{item_url}} (list items), {{today}} (YYYY-MM-DD), {{reply}}.
- Every step gets an "expect" so the robot can check its own work.
- Reports: when the person wants to be told something (an update, a summary, an alert), the outcome ends with a "report" step. Its "message" is short and readable, with {{variables}}, e.g. "Views {{views}} ({{views_change}} since last time), CTR {{ctr}}%". Reports are not irreversible. Read every number they mentioned with extract steps.
- Changes since last time: {{prev_<name>}} holds a variable's value from the previous run of this task (null on the first run). For "how much did X change", add a computed variable like ctr_change from ctr and prev_ctr: a string with a sign, e.g. "+0.6" or "-1.2", and null when prev_ctr is null. In the report message put changes in parentheses, e.g. "CTR {{ctr}} ({{ctr_change}} since last time)"; that part is left out automatically when there is no previous value.
- Schedule: if the person said how often ("every hour", "every morning at 9"), fill "schedule". Don't invent one.
- WebMCP: "tools" lines list actions a page offers to agents directly. When a step does what one of those tools does (e.g. the Refund button and a refund_order tool), keep the step as recorded and add "tool" with the tool name and its args, using {{variables}}. The robot calls the tool when the page offers it and clicks otherwise.

Reply with ONLY the JSON object, in this shape:
${SCHEMA}`;

type Session = { id: string; title?: string; events: any[]; turns: { startMs: number; endMs: number; text: string }[] };

function eventLine(e: any, i: number) {
  const t = e.target ? ` target={role:${JSON.stringify(e.target.role)}, name:${JSON.stringify(e.target.label)}, selector:${JSON.stringify(e.target.selector)}}` : "";
  const v = e.value !== undefined ? ` value=${JSON.stringify(e.value)}` : "";
  const k = e.key ? ` key=${e.key}` : "";
  if (e.kind === "tools") return `#${i} tools url=${e.url} offered: ${(e.tools ?? []).map((x: any) => `${x.name}(${Object.keys(x.inputSchema?.properties ?? {}).join(", ")}): ${x.description ?? ""}`).join("; ")}`;
  return `#${i} t=${(e.t / 1000).toFixed(1)}s ${e.kind} url=${e.url}${t}${v}${k}`;
}

export function buildPrompt(s: Session, dir: string): Part[] {
  const parts: Part[] = [text(INSTRUCTIONS), text(`Task name given by the person: ${s.title ?? "(none)"}\n\nRecording, in time order. Voice lines are what the person said; frames are screenshots.`)];
  const items = [
    ...s.events.map((e, i) => ({ t: e.t, i, e })),
    ...s.turns.map((v) => ({ t: v.startMs, v })),
  ].sort((a, b) => a.t - b.t);
  let images = 0;
  let lastAction = -Infinity;
  for (const it of items) {
    if ("v" in it && it.v) { parts.push(text(`[voice ${(it.v.startMs / 1000).toFixed(1)}-${(it.v.endMs / 1000).toFixed(1)}s] "${it.v.text}"`)); continue; }
    const { e, i } = it as { e: any; i: number };
    parts.push(text(eventLine(e, i)));
    const isAction = e.kind === "click" || e.kind === "key";
    // Frames: before+after each action, and pages reached without one (typed URLs). Max 50 images per request.
    const frames: [string, string][] = [];
    if (isAction && e.before) frames.push(["before", e.before]);
    if ((isAction || e.kind === "start" || (e.kind === "page" && e.t - lastAction > 1500)) && e.after) frames.push(["after", e.after]);
    if (isAction) lastAction = e.t;
    for (const [when, f] of frames) {
      if (images >= 48) break;
      parts.push(text(`frame: event #${i}, ${when}`), png(readFileSync(join(dir, f))));
      images++;
    }
  }
  return parts;
}

export async function understand(s: Session, dir: string): Promise<Spec> {
  const spec = await askJson<Spec>(buildPrompt(s, dir), "understand");
  return normalize(spec, s);
}

// Fill in what code can know for sure instead of trusting the model.
export function normalize(spec: Spec, s: Session): Spec {
  // The recorded selector of one clicked item, minus its position, matches all its siblings.
  const generic = (sel?: string) => sel?.replace(/:nth-of-type\(\d+\)/g, "").replace(/:nth-child\(\d+\)/g, "");
  spec.inputs.source ??= spec.inputs.columns?.length ? "rows" : spec.inputs.itemEvent != null || spec.inputs.listUrl ? "list" : "once";
  if (spec.inputs.source === "list") {
    const ev = s.events[spec.inputs.itemEvent ?? -1];
    if (ev?.target?.selector) spec.inputs.itemSelector = generic(ev.target.selector);
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
  return spec;
}
