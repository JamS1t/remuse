import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { CircleHelp, Eye, LoaderCircle, RotateCcw, Split, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import { Lockup, Orb, useAction, type OrbState } from "@/components/bits";
import { api, useApi, type Card, type LiveState, type PracticeState, type SessionFull, type SpecRow } from "@/lib/api";
import { ext } from "@/lib/bridge";
import { practiceSay } from "@/lib/say";
import { cn } from "@/lib/utils";

type Status = {
  recording: boolean; rec?: { id?: string; t0?: number; audioError?: string | null }; hearing?: boolean; level?: number; mic?: string | null; micPermission?: boolean;
  speaking?: { line: number; total: number } | null; last?: { id: string; byVoice?: boolean; discarded?: boolean; cancelled?: boolean; learning?: boolean; error?: string | null; at?: number } | null;
};
export type TeachTask = { sessionId: string; specId?: number; title?: string; learnStage?: string | null; learnError?: string | null; practice?: PracticeState | null };
type Ev = SessionFull["events"][number] & { targets?: { label?: string; text?: string }[] };
type Line = { text: string; step?: string; question?: string };
type Heard = { n: number; at: number; text: string; intent: string; specId?: number; changes?: string[]; schedule?: object; speak?: string[]; answered?: string; error?: string };

const LEARNING = ["listening", "understanding", "building"];
const STAGE: Record<string, string> = {
  listening: "Listening back to all of it",
  understanding: "Writing the steps from what you did and said",
  building: "Writing your rules as code and checking them",
};
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const QUIET_MS = 120_000; // the review stops listening after 2 quiet minutes

// What you did, in a few words, for a "where this came from" line.
function did(e?: Ev): string | null {
  if (!e) return null;
  const name = e.target?.label ?? e.target?.text ?? e.targets?.[0]?.label ?? e.targets?.[0]?.text;
  if (e.kind === "click") return name ? `you clicked “${name}”` : "you clicked here";
  if (e.kind === "input") return e.value ? `you typed “${e.value}”` : "you typed here";
  if (e.kind === "key") return `you pressed ${e.key ?? "a key"}`;
  if (e.kind === "mark") return name ? `you marked “${name}”` : "you marked this";
  if (e.kind === "upload") return "you chose a file";
  if (e.kind === "tab") { try { const u = new URL(e.url!); return `you switched to ${u.host}`; } catch { return "you switched tabs"; } }
  if (e.kind === "page" || e.kind === "start") { try { const u = new URL(e.url!); return `you opened ${u.host}${u.pathname === "/" ? "" : u.pathname}`; } catch { return "you opened a page"; } }
  return null;
}

/** Throw a task away: its recording, every version and run. A practice still running is stopped first. */
async function removeTask(sessionId: string, runId?: string | null) {
  if (runId) await api(`/runs/${runId}/stop`, "POST").catch(() => {});
  for (let i = 0; ; i++) {
    try { await api(`/sessions/${sessionId}`, "DELETE"); return; }
    catch (e) { if (!/stop its run first/.test((e as Error).message) || i >= 4) throw e; await new Promise((r) => setTimeout(r, 1000)); }
  }
}

/** The status from the extension, twice a second: recording, whether you're talking, whether Remuse is. */
function useStatus() {
  const [st, setSt] = useState<Status | null>(null);
  useEffect(() => {
    let on = true;
    const tick = () => ext<Status>("status").then((s) => { if (on) setSt(s); }, () => {});
    tick();
    const t = setInterval(tick, 500);
    return () => { on = false; clearInterval(t); };
  }, []);
  return st;
}

/** One screen, three parts: Remuse (orb and one word), what it's working on, and the controls at the bottom. */
function Frame({ orb, word, sub, shimmer, right, children, footer }: { orb: OrbState; word: string; sub?: ReactNode; shimmer?: boolean; right?: ReactNode; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 px-4"><Lockup className="h-[21px]" />{right}</header>
      <main className="flex-1 overflow-y-auto px-5 pb-6">
        <section className="flex flex-col items-center pt-8 text-center" aria-live="polite">
          <Orb state={orb} size={104} />
          <h1 className={cn("mt-7 text-[28px] leading-[1.1] font-medium tracking-[-0.025em] text-balance", shimmer && "shimmer")}>{word}</h1>
          {sub ? <div className="mt-2.5 max-w-[32ch] text-[14px] leading-snug text-muted-foreground text-pretty">{sub}</div> : null}
        </section>
        {children}
      </main>
      <footer className="shrink-0 border-t border-rule bg-background/85 px-4 pt-3 pb-4 backdrop-blur-md">{footer}</footer>
    </div>
  );
}

/** Your own words, large, as Remuse heard them. */
const Heard = ({ text, k }: { text: string; k?: number }) => (
  <q key={k} className="block font-script text-[19px] leading-[1.4] text-foreground/90 [quotes:'“''”'] animate-in fade-in duration-500 line-clamp-4">{text}</q>
);

/** Teaching, full sidebar: Remuse on top, what it heard, and the notes it's taking, each with where it came from.
 *  Nothing else on screen. Stays through learning, then the review reads the plan aloud and takes your changes. */
export function TeachMode({ sessionId, task, onExit }: { sessionId: string; task?: TeachTask; onExit: () => void }) {
  const st = useStatus();
  const [keys, setKeys] = useState<{ teach?: string; pen?: string }>({});
  const { busy, run } = useAction();
  useEffect(() => { ext("keys").then(setKeys, () => {}); }, []);

  const recording = !!st?.recording && st.rec?.id === sessionId;
  const stage = task?.learnStage ?? null;
  // Once learned, the review stays on screen, also while a change you asked for is being built.
  const [reviewing, setReviewing] = useState(false);
  useEffect(() => { if (stage === "ready" && task?.specId) setReviewing(true); }, [stage, task?.specId]);
  const learning = !!st && !recording && !reviewing && (stage == null || LEARNING.includes(stage));
  // Polls only while there's something new to see (useApi keeps its first keepPolling, so this goes by the interval).
  const busyNow = recording || learning;
  const live = useApi<LiveState>(`/sessions/${sessionId}/live`, busyNow ? 1500 : 0).data;
  const session = useApi<SessionFull>(`/sessions/${sessionId}`, busyNow ? 3000 : 0).data;

  // Nothing was done: the Agent didn't keep it, so there's nothing to learn.
  const last = st?.last?.id === sessionId ? st.last : null;
  useEffect(() => { if (last?.discarded) { toast(last.cancelled ? "Okay, I threw that away." : "Nothing was recorded, so I didn't keep it."); onExit(); } }, [last?.discarded]);
  // The shortcut follows what's on screen: it never starts a new recording over this one's review.
  useEffect(() => { ext("mode", { mode: recording ? "idle" : reviewing ? "review" : stage === "failed" || stage === "unsure" ? "idle" : "learning" }).catch(() => {}); }, [recording, reviewing, stage]);
  // Throw this task away (while learning, or when it wasn't really a task) and go back to the dashboard.
  const remove = (then?: () => void) => run("remove", async () => { await removeTask(sessionId); toast("Okay, I threw that away."); onExit(); then?.(); });
  useEffect(() => () => { ext("mode", { mode: "idle" }).catch(() => {}); }, []);

  const events = (session?.events ?? []) as Ev[];
  if (reviewing && task?.specId) return <Review sessionId={sessionId} task={task} st={st} events={events} onExit={onExit} />;

  const cards = live?.cards?.length ? live.cards : session?.cards ?? [];
  const lastSaid = live?.turns?.at(-1)?.text;
  const secs = recording && st?.rec?.t0 ? Math.max(0, Math.floor((Date.now() - st.rec.t0) / 1000)) : 0;
  const justDone = !!last?.at && Date.now() - last.at < 1800 && !recording;
  const view: { orb: OrbState; word: string; sub?: string } =
    recording && live?.ending ? { orb: "thinking", word: "Finishing", sub: `You said “${live.ending}”` }
    : recording ? (st?.hearing ? { orb: "watching", word: "Hearing you" } : { orb: "watching", word: "Listening", sub: "Do the task once. Say why as you go." })
    : justDone ? { orb: "thinking", word: last?.byVoice ? "Got it, you're done" : "Got it" }
    : last?.error && !last.learning && !stage ? { orb: "idle", word: "That didn't save", sub: last.error }
    : stage === "failed" ? { orb: "idle", word: "I couldn't learn that one", sub: task?.learnError ?? undefined }
    : stage === "unsure" ? { orb: "idle", word: "Was that a task?", sub: task?.learnError ?? undefined }
    : { orb: "thinking", word: "Thinking", sub: (stage && STAGE[stage]) || "Getting ready" };

  return (
    <Frame orb={view.orb} word={view.word} sub={<>{view.sub}{recording && st?.rec?.audioError ? <p className="mt-2 text-[13px] text-warn">No voice: {st.rec.audioError}</p> : null}{recording && st?.mic ? (st.micPermission ? (
        <span className="mt-2 block text-[13px] text-warn">
          Chrome took back the microphone, so I can't hear you. <button type="button" className="font-medium underline underline-offset-2" onClick={() => ext("openMic").catch(() => {})}>Allow the mic again</button> and pick “forever” (or “Allow while visiting the site”). I'll pick up where you are.
        </span>
      ) : <p className="mt-2 text-[13px] text-warn">The mic stopped hearing you ({st.mic}). Reconnecting…</p>) : null}</>} shimmer={view.word === "Thinking"}
      right={recording ? (
        <span className="ml-auto inline-flex items-center gap-2 font-mono text-[13px] tabular-nums text-muted-foreground">
          <Meter level={st?.level ?? 0} /><span className="size-2 rounded-full bg-tally" aria-hidden />{clock(secs)}<span className="sr-only">recording</span>
        </span>
      ) : <Button variant="ghost" size="sm" className="ml-auto rounded-full text-muted-foreground" onClick={onExit}>Close</Button>}
      footer={recording ? (
        <>
          <Button size="lg" variant="outline" onClick={() => run("stop", () => ext("stop"))} disabled={busy === "stop"} className="h-11 w-full rounded-full border-tally/40 bg-tally/10 text-[15px] hover:bg-tally/20">
            {busy === "stop" ? <LoaderCircle className="animate-spin" /> : <Square className="size-3 fill-tally text-tally" />}Stop, I've shown you
          </Button>
          <p className="mt-2.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
            <span>or say “I'm done”</span>
            {keys.teach ? <span className="inline-flex items-center gap-1.5"><Kbd>{keys.teach}</Kbd>stop</span> : null}
            {keys.pen ? <span className="inline-flex items-center gap-1.5"><Kbd>{keys.pen}</Kbd>draw</span> : null}
          </p>
          <p className="mt-1 text-center text-[13px] text-muted-foreground">
            Changed your mind? <button type="button" className="underline-offset-2 hover:text-foreground hover:underline" disabled={!!busy} onClick={() => run("cancel", () => ext("cancel"))}>Cancel</button> or say “never mind”
          </p>
        </>
      ) : stage === "failed" ? (
        <div className="flex gap-2">
          <Button className="flex-1 rounded-full" onClick={() => run("relearn", () => api(`/sessions/${sessionId}/learn`, "POST"))} disabled={!!busy}><RotateCcw />Try again</Button>
          <Button variant="ghost" className="rounded-full" onClick={() => remove()} disabled={!!busy}>Throw it away</Button>
        </div>
      ) : stage === "unsure" ? (
        <>
          <Button className="h-11 w-full rounded-full text-[15px]" onClick={() => remove()} disabled={!!busy}>Throw it away</Button>
          <div className="mt-2 flex items-center justify-center gap-1">
            <Button variant="ghost" size="sm" className="rounded-full text-muted-foreground" disabled={!!busy} onClick={() => remove(() => { ext("start").catch((e) => toast.error(e.message)); })}>Show you again</Button>
            <Button variant="ghost" size="sm" className="rounded-full text-muted-foreground" disabled={!!busy} onClick={() => run("relearn", () => api(`/sessions/${sessionId}/learn`, "POST"))}>Learn it anyway</Button>
          </div>
        </>
      ) : (
        <p className="py-1.5 text-center text-[13px] text-muted-foreground">
          Learning from your demo. This takes about a minute. <button type="button" className="underline-offset-2 hover:text-foreground hover:underline" disabled={!!busy} onClick={() => remove()}>Cancel</button>
        </p>
      )}>
      {(recording || learning) && (st?.hearing || lastSaid) ? (
        <div className="mx-auto mt-7 max-w-[34ch] text-center">
          {recording && st?.hearing && !lastSaid ? <p className="shimmer text-[15px]">Hearing you…</p> : <Heard text={lastSaid!} k={live?.turns?.length} />}
        </div>
      ) : null}
      {stage === "unsure" && !cards.length ? null : <Notes cards={cards} events={events} recording={recording} />}
    </Frame>
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
                  {Icon ? <Icon className="size-4" strokeWidth={2} /> : <span className="font-mono text-[13px] leading-[1.6] tabular-nums">{++n}</span>}
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

// Where the review is. Whether the mic is on is `listening`, not a phase: a reply that finishes after you tapped
// Stop listening must not make the screen say "Listening" again.
type Phase = "reading" | "asking" | "listening" | "practicing";

/** The review: Remuse reads its plan aloud, asks what it wasn't sure of one question at a time, and listens. You
 *  answer or say what to change, and it says what it changed. "Looks good" tries it once on your example, then it
 *  says how that went and keeps listening; "looks good" again (or Looks right) and you're done. */
function Review({ sessionId, task, st, events, onExit }: { sessionId: string; task: TeachTask; st: Status | null; events: Ev[]; onExit: () => void }) {
  const specId = task.specId!;
  const spec = useApi<SpecRow>(`/specs/${specId}`).data;
  const rb = useApi<{ specId: number; plan: Line[]; questions: Line[]; steps: { text: string; ids: string[] }[] }>(`/specs/${specId}/readback`).data;
  const rbRef = useRef(rb);
  rbRef.current = rb;
  const [phase, setPhase] = useState<Phase>("reading");
  const [lines, setLines] = useState<Line[]>([]); // what Remuse is saying now, to light up the step it's on
  const [listening, setListening] = useState<boolean | null>(null); // null until the mic first opens or fails
  const [quietSince, setQuietSince] = useState(Date.now());
  const [practiceRun, setPracticeRun] = useState<string | null>(null);
  const [practiced, setPracticed] = useState(false);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { busy, run } = useAction();
  const since = useRef(Date.now());
  const wantSpec = useRef<number | null>(null); // after a change: ask the next question from this version on
  const practiceWhenReady = useRef(false);
  const before = useRef<Map<string, string> | null>(null);

  // One thing said at a time, in order: the next question waits until "Got it, I changed…" is finished.
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const say = (ls: Line[]) => (chain.current = chain.current.then(async () => {
    if (!ls.length) return;
    setLines(ls);
    await ext("speak", { lines: ls.map((l) => l.text) }).catch(() => {});
    setLines([]);
  }));
  const listen = () => ext("listen", { sessionId }).then(() => { setListening(true); setQuietSince(Date.now()); }, (e) => { setListening(false); toast(e.message); });
  const ask = async (r: typeof rb) => {
    if (r?.questions.length) { setPhase("asking"); await say([r.questions[0]]); }
    else setPhase("listening");
    setQuietSince(Date.now());
  };

  // Start: open the mic (it waits while Remuse talks), read the plan, then ask the first question.
  const started = useRef(false);
  useEffect(() => {
    if (!rb || started.current) return;
    started.current = true;
    (async () => { await listen(); await say(rb.plan); await ask(rb); })();
  }, [rb]);
  // A change or an answer makes a new version: light up what changed, then ask the next question, if any.
  useEffect(() => {
    if (!spec?.spec) return;
    const now = new Map([...spec.spec.steps, ...Object.values(spec.spec.outcomes).flatMap((o) => o.steps)].map((s) => [s.id, s.describe]));
    if (before.current) setChanged(new Set([...now].filter(([id, d]) => before.current!.get(id) !== d).map(([id]) => id)));
    before.current = now;
  }, [spec?.id]);
  const maybeAsk = () => {
    const r = rbRef.current;
    if (wantSpec.current != null && r && r.specId >= wantSpec.current) { wantSpec.current = null; ask(r); }
  };
  useEffect(() => { if (started.current) maybeAsk(); }, [rb]);
  // The practice waits for the rebuilt rules after a change.
  useEffect(() => {
    if (!practiceWhenReady.current || (task.learnStage !== "ready" && task.learnStage !== "failed")) return;
    practiceWhenReady.current = false;
    startPractice();
  }, [task.learnStage]);

  const startPractice = () => run("practice", async () => {
    if (practiceRun) return; // already trying it: "looks good" again mustn't restart it
    if (task.learnStage === "failed") throw new Error(`I couldn't update the task, so I can't try it: ${task.learnError ?? "it didn't build"}. Say what to change, or remove it.`);
    if (task.learnStage !== "ready") { practiceWhenReady.current = true; return; }
    const r = await api<{ id: string }>(`/specs/${specId}/practice`, "POST");
    setPracticeRun(r.id); setPhase("practicing"); ext("mode", { mode: "practice" }).catch(() => {});
  });
  // The practice is over: say how it went, then listen again.
  const p = task.practice;
  useEffect(() => {
    if (!practiceRun || p?.runId !== practiceRun || p.status === "starting" || p.status === "running") return;
    setPracticeRun(null); setPracticed(true); ext("mode", { mode: "review" }).catch(() => {});
    const next = listening ? "Say what to change, or say it looks good." : "Type what to change, or tap Listen again.";
    (async () => { await say([{ text: practiceSay(p) }, { text: next }]); setPhase("listening"); setQuietSince(Date.now()); })();
  }, [p?.runId, p?.status, practiceRun]); // practiceRun too: a quick practice can finish before its start call returns

  const finish = () => { ext("unlisten").catch(() => {}); ext("hush").catch(() => {}); onExit(); };
  // "Remove the task": throw it away and go back to the dashboard. The mic and the voice stop first.
  const removeIt = () => run("remove", async () => { ext("unlisten").catch(() => {}); ext("hush").catch(() => {}); setListening(false); await removeTask(sessionId, practiceRun); toast("Okay, I threw that task away."); onExit(); });
  const stopListening = () => { ext("unlisten").catch(() => {}); ext("hush").catch(() => {}); setListening(false); };
  const showAgain = () => { ext("unlisten").catch(() => {}); ext("hush").catch(() => {}); onExit(); ext("start").catch((e) => toast.error(e.message)); };
  // The final "looks right": a schedule you asked for in the demo ("every hour") is set up now, unless you set one by voice.
  const scheduled = useRef(false);
  const done = () => run("done", async () => {
    const s = (spec?.spec as { schedule?: { everyMinutes?: number; time?: string; days?: string } } | undefined)?.schedule;
    if (!scheduled.current && (s?.everyMinutes || s?.time)) {
      const ok = await api("/schedules", "POST", { specId, everyMinutes: s.everyMinutes, time: s.time, days: s.days }).then(() => true, (e) => { toast.error(`I couldn't set the schedule: ${e.message}`); return false; });
      if (ok) await say([{ text: "Okay. I'll repeat it on that schedule, even with Chrome closed." }]);
    }
    finish();
  });
  const approve = () => (practiced ? done() : startPractice());

  // What you said, sorted by the Agent (a change, an answer, "looks good", a schedule, "show you again", or not for Remuse).
  const said = useApi<Heard | null>(listening ? `/sessions/${sessionId}/say` : null, listening ? 1000 : 0).data;
  const handled = useRef(0);
  // Spoken (polled) or typed (answered at once): the same thing happens either way, once.
  const onSaid = (h: Heard) => {
    if (h.n <= handled.current || h.intent === "thinking") return;
    handled.current = h.n; setQuietSince(Date.now());
    const back = (h.speak ?? []).map((t) => ({ text: t }));
    (async () => {
      if (h.intent === "change" || h.intent === "answer") { wantSpec.current = h.specId ?? (rbRef.current?.specId ?? specId) + 1; await say(back); maybeAsk(); }
      else if (h.intent === "approve" || h.intent === "run") { if (practiced && h.intent === "approve") return done(); await say(back); startPractice(); }
      else if (h.intent === "schedule" && h.schedule) { await api("/schedules", "POST", { specId, ...h.schedule }).then(() => { scheduled.current = true; }, (e) => toast.error(e.message)); await say(back); }
      else if (h.intent === "teach") showAgain();
      else if (h.intent === "discard") { await say(back); removeIt(); }
      else if (h.intent === "stop") { await say(back); stopListening(); }
      else if (h.error) toast.error(`I didn't catch that: ${h.error}`);
    })();
  };
  useEffect(() => { if (said && said.at >= since.current) onSaid(said); }, [said?.n, said?.intent]);
  const thinking = said?.intent === "thinking" && said.at >= since.current;

  // Two quiet minutes: stop listening, and say so.
  useEffect(() => {
    if (!listening) return;
    const t = setInterval(() => {
      if (phase !== "practicing" && !st?.speaking && Date.now() - quietSince > QUIET_MS) { toast("I stopped listening after 2 quiet minutes. The task is saved."); finish(); }
    }, 5000);
    return () => clearInterval(t);
  }, [listening, quietSince, phase, st?.speaking]);
  // Leaving the review: the mic and the voice go too.
  useEffect(() => () => { ext("unlisten").catch(() => {}); ext("hush").catch(() => {}); }, []);

  // Typed words are sorted like spoken ones: "can you test it again?" tries it, an answer answers, the rest is a change.
  const send = () => run("send", async () => {
    const h = await api<Heard>(`/sessions/${sessionId}/say-text`, "POST", { text });
    setText(""); setTyping(false);
    onSaid(h);
  });

  const speakingNow = st?.speaking ? lines[st.speaking.line] : undefined;
  const building = task.learnStage === "building" || thinking;
  const question = phase === "asking" ? rb?.questions[0] : undefined;
  const asked = question ? <span className="text-[16px] leading-snug text-foreground">{question.text.replace(/^One thing: you said "[^"]*"\. /, "")}</span> : undefined;
  const view: { orb: OrbState; word: string; sub?: ReactNode; shimmer?: boolean } =
    task.learnStage === "failed" ? { orb: "idle", word: "I couldn't change it", sub: task.learnError ?? "Say what to change, or remove it." }
    : building ? { orb: "thinking", word: "Changing it", shimmer: true, sub: said?.text ? <q className="font-script [quotes:'“''”']">{said.text}</q> : undefined }
    : phase === "practicing" ? { orb: "working", word: "Practicing", sub: "Once, on your example. Nothing I'd send or pay goes out." }
    : st?.speaking && phase === "reading" ? { orb: "working", word: "Here's my plan" }
    // The mic is off: say so above everything else; an open question still shows, to answer by typing.
    : listening === false ? { orb: st?.speaking ? "working" : "idle", word: "Not listening", sub: asked ?? "Tap Listen again, or type instead." }
    : question ? { orb: st?.speaking ? "working" : "watching", word: "One question", sub: asked }
    : st?.speaking ? { orb: "working", word: "Speaking" }
    : listening === null ? { orb: "idle", word: "Opening the mic" }
    : st?.hearing ? { orb: "watching", word: "Hearing you" }
    : { orb: "watching", word: "Listening", sub: "Tell me what to change, or say “looks good”." };

  // The steps as a person would name them (from the readback: keypresses fold into the step they finish).
  const all = spec?.spec ? [...spec.spec.steps, ...Object.values(spec.spec.outcomes).flatMap((o) => o.steps)] : [];
  const steps = rb?.steps ?? all.map((s) => ({ text: s.describe, ids: [s.id] }));
  const rules = (rb?.plan ?? []).filter((l) => !l.step && l.text !== "Here's my plan." && !/^And \d+ more steps/.test(l.text));
  // Where a shown step came from: the words and actions behind every task step it stands for.
  const evidence = (g: { ids: string[] }) => {
    const ev = g.ids.map((id) => (all.find((s) => s.id === id) as { evidence?: { events: number[]; quote?: string } } | undefined)?.evidence);
    const what = [...new Set(ev.flatMap((e) => e?.events ?? []).map((i) => did(events[i])).filter(Boolean))];
    return { quote: ev.find((e) => e?.quote)?.quote, what };
  };

  return (
    <Frame orb={view.orb} word={view.word} sub={view.sub} shimmer={view.shimmer}
      right={<Button variant="ghost" size="sm" className="ml-auto rounded-full text-muted-foreground" onClick={finish}>Close</Button>}
      footer={
        <>
          <Button className="h-11 w-full rounded-full text-[15px]" onClick={approve} disabled={phase === "practicing" || building || busy === "practice"}>
            {busy === "practice" ? <LoaderCircle className="animate-spin" /> : null}{practiced ? "Looks right" : "Looks right, try it once"}
          </Button>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-1 text-[13px]">
            <Button variant="ghost" size="sm" className="rounded-full text-muted-foreground" onClick={showAgain}>Show you again</Button>
            {listening === null ? null : listening ? <Button variant="ghost" size="sm" className="rounded-full text-muted-foreground" onClick={stopListening}>Stop listening</Button>
              : <Button variant="ghost" size="sm" className="rounded-full text-muted-foreground" onClick={listen}>Listen again</Button>}
            <Button variant="ghost" size="sm" className="rounded-full text-muted-foreground" onClick={() => setTyping((x) => !x)}>Type instead</Button>
            {/* Two taps, so a stray click never throws a task away. Saying "remove the task" does it too. */}
            <Button variant="ghost" size="sm" className={cn("rounded-full text-muted-foreground", confirmRemove && "text-destructive")} disabled={busy === "remove"}
              onClick={() => { if (confirmRemove) removeIt(); else { setConfirmRemove(true); setTimeout(() => setConfirmRemove(false), 4000); } }}>
              {busy === "remove" ? <LoaderCircle className="animate-spin" /> : null}{confirmRemove ? "Tap again to remove" : "Remove task"}
            </Button>
          </div>
          {typing ? (
            <div className="mt-2">
              <Textarea autoFocus className="min-h-16 text-[14px]" value={text} onChange={(e) => setText(e.target.value)} disabled={busy === "send"}
                placeholder={question ? "Your answer" : "What should change, or “try it again”"}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && text.trim()) { e.preventDefault(); send(); } }} />
              <Button size="sm" variant="outline" className="mt-2 w-full rounded-full" onClick={send} disabled={!text.trim() || !!busy}>
                {busy === "send" ? <><LoaderCircle className="animate-spin" />Thinking…</> : question ? "Answer" : "Send"}
              </Button>
            </div>
          ) : null}
        </>
      }>
      {said?.text && said.at >= since.current && !building ? <div className="mx-auto mt-6 max-w-[34ch] text-center"><Heard text={said.text} k={said.n} /></div> : null}
      <section className="mt-10">
        <h2 className="text-[15px] font-medium">{task.title || "What I'll do"}</h2>
        <p className="mt-0.5 mb-3 text-[13px] text-muted-foreground">What I'll do, step by step. Tap a step to see where it came from.</p>
        <ol className="space-y-1">
          {steps.map((s, i) => {
            const key = s.ids[0], on = speakingNow?.step === key, ev = openStep === key ? evidence(s) : null;
            return (
              <li key={key ?? i}>
                <button type="button" onClick={() => setOpenStep(openStep === key ? null : key)} aria-expanded={openStep === key}
                  className={cn("grid w-full grid-cols-[1.5rem_1fr] gap-x-2 rounded-xl px-1 py-1.5 text-left text-[15px] leading-snug transition-colors hover:bg-muted", on && "bg-muted")}>
                  <span className={cn("pt-px text-right font-mono text-[13px] leading-[1.6] tabular-nums text-muted-foreground", on && "text-foreground")}>{i + 1}</span>
                  <span>{s.text}{s.ids.some((id) => changed.has(id)) ? <span className="ml-1.5 text-[13px] text-ok">changed</span> : null}</span>
                </button>
                {ev ? (
                  <p className="mt-0.5 mb-1.5 ml-[2.1rem] text-[13px] leading-snug text-muted-foreground">
                    {ev.quote ? <>you said <q className="font-script text-[13.5px] text-foreground/80 [quotes:'“''”']">{ev.quote}</q>{ev.what.length ? "; " : ""}</> : null}
                    {ev.what.join("; ") || (ev.quote ? "" : "I worked this one out; you didn't show it")}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
        {rules.length ? <ul className="mt-5 space-y-2 border-t border-rule pt-4 text-[14px] leading-snug">{rules.map((r) => <li key={r.text}>{r.text}</li>)}</ul> : null}
        {rb?.questions.length ? (
          <ul className="mt-5 space-y-2 border-t border-rule pt-4">
            {rb.questions.map((q, i) => (
              <li key={q.question} className={cn("grid grid-cols-[1.5rem_1fr] gap-x-2 text-[14px] leading-snug", i === 0 && question ? "text-foreground" : "text-muted-foreground")}>
                <span className="flex justify-end pt-[2px]"><CircleHelp className="size-4" /></span><span>{q.text}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </Frame>
  );
}

/** How loud the microphone is right now: four bars, so you can see it hears you. */
function Meter({ level }: { level: number }) {
  const on = [0.004, 0.01, 0.025, 0.06].filter((x) => level > x).length;
  return (
    <span className="mr-1 inline-flex h-3.5 items-end gap-[2px]" role="img" aria-label={on ? "the microphone hears you" : "the microphone hears nothing"}>
      {[0, 1, 2, 3].map((i) => <span key={i} className={cn("w-[3px] rounded-full transition-colors duration-150", i < on ? "bg-foreground/80" : "bg-foreground/15")} style={{ height: `${5 + i * 3}px` }} />)}
    </span>
  );
}
