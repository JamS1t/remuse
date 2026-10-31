import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CircleHelp, Eye, LoaderCircle, RotateCcw, Split, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Lockup, Orb, useAction, type OrbState } from "@/components/bits";
import { api, useApi, type Card, type LiveState, type SessionFull, type SpecRow } from "@/lib/api";
import { ext } from "@/lib/bridge";
import { cn } from "@/lib/utils";

type Status = { recording: boolean; rec?: { id?: string; t0?: number; audioError?: string | null }; hearing?: boolean; last?: { id: string; byVoice?: boolean; discarded?: boolean; at?: number } | null };
export type TeachTask = { sessionId: string; specId?: number; title?: string; learnStage?: string | null; learnError?: string | null };
type Ev = SessionFull["events"][number] & { targets?: { label?: string; text?: string }[] };

const LEARNING = ["listening", "understanding", "building"];
const STAGE: Record<string, string> = {
  listening: "Listening back to all of it",
  understanding: "Writing the steps from what you did and said",
  building: "Writing your rules as code and checking them",
};
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// What you did, in a few words, for a note's "where this came from" line.
function did(e?: Ev): string | null {
  if (!e) return null;
  const name = e.target?.label ?? e.target?.text ?? e.targets?.[0]?.label ?? e.targets?.[0]?.text;
  if (e.kind === "click") return name ? `you clicked “${name}”` : "you clicked here";
  if (e.kind === "input") return e.value ? `you typed “${e.value}”` : "you typed here";
  if (e.kind === "key") return `you pressed ${e.key ?? "a key"}`;
  if (e.kind === "mark") return name ? `you marked “${name}”` : "you marked this";
  if (e.kind === "upload") return "you chose a file";
  if (e.kind === "page" || e.kind === "start") { try { const u = new URL(e.url!); return `you opened ${u.host}${u.pathname === "/" ? "" : u.pathname}`; } catch { return "you opened a page"; } }
  return null;
}

/** Teaching, full sidebar: Remuse on top, what it heard, and the notes it's taking, each with where it came from.
 *  Nothing else on screen. Stays through learning; the review takes over when the task is learned. */
