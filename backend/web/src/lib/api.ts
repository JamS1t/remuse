import { useCallback, useEffect, useState } from "react";

// Shapes mirror backend/src (runner.ts, understand.ts, server.ts).
export type Target = { role?: string; name?: string; selector?: string };
export type Step = { id: string; do: string; describe: string; tab?: string; target?: Target; value?: string; vars?: string[]; irreversible?: boolean; healed?: string; max?: number; said?: string; message?: string; file?: { folder: string | null; pick?: "next" | "newest" | "dated" }; tool?: { name: string; args: Record<string, string> } };
export type Variable = { name: string; kind: string; description: string; question?: string; demoValue?: unknown; candidate?: boolean };
export type Rule = { if: string; then: string; said?: string; learned?: boolean };
export type Spec = {
  title?: string; goal: string; scope: string; scopeTypes?: string[]; saveDownloads?: string | null;
  inputs: { source?: "list" | "rows" | "once"; listUrl?: string; itemName?: string; columns?: { name: string; describe: string; demoValue: string }[] };
  variables: Variable[]; steps: Step[]; rules: Rule[];
  outcomes: Record<string, { describe: string; steps: Step[]; reply?: string; demonstrated: boolean }>;
};
export type SpecRow = { id: number; sessionId: string; version: number; note?: string; spec: Spec; code?: string; tests?: { ok: boolean; name: string; detail?: string }[] };
export type SessionRow = { id: string; title?: string; started_at: number; events: number; latest_spec?: number };
export type SessionFull = {
  id: string; title?: string; started_at: number; transcribe_error?: string;
  events: { t: number; kind: string; url?: string; value?: string; before?: string; after?: string; target?: { role?: string; tag?: string; label?: string; text?: string } }[];
  turns: { startMs: number; endMs: number; text: string }[];
  specs: { id: number; version: number; note?: string }[];
};
export type LogLine = { at: number; msg: string; level: "info" | "ok" | "warn" | "error"; shot?: string };
export type ItemStatus = "waiting" | "running" | "approval" | "asking" | "done" | "skipped" | "failed";
export type Candidate = { url: string; title: string; vars: Record<string, unknown>; score: number | null; shot?: string; best?: boolean };
export type Item = { url: string; label: string; status: ItemStatus; outcome?: string; because?: string; expected?: string; decidedBy?: "rules" | "you" | "learned"; log: LogLine[]; candidates?: Candidate[]; report?: string };
export type Pending =
  | { kind: "approval"; item: number; step: string; target?: string; outcome?: string; because?: string; shot: string; healed?: string }
  | { kind: "ask"; item: number; question: string; options: string[]; shot: string }
  | { kind: "handoff"; item: number; step: string; problem: string; shot: string };
export type Run = {
  id: string; specId: number; status: "starting" | "running" | "done" | "failed" | "stopped";
  items: Item[]; current: number; pending: Pending | null; autoApprove: boolean;
  startedAt: number; endedAt?: number; error?: string; shot?: string; newSpecId?: number; visible?: boolean; trigger?: "you" | "schedule";
  heals: { step: string; from: string; to: string }[];
  learned: { requestType: string; outcome: string; note?: string }[];
  score?: { matched: number; total: number };
};
export type RunRow = { id: string; specId: number; status: Run["status"]; startedAt: number; items: number; score?: Run["score"] };

export async function api<T = any>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch("/api" + path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `The server answered ${res.status}`);
  return data;
}

export const isLive = (s: Run["status"]) => s === "starting" || s === "running";

/** Fetch, and refetch every `everyMs` while `keepPolling(data)` is true. */
export function useApi<T>(path: string | null, everyMs = 0, keepPolling: (d: T) => boolean = () => true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    if (!path) return;
    const load = () => api<T>(path).then(
      (d) => { if (!alive) return; setData(d); setError(null); if (everyMs && keepPolling(d)) timer = setTimeout(load, everyMs); },
      (e) => { if (alive) setError(e.message); },
    );
    load();
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, everyMs, tick]);
  return { data, error, reload };
}

export function useHash() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => { setHash(location.hash); window.scrollTo(0, 0); };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return hash.replace(/^#\/?/, "").split("/");
}

export const fmtWhen = (ms: number) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const fmtSecs = (ms: number) => (ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m ${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}s`);
export const timecode = (ms: number) => { const s = Math.floor(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };

/** A task: one recording, its newest Task Spec and what the sidebar/full view show about it. */
export type Task = {
  sessionId: string; title?: string | null; specId?: number | null; version?: number | null; built: boolean; goal?: string | null; itemName?: string | null;
  source?: "list" | "rows" | "once" | null; columns: { name: string; describe?: string; demoValue: string }[]; startedAt: number; endedAt?: number | null;
  learnStage?: "listening" | "understanding" | "building" | "ready" | "failed" | null; learnError?: string | null;
  rules: { if: string; then: string; said?: string }[]; guessed: string[]; steps: number; compares: boolean; checks: { passed: number; total: number };
  askedSchedule: { everyMinutes?: number; time?: string; days?: string; said?: string } | null;
  lastReport: { text: string; at: number; runId: string } | null;
  uploads: { folder: string | null; pick: "next" | "newest" | "dated" }[]; saveDownloads: string | null;
};
export type FolderRow = { id: string; name: string; path: string; count: number; latest: { name: string; modified: number } | null; ok: boolean };
export type ScheduleRow = { id: number; specId: number; sessionId: string; time: string; days: string; everyMinutes: number | null };
/** A run as Activity lists it. */
export type ActivityRun = {
  id: string; specId: number; sessionId: string; task: string | null; status: Run["status"]; startedAt: number; endedAt: number | null;
  items: number; done: number; error: string | null; waiting: boolean; report: string | null; score?: Run["score"];
};

export const ago = (ms: number) => {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return fmtWhen(ms);
};
