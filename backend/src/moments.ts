// A recording, cut into moments: one thing the person said, with what they did around it. Muse Spark reads a
// demo moment by moment, so it ties each step to the words and the clicks it came from instead of lining up a
// long mixed list by itself. Actions with no talking around them make their own ("silent") moments.
import type { Turn } from "./meta.ts";

export type Moment = { from: number; to: number; said: string | null; events: number[] }; // events: indexes into s.events

// Never part of a moment: where the mouse rested (old recordings) and the tools a page offers (listed on their own).
export const IGNORED = new Set(["point", "tools"]);

const BEFORE = 1000; // an action up to 1 s before a sentence starts belongs to it ("this one", click, then the words)
const AFTER = 4000; // and up to 4 s after it ends, unless the next sentence has started by then

export function moments(s: { events: any[]; turns: Turn[] }): Moment[] {
  // Tabs never clicked, typed or drawn in are other open tabs refreshing by themselves: left out.
  const used = new Set(s.events.filter((e) => e.kind !== "page" && !IGNORED.has(e.kind)).map((e) => e.tab));
  const kept = s.events.map((e, i) => ({ e, i })).filter(({ e }) => !IGNORED.has(e.kind) && (e.tab == null || used.has(e.tab))).sort((a, b) => a.e.t - b.e.t);
  const turns = [...s.turns].sort((a, b) => a.startMs - b.startMs);
  const windows = turns.map((v, k) => ({ lo: v.startMs - BEFORE, hi: Math.min(v.endMs + AFTER, k + 1 < turns.length ? turns[k + 1].startMs - BEFORE : Infinity) }));

  const spoken: Moment[] = turns.map((v) => ({ from: v.startMs, to: v.endMs, said: v.text, events: [] }));
  const silent = new Map<number, Moment>(); // by how many sentences had started before it, so a sentence splits them
  for (const { e, i } of kept) {
    const k = windows.findIndex((w) => e.t >= w.lo && e.t <= w.hi);
    const slot = turns.filter((v) => v.startMs <= e.t).length;
    let m = k >= 0 ? spoken[k] : silent.get(slot);
    if (!m) silent.set(slot, (m = { from: e.t, to: e.t, said: null, events: [] }));
    m.events.push(i);
    m.from = Math.min(m.from, e.t);
    m.to = Math.max(m.to, e.t);
  }
  return [...spoken, ...silent.values()].sort((a, b) => a.from - b.from);
}
