// Following along while you record. The extension sends your voice in short pieces; each is transcribed
// (Muse Voice Transcribe) and Muse Spark updates its draft of the task (understand.draft), so the sidebar
// shows what Remuse heard and understood while you're still talking. Kept in memory: the real learning
// still runs on the whole recording when you stop.
import { transcribe, type Turn } from "./meta.ts";
import { draft, type Draft } from "./understand.ts";

type Live = { turns: Turn[]; draft: Draft | null; drafting: boolean; again: boolean; error: string | null };
const live = new Map<string, Live>();
const of = (id: string) => live.get(id) ?? (live.set(id, { turns: [], draft: null, drafting: false, again: false, error: null }), live.get(id)!);

export const liveState = (id: string) => { const l = live.get(id); return l ? { turns: l.turns, draft: l.draft, drafting: l.drafting, error: l.error } : null; };
export const endLive = (id: string) => live.delete(id);

/** A piece of voice that started `atMs` into the recording. */
export async function hear(id: string, wav: Uint8Array, atMs: number, session: () => { id: string; events: any[] }) {
  const l = of(id);
  const { turns } = await transcribe(wav);
  l.turns.push(...turns.filter((t) => t.text.trim()).map((t) => ({ startMs: t.startMs + atMs, endMs: t.endMs + atMs, text: t.text })));
  redraft(id, session);
}

// One draft at a time; if more came in meanwhile, draft once more after.
function redraft(id: string, session: () => { id: string; events: any[] }) {
  const l = live.get(id);
  if (!l) return;
  if (l.drafting) { l.again = true; return; }
  l.drafting = true;
  draft({ ...session(), turns: l.turns }, l.draft?.question ?? null)
    .then((d) => { l.draft = d; l.error = null; })
    .catch((e) => { l.error = (e as Error).message; })
    .finally(() => { l.drafting = false; if (l.again) { l.again = false; redraft(id, session); } });
}
