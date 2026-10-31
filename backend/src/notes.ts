// Notes while teaching. After each thing the person says, Muse Spark updates a few short cards (a step, a rule,
// a value to read, a question), each citing the words or the events it came from. Code keeps only cards that cite
// something real, so the sidebar never shows a step nobody did or said. Also: did they just say they're done?
import { askJson, text } from "./meta.ts";

export type Card = { id: string; kind: "step" | "rule" | "read" | "question"; text: string; quote?: string; events?: number[] }; // events: event DB ids
export type CardOp = { op: "add"; card: Omit<Card, "id"> } | { op: "edit"; id: string; card: Partial<Omit<Card, "id">> } | { op: "remove"; id: string };

// Said at the end of what they say: they're done showing. English and Tagalog. Clear ones end the recording at once;
// loose ones ("proceed" is also "let's proceed to the reach") get a quick check first.
export const CLEAR_END = ["i'm done", "im done", "i am done", "that's all", "thats all", "tapos na", "done showing"];
export const LOOSE_END = ["that's it", "thats it", "proceed", "go ahead", "you can start", "ayan na", "sige na", "okay remuse", "ok remuse", "done", "am done"]; // "done", "am done": a short "I'm done" heard slightly wrong
export const END_PHRASES = [...CLEAR_END, ...LOOSE_END];
const FILLER = new Set(["na", "now", "po", "please", "remuse", "okay", "ok"]);

// Said at the end of what they say: throw this recording away. English and Tagalog.
export const CANCEL_PHRASES = ["cancel", "cancel that", "cancel it", "never mind", "nevermind", "forget it", "throw it away", "scrap that", "huwag na", "wag na", "huwag na lang", "wag na lang"];
const NOT = new Set(["don't", "dont", "not", "never"]);

// Does the sentence end with one of these phrases (a stutter and a filler word or two after it are fine)?
function saidLast(said: string, phrases: string[]): boolean {
  let words = said.toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, " ").split(/\s+/).filter(Boolean)
    .filter((w, i, all) => w !== all[i - 1]); // a stutter or an echo in the transcript: "that's it. it."
  for (let strip = 0; strip <= 2 && words.length; strip++) {
    const s = words.join(" ");
    const p = phrases.find((x) => s === x || s.endsWith(` ${x}`));
    if (p) return !NOT.has(words[words.length - p.split(" ").length - 1] ?? ""); // "don't forget it" isn't "forget it"
    if (!FILLER.has(words.at(-1)!)) return false;
    words = words.slice(0, -1); // "tapos na po", "I'm done now"
  }
  return false;
}

/** Does this sentence end with "I'm done" (or the like)? Only at the end: "I'm done with this tab" doesn't count.
 *  A match is only a candidate: the note-taker confirms they meant the whole demo. */
export const endPhrase = (said: string) => saidLast(said, END_PHRASES);
/** "strong": clearly done, end now. "weak": maybe done, check quickly. null: not an end. */
export const endStrength = (said: string): "strong" | "weak" | null => (saidLast(said, CLEAR_END) ? "strong" : saidLast(said, LOOSE_END) ? "weak" : null);

/** A quick check, on its own (never behind the note-taking queue): did they mean they're done teaching, or that the
 *  recording should be thrown away? A few seconds at most; no answer counts as no. */
export async function confirmEnd(said: string, kind: "done" | "cancel"): Promise<boolean> {
  const ask = askJson<any>([text(`A person is teaching a browser task to an assistant by voice, and it is being recorded. They just said: "${said}". ${kind === "done"
    ? "Are they saying they have finished teaching and the recording should stop now? Not that they are done with a page, a tab, a field or one step."
    : "Are they saying to stop and throw this whole recording away? Not cancelling something on the page."} Reply with ONLY JSON: {"yes": true} or {"yes": false}`)], "end-check");
  const r = await Promise.race([ask, new Promise((ok) => setTimeout(() => ok(null), 8000))]).catch(() => null);
  return (r as any)?.yes === true;
}
/** Does it end with "cancel" / "never mind" / "huwag na"? Confirmed by the note-taker too: the recording is dropped. */
export const cancelPhrase = (said: string) => saidLast(said, CANCEL_PHRASES);

