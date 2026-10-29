// Understand: Muse Spark reads the recording (events, key frames, transcript) and writes a Task Spec.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { askJson, text, png, type Part } from "./meta.ts";

export type Target = { role?: string; name?: string; selector?: string; fuzzy?: boolean };
export type Step = {
  id: string; do: "open_item" | "goto" | "click" | "fill" | "press" | "extract";
  url?: string; target?: Target; value?: string; key?: string; vars?: string[];
  describe: string; expect?: { urlIncludes?: string; textIncludes?: string; looks?: string };
  irreversible?: boolean; fromEvent?: number | null; healed?: string;
};
export type Variable = {
  name: string; kind: "text" | "vision" | "judge" | "computed"; description: string;
  demoValue?: unknown; question?: string; options?: string[]; from?: string[];
};
export type Rule = { if: string; then: string; said?: string; learned?: boolean };
export type Spec = {
  goal: string; scope: string;
  inputs: { listUrl: string; itemEvent: number; itemName: string; itemSelector?: string };
  scopeTypes: string[]; variables: Variable[]; steps: Step[]; rules: Rule[];
  outcomes: Record<string, { describe: string; steps: Step[]; reply?: string; demonstrated: boolean }>;
};

const SCHEMA = `{
  "goal": "one sentence",
  "scope": "which kinds of items these rules are meant for. Anything outside this must be asked about, not guessed.",
  "scopeTypes": ["the request_type options the rules are meant for"],
  "inputs": { "listUrl": "page with the list of items", "itemEvent": <event # of the click that opened the item>, "itemName": "email" },
  "variables": [
    { "name": "snake_case", "kind": "text" | "vision" | "judge" | "computed",
      "description": "what it is and where it is on the page",
      "demoValue": <the value in this demo>,
      "question": "vision: a yes/no question about an image on the page. judge: the question to answer from the page text",
      "options": ["judge only: the allowed answers; always include \\"other\\""],
      "from": ["computed only: the variables it is computed from"] }
  ],
  "steps": [
    { "id": "s1", "do": "open_item" | "goto" | "click" | "fill" | "press" | "extract",
      "url": "goto only, may contain {{var}}",
      "target": { "role": "...", "name": "...", "selector": "..." },
      "value": "fill only, use {{var}} for anything that changes per item",
      "key": "press only, e.g. Enter",
      "vars": ["extract only: variables to read on the current page"],
      "describe": "short plain sentence",
      "expect": { "urlIncludes": "optional, may use {{var}}", "textIncludes": "optional, may use {{var}}", "looks": "what the screen should show after this step" },
      "irreversible": false,
      "fromEvent": <event # this step came from, or null> }
  ],
  "rules": [ { "if": "condition in plain words using variable names", "then": "<outcome key>", "said": "the user's own words" } ],
  "outcomes": {
    "<outcome key>": { "describe": "...", "steps": [ <steps, same shape> ], "reply": "reply text with {{var}} placeholders", "demonstrated": true | false }
  }
}`;

const INSTRUCTIONS = `You are Showrun. A person recorded themselves doing a browser task once while explaining their reasoning out loud. Turn the recording into a Task Spec that a browser robot will run on every other item in the same list.

Rules for the spec:
- "steps" are what to do for EVERY item before deciding: open the item, look things up, and "extract" steps that read variables on the page they are on. Put an extract step right after the step that lands on the page holding those variables.
- Copy each target's role, name and selector from the event log exactly. If the name or a typed value was this item's data (an order number, a tracking number, a customer name), replace it with {{variable}}.
- Variable kinds: "text" = read from the page text by code (order numbers, dates, statuses). "vision" = yes/no about an image on the page (e.g. does the photo show damage); its value is true/false. "judge" = classify the page text into one of "options" (always include "other"). "computed" = derived in code from other variables (e.g. days_since_order from order_date and today).
- Always add a judge variable named "request_type" on the item page, so items outside the scope can be detected and asked about. Its options: the kinds of request the rules handle, plus other kinds you can foresee for this list (for complaints: wrong_item, exchange), plus "other".
- "scopeTypes" lists only the request_type options the person's rules are meant for: the demonstrated kind, kinds their rules name, and for an "otherwise" fallback the kind of request that fallback answers (e.g. "otherwise refund" covers plain refund requests). A request for something no rule gives (e.g. sending a different item) is out of scope. Be strict: out of scope means the robot asks the person, which is cheap; a wrong action is not.
- "rules" come from what the person SAID, in their order; first match wins. Quote their words in "said". Write conditions with the variable names. If they gave a fallback ("otherwise ..."), make it the last rule with "if": "otherwise".
- One outcome per distinct action in the rules, using short snake_case keys (e.g. "replace", "refund", "lost_refund", "decline"). Do not add an "ask" outcome; the robot asks by itself.
- Outcome steps run right after the last main step, on whatever page it left open. If an outcome acts on a different page, its first step must be a "goto" to that page, with {{variables}} in the URL (like the page the person went back to in the demo).
- Free text the person typed (notes, reasons) must work for any item: rewrite it generically, with {{variables}}.
- Outcome steps finish the item: the demonstrated outcome copies what the person did after deciding. For outcomes NOT demonstrated, write the steps you can infer from what was visible on screen (e.g. a Refund button next to the Replace button) and set "demonstrated": false.
- Every outcome that should answer the customer ends with steps that open the item ("open_item"), fill the reply box with "{{reply}}" and click send. "reply" is the message text for that outcome, written like the person's demo reply, with {{variables}} for names and numbers.
- Mark "irreversible": true on any step that refunds, replaces, sends, pays, submits or deletes.
- Built-in variables you may use: {{item_url}}, {{today}} (YYYY-MM-DD), {{reply}}.
- Every step gets an "expect" so the robot can check its own work.

Reply with ONLY the JSON object, in this shape:
${SCHEMA}`;

type Session = { id: string; title?: string; events: any[]; turns: { startMs: number; endMs: number; text: string }[] };

function eventLine(e: any, i: number) {
  const t = e.target ? ` target={role:${JSON.stringify(e.target.role)}, name:${JSON.stringify(e.target.label)}, selector:${JSON.stringify(e.target.selector)}}` : "";
  const v = e.value !== undefined ? ` value=${JSON.stringify(e.value)}` : "";
  const k = e.key ? ` key=${e.key}` : "";
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
  const ev = s.events[spec.inputs?.itemEvent];
  if (ev?.target?.selector) spec.inputs.itemSelector = ev.target.selector.replace(/:nth-of-type\(\d+\)/g, "");
  if (ev?.url && !spec.inputs.listUrl) spec.inputs.listUrl = ev.url;
  const all = [...spec.steps, ...Object.values(spec.outcomes ?? {}).flatMap((o) => o.steps)];
  all.forEach((st, i) => { st.id ||= `s${i + 1}`; });
  return spec;
}