export function TeachMode({ sessionId, task, onExit }: { sessionId: string; task?: TeachTask; onExit: () => void }) {
  const [st, setSt] = useState<Status | null>(null);
  const [keys, setKeys] = useState<{ teach?: string; pen?: string }>({});
  const { busy, run } = useAction();
  useEffect(() => { ext("keys").then(setKeys, () => {}); }, []);
  // The extension knows first: recording, and whether you're talking right now.
  useEffect(() => {
    let on = true;
    const tick = () => ext<Status>("status").then((s) => { if (on) setSt(s); }, () => {});
    tick();
    const t = setInterval(tick, 500);
    return () => { on = false; clearInterval(t); };
  }, []);

  const recording = !!st?.recording && st.rec?.id === sessionId;
  const stage = task?.learnStage ?? null;
  const learning = !!st && !recording && (stage == null || LEARNING.includes(stage));
  // Polls only while there's something new to see (useApi keeps its first keepPolling, so this goes by the interval).
  const busyNow = recording || learning;
  const live = useApi<LiveState>(`/sessions/${sessionId}/live`, busyNow ? 1500 : 0).data;
  const session = useApi<SessionFull>(`/sessions/${sessionId}`, busyNow ? 3000 : 0).data;
  const spec = useApi<SpecRow>(stage === "ready" && task?.specId ? `/specs/${task.specId}` : null).data;

  // Nothing was done: the Agent didn't keep it, so there's nothing to learn.
  const last = st?.last?.id === sessionId ? st.last : null;
  useEffect(() => { if (last?.discarded) { toast("Nothing was recorded, so I didn't keep it."); onExit(); } }, [last?.discarded]);
  // The shortcut follows what's on screen: it never starts a new recording over this one's review.
  useEffect(() => { ext("mode", { mode: recording ? "idle" : stage === "ready" ? "review" : stage === "failed" ? "idle" : "learning" }).catch(() => {}); }, [recording, stage]);
  useEffect(() => () => { ext("mode", { mode: "idle" }).catch(() => {}); }, []);

  const cards = live?.cards?.length ? live.cards : session?.cards ?? [];
  const events = (session?.events ?? []) as Ev[];
  const lastSaid = live?.turns?.at(-1)?.text;
  const secs = recording && st?.rec?.t0 ? Math.max(0, Math.floor((Date.now() - st.rec.t0) / 1000)) : 0;
  const justDone = !!last?.at && Date.now() - last.at < 1800 && !recording;

  const view: { orb: OrbState; word: string; sub?: string } =
    recording ? (st?.hearing ? { orb: "watching", word: "Hearing you" } : { orb: "watching", word: "Listening", sub: "Do the task once. Say why as you go." })
    : justDone ? { orb: "thinking", word: last?.byVoice ? "Got it, you're done" : "Got it" }
    : stage === "failed" ? { orb: "idle", word: "I couldn't learn that one", sub: task?.learnError ?? undefined }
    : stage === "ready" ? { orb: "done", word: "Learned", sub: task?.title }
    : { orb: "thinking", word: "Thinking", sub: (stage && STAGE[stage]) || "Getting ready" };

  const stop = () => run("stop", () => ext("stop"));
  const steps = spec?.spec ? [...spec.spec.steps, ...Object.values(spec.spec.outcomes).flatMap((o) => o.steps)] : [];

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 px-4">
        <Lockup className="h-[21px]" />
        {recording ? (
          <span className="ml-auto inline-flex items-center gap-2 font-mono text-[13px] tabular-nums text-muted-foreground">
            <span className="size-2 rounded-full bg-tally" aria-hidden />{clock(secs)}<span className="sr-only">recording</span>
          </span>
        ) : null}
      </header>

      <main className="flex-1 overflow-y-auto px-5 pb-6">
        <section className="flex flex-col items-center pt-8 text-center" aria-live="polite">
          <Orb state={view.orb} size={104} />
          <h1 className={cn("mt-7 text-[28px] leading-[1.1] font-medium tracking-[-0.025em] text-balance", view.word === "Thinking" && "shimmer")}>{view.word}</h1>
          {view.sub ? <p className="mt-2.5 max-w-[32ch] text-[14px] leading-snug text-muted-foreground text-pretty">{view.sub}</p> : null}
          {recording && st?.rec?.audioError ? <p className="mt-3 text-[13px] text-warn">No voice: {st.rec.audioError}</p> : null}
        </section>

        {/* What it heard last, in your words, large enough to read from across the desk. */}
        {(recording || learning) && (st?.hearing || lastSaid) ? (
          <div className="mx-auto mt-7 max-w-[34ch] text-center">
            {recording && st?.hearing && !lastSaid ? <p className="shimmer text-[15px]">Hearing you…</p> : (
              <q key={live?.turns?.length} className="block font-script text-[19px] leading-[1.4] text-foreground/90 [quotes:'“''”'] animate-in fade-in duration-500 line-clamp-4">{lastSaid}</q>
            )}
          </div>
        ) : null}

        {stage === "ready" && steps.length ? (
          <section className="mt-10">
            <h2 className="mb-3 text-[13px] font-medium text-muted-foreground">What I'll do</h2>
            <ol className="space-y-3">
              {steps.map((s, i) => (
                <li key={s.id ?? i} className="grid grid-cols-[1.5rem_1fr] gap-x-2 text-[15px] leading-snug">
                  <span className="pt-px text-right font-mono text-[12px] leading-[1.6] tabular-nums text-muted-foreground">{i + 1}</span>
                  <span>{s.describe}</span>
                </li>
              ))}
            </ol>
          </section>
        ) : (
          <Notes cards={cards} events={events} recording={recording} />
        )}
      </main>

      <footer className="shrink-0 border-t border-rule bg-background/85 px-4 pt-3 pb-4 backdrop-blur-md">
        {recording ? (
          <>
            <Button size="lg" variant="outline" onClick={stop} disabled={busy === "stop"} className="h-11 w-full rounded-full border-tally/40 bg-tally/10 text-[15px] hover:bg-tally/20">
              {busy === "stop" ? <LoaderCircle className="animate-spin" /> : <Square className="size-3 fill-tally text-tally" />}Stop, I've shown you
            </Button>
            <p className="mt-2.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
              <span>or say “I'm done”</span>
              {keys.teach ? <span className="inline-flex items-center gap-1.5"><Kbd>{keys.teach}</Kbd>stop</span> : null}
              {keys.pen ? <span className="inline-flex items-center gap-1.5"><Kbd>{keys.pen}</Kbd>draw</span> : null}
            </p>
          </>
        ) : stage === "failed" ? (
          <div className="flex gap-2">
            <Button className="flex-1 rounded-full" onClick={() => run("relearn", () => api(`/sessions/${sessionId}/learn`, "POST"))} disabled={!!busy}><RotateCcw />Try again</Button>
            <Button variant="ghost" className="rounded-full" onClick={onExit}>Close</Button>
          </div>
        ) : stage === "ready" ? (
          <Button className="h-11 w-full rounded-full text-[15px]" onClick={onExit}>Looks right</Button>
        ) : (
          <p className="py-1.5 text-center text-[13px] text-muted-foreground">Learning from your demo. This takes about a minute.</p>
        )}
      </footer>
    </div>
  );
}

const ICON = { read: Eye, rule: Split, question: CircleHelp } as const;

/** The notes, each with where it came from: your words, or what you did. */
function Notes({ cards, events, recording }: { cards: Card[]; events: Ev[]; recording: boolean }) {
  const byId = new Map(events.map((e) => [e.id, e]));
  let n = 0;
  return (
    <section className="mt-10">
      <h2 className="mb-3 flex items-baseline gap-2 text-[13px] font-medium text-muted-foreground">
        What I've noted{cards.length ? <span className="font-mono tabular-nums">{cards.length}</span> : null}
      </h2>
      {!cards.length ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-5 text-center text-[14px] leading-snug text-muted-foreground">
          {recording ? "Each step shows up here as you do it and say it." : "Nothing noted."}
        </p>
      ) : (
        <ol className="space-y-4">
          {cards.map((c) => {
            const Icon = c.kind === "step" ? null : ICON[c.kind];
            const where = c.quote ? null : (c.events ?? []).map((id) => did(byId.get(id))).find(Boolean);
            return (
              <li key={c.id} className="grid grid-cols-[1.5rem_1fr] gap-x-2 animate-in fade-in slide-in-from-bottom-1 duration-500">
                <span className="flex justify-end pt-[3px] text-muted-foreground" aria-label={c.kind}>
                  {Icon ? <Icon className="size-4" strokeWidth={2} /> : <span className="font-mono text-[12px] leading-[1.6] tabular-nums">{++n}</span>}
                </span>
                <div className="min-w-0">
                  <p className={cn("text-[15px] leading-snug", c.kind === "question" && "text-warn")}>{c.text}</p>
                  {c.quote ? (
                    <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-muted-foreground">you said <q className="font-script text-[13.5px] text-foreground/80 [quotes:'“''”']">{c.quote}</q></p>
                  ) : where ? <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{where}</p> : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
