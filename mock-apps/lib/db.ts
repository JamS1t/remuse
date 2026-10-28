import { buildSeed } from "./seed";

type State = ReturnType<typeof buildSeed> & {
  storeLayout: "v1" | "v2"; // v2 = redesigned store admin, for the "page changes mid-run" curveball
  log: { at: string; app: string; action: string; detail: string }[];
};

// ponytail: in-memory state on globalThis, survives hot reload, resets on server restart or POST /api/reset.
const g = globalThis as unknown as { __showrunMock?: State };

function fresh(): State {
  return { ...buildSeed(), storeLayout: "v1", log: [] };
}

export function db(): State {
  return (g.__showrunMock ??= fresh());
}

export function reset() {
  g.__showrunMock = fresh();
}

export function log(app: string, action: string, detail: string) {
  db().log.push({ at: new Date().toISOString(), app, action, detail });
}

export const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
// YYYY-MM-DD in Manila time, so "today" matches the demo machine.
export const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