const KINDS = new Set(["step", "rule", "read", "question"]);
// A card counts only with words and something real behind it: their quote, or events that happened.
function clean(c: Card, known: Set<number>): Card | null {
  const out: Card = { id: c.id, kind: c.kind, text: String(c.text ?? "").trim() };
  const quote = String(c.quote ?? "").trim();
  const events = (Array.isArray(c.events) ? c.events : []).map(Number).filter((e) => known.has(e));
  if (quote) out.quote = quote;
  if (events.length) out.events = events;
  return out.text && KINDS.has(out.kind) && (out.quote || out.events) ? out : null;
}

/** Apply the note-taker's changes. `known`: the event ids it may cite. Anything it made up is dropped. */
export function applyOps(cards: Card[], ops: CardOp[], known: Set<number>): Card[] {
  const out = cards.map((c) => ({ ...c }));
  let next = Math.max(0, ...out.map((c) => Number(c.id.slice(1)) || 0));
  for (const o of ops) {
    if (o.op === "add") {
      const c = clean({ ...o.card, id: `c${next + 1}` } as Card, known);
      if (c) { out.push(c); next++; }
    } else if (o.op === "edit") {
      const i = out.findIndex((c) => c.id === o.id);
      const c = i >= 0 ? clean({ ...out[i], ...o.card, id: o.id } as Card, known) : null;
      if (c) out[i] = c;
    } else if (o.op === "remove") {
      const i = out.findIndex((c) => c.id === o.id);
      if (i >= 0) out.splice(i, 1);
    }
  }
  return out;
}

const PROMPT = `You are Remuse. A person is teaching you a browser task right now: they do it once and explain it out loud. You keep short notes ("cards") of what they want, shown to them while they're still going, so they can see you understood. Each new moment is one thing they just said, plus what they did since your last note.

A card: {"kind": "step" (something to do) | "rule" (a decision: if this, then that) | "read" (a value to read off the page) | "question" (something important you can't tell yet), "text": "short plain words, e.g. 'Open the Analytics tab', 'Read the views'", "quote": "their exact words it came from", "events": [the event #s it came from]}

Rules:
- Every card cites their words ("quote") or event #s from the moments. Never add a card from what is merely visible on the page, or for anything they didn't do or say.
- A click or typing with no words about it may become a "step" card citing its event #.
- Don't repeat: if the new moment continues or fixes a card, edit that card.
- If they correct themselves or you ("scratch that", "no, not that one"), edit or remove the card they mean and set "control" to "undo".
- At most one "question" card at a time, only when something important is unclear (which items, how often, what to do when...). Remove it once they answer.
- "control" is "done" only when they say they are finished teaching ("okay, that's it", "I'm done", "tapos na", "proceed"), not when they are done with a tab, a field or a page. The words that end the demo never become a card.
- "control" is "cancel" when they want the whole recording thrown away ("cancel", "never mind", "forget it", "huwag na"), not when they cancel something on the page (an order, a dialog).
- If the moment adds nothing new, reply with no ops.

Reply with ONLY JSON: {"ops": [{"op": "add", "card": {...}} | {"op": "edit", "id": "c2", "card": {<fields to change>}} | {"op": "remove", "id": "c3"}], "control": "done" | "cancel" | "undo" | null}`;

/** One note-taking turn: the cards so far and the newest moment in, changes and "did they say they're done" out. */
export async function noteTake(cards: Card[], momentText: string): Promise<{ ops: CardOp[]; control: "done" | "cancel" | "undo" | null }> {
  const list = cards.map((c) => `${c.id} [${c.kind}] ${c.text}${c.quote ? ` (said "${c.quote}")` : ""}${c.events?.length ? ` (events ${c.events.map((e) => `#${e}`).join(" ")})` : ""}`);
  const r = await askJson<any>([text(PROMPT), text(`Cards so far:\n${list.join("\n") || "(none yet)"}`), text(`New moment:\n${momentText}`)], "notes");
  const ops = Array.isArray(r?.ops) ? r.ops.filter((o: any) => o && ["add", "edit", "remove"].includes(o.op)) : [];
  return { ops, control: ["done", "cancel", "undo"].includes(r?.control) ? r.control : null };
}
