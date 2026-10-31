// Notes while you teach. The extension sends each thing you say, whole, as soon as you pause. It is transcribed
// (Muse Voice Transcribe), and Muse Spark updates the cards (notes.ts) from it and from what you did since the
// last one. One note-taking turn at a time, in order. Saying you're done ends the recording right away: it never
// waits behind the note-taking. Kept in memory: the real learning still runs on the whole recording when you stop,
// with these cards as what you said you want.
import { silent, transcribe, type Turn } from "./meta.ts";
import { applyOps, cancelPhrase, confirmEnd, endStrength, noteTake, type Card } from "./notes.ts";
import { IGNORED } from "./moments.ts";
import { eventLine } from "./understand.ts";

type Live = { turns: Turn[]; cards: Card[]; seen: number; chain: Promise<unknown>; pending: number; error: string | null; ending: string | null };
// ending: what you said that is ending the recording (shown as "Finishing" while it's checked and stopped).
export type LiveState = { turns: Turn[]; cards: Card[]; thinking: boolean; error: string | null; ending: string | null };
const live = new Map<string, Live>();
const of = (id: string) => live.get(id) ?? (live.set(id, { turns: [], cards: [], seen: 0, chain: Promise.resolve(), pending: 0, error: null, ending: null }), live.get(id)!);

export const liveState = (id: string): LiveState | null => { const l = live.get(id); return l ? { turns: l.turns, cards: l.cards, thinking: l.pending > 0, error: l.error, ending: l.ending } : null; };
export const endLive = (id: string) => live.delete(id);
/** The cards once every note-taking turn already asked for is done. */
export async function liveCards(id: string): Promise<Card[]> { const l = live.get(id); if (!l) return []; await l.chain; return l.cards; }

// The models, swappable so the checks can run without the network (test/live.check.ts).
const MODELS = { transcribe, noteTake, confirmEnd };

/** One thing you said, `atMs` into the recording. `control`: "done" when you said you're done teaching, "cancel" when
 *  you said to throw the recording away. */
export async function heard(id: string, wav: Uint8Array, atMs: number, session: () => { events: any[] }, models: Partial<typeof MODELS> = {}): Promise<{ text: string; control: "done" | "cancel" | null }> {
  const m = { ...MODELS, ...models };
  const l = of(id);
  let said: { transcript: string; turns: Turn[] };
  if (silent(wav)) return { text: "", control: null }; // nothing said: a model would make words up
  try { said = await m.transcribe(wav); } catch (e) { l.error = (e as Error).message; return { text: "", control: null }; }
  const text = said.transcript.trim();
  if (!text) return { text: "", control: null }; // a cough, a click, the room
  l.turns.push({ startMs: atMs + (said.turns[0]?.startMs ?? 0), endMs: atMs + (said.turns.at(-1)?.endMs ?? 0), text });

  // Done or never mind, said at the end: decided right here, never behind the note-taking queue. A clear "I'm done"
  // ends it at once; a loose "proceed" or "never mind" gets a quick check of its own. The words never become a note.
  const end = endStrength(text), cancel = !end && cancelPhrase(text);
  if (end === "strong") { l.ending = text; return { text, control: "done" }; }
  if (end === "weak" || cancel) {
    l.ending = text;
    if (await m.confirmEnd(text, cancel ? "cancel" : "done").catch(() => false)) return { text, control: cancel ? "cancel" : "done" };
    l.ending = null; // not meant that way: an ordinary sentence
  }

  l.pending++;
  l.chain = l.chain.then(async () => {
    // What you did since the last note, beside what you just said.
    const events = session().events;
    const fresh = events.filter((e) => e.id > l.seen && !IGNORED.has(e.kind));
    const tabs = new Map<unknown, string>();
    for (const e of events) if (e.tab != null && e.kind !== "page" && !IGNORED.has(e.kind) && !tabs.has(e.tab)) tabs.set(e.tab, `T${tabs.size + 1}`);
    const lines = fresh.map((e) => eventLine({ ...e, target: e.target && { ...e.target, selector: undefined } }, e.id, tabs));
    const r = await m.noteTake(l.cards, `said: "${text}"\n${lines.join("\n") || "(did nothing since the last one)"}`);
    if (fresh.length) l.seen = Math.max(l.seen, ...fresh.map((e) => e.id));
    l.cards = applyOps(l.cards, r.ops, new Set([...fresh.map((e) => e.id as number), ...l.cards.flatMap((c) => c.events ?? [])]));
    l.error = null;
  }).catch((e) => { l.error = (e as Error).message; }).finally(() => { l.pending--; });
  return { text, control: null };
}
