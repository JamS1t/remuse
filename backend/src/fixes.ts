// What Remuse keeps from a fix it worked out itself. A fix is proposed once its step is proven, learned once its whole
// item finishes, tried first on later runs, and dropped after failing twice in a row. Fixes live beside the task
// (never written into what you taught), so they can be shown and undone. Pure: test/fixes.check.ts.
export type FixMove = { strategy: string; role?: string; name?: string; selector?: string; keys?: string[] };
export type Fix = { id?: number; task: string; group: string; move: FixMove; state: "proposed" | "learned"; fails: number; provenAt?: number };

/** A proposed fix becomes learned when the item it was found on finished, proven. */
export const promote = (f: Fix, itemVerified: boolean): Fix => (itemVerified ? { ...f, state: "learned", fails: 0, provenAt: Date.now() } : f);
/** It didn't work this time: counted; a second failure in a row drops it (null). */
export const failed = (f: Fix): Fix | null => (f.fails + 1 >= 2 ? null : { ...f, fails: f.fails + 1 });
/** It worked again: the count starts over. */
export const worked = (f: Fix): Fix => ({ ...f, fails: 0, provenAt: Date.now() });
