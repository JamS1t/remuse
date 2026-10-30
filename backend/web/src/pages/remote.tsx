import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, Check, ChevronDown, CircleAlert, ExternalLink, Globe, LoaderCircle, Mic, Play, RotateCcw, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ItemLabel, Lockup, Orb, Said, useAction, type OrbState } from "@/components/bits";
import { PendingCard } from "@/pages/run";
import { parseCsv } from "@/pages/spec";
import { api, isLive, useApi, type Run, type RunRow } from "@/lib/api";
import { ext, inPanel, useTabChanges } from "@/lib/bridge";
import { cn } from "@/lib/utils";

type Task = {
  sessionId: string; title?: string; specId?: number; version?: number; built: boolean; goal?: string; itemName?: string;
  source?: "list" | "rows" | "once"; columns: { name: string; demoValue: string }[]; endedAt?: number;
  learnStage?: "listening" | "understanding" | "building" | "ready" | "failed" | null; learnError?: string | null;
  rules: { if: string; then: string; said?: string }[]; guessed: string[]; steps: number; compares: boolean; checks: { passed: number; total: number };
  askedSchedule: { everyMinutes?: number; time?: string; days?: string; said?: string } | null;
  lastReport: { text: string; at: number; runId: string } | null;
};
type Rec = { recording: boolean; rec?: { audioError?: string }; waitingForMic?: boolean };
type Schedule = { id: number; specId: number; sessionId: string; time: string; days: string; everyMinutes: number | null };

const AGENT = location.origin;
const open = (hash: string) => (inPanel ? ext("openTab", { url: `${AGENT}/${hash}` }) : window.open(`/${hash}`, "_blank"));
const LEARNING = ["listening", "understanding", "building"];
const STAGE: Record<string, string> = {
  listening: "Listening back to what you said",
  understanding: "Working out the steps and your rules",
  building: "Writing your rules as code and testing them",
};
const seenKey = (id: string) => `remuse.seen.${id}`;
const seen = (id: string) => { try { return localStorage.getItem(seenKey(id)) === "1"; } catch { return false; } };
const markSeen = (id: string) => { try { localStorage.setItem(seenKey(id), "1"); } catch { /* private window */ } };

const DAYS = ["M", "T", "W", "T", "F", "S", "S"];
const NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const every = (m: number) => (m % 60 === 0 ? (m === 60 ? "every hour" : `every ${m / 60} hours`) : `every ${m} minutes`);
const describeSchedule = (s: { everyMinutes?: number | null; days?: string; time?: string }) => (s.everyMinutes ? every(s.everyMinutes) : when(s.days ?? "1234567", s.time ?? "09:00"));
function when(days: string, time: string) {
  const at = new Date(`2000-01-01T${time}`).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const d = days === "1234567" ? "every day" : days === "12345" ? "every weekday" : days === "67" ? "every weekend" : `every ${[...days].map((x) => NAMES[Number(x) - 1]).join(", ")}`;
  return `${d} at ${at}`;
}
const words = (s?: string) => s?.replaceAll("_", " ");

/** The sidebar. The orb is Remuse; everything else is what it's doing or what it needs from you. No chat. */
export function Remote() {
  const [rec, setRec] = useState<Rec | null>(null);
  const [since, setSince] = useState(0);
  const [, setTick] = useState(0);
  const { data: tasks, reload: reloadTasks } = useApi<Task[]>("/tasks", 2000, () => true);
  const { data: runs } = useApi<RunRow[]>("/runs", 2000, () => true);
  const liveId = runs?.find((r) => isLive(r.status))?.id;
  const { data: run, reload: reloadRun } = useApi<Run>(liveId ? `/runs/${liveId}` : null, 1000, (d) => isLive(d.status));
  const { busy, run: act } = useAction();

  const refresh = () => (inPanel ? ext<Rec>("status").then(setRec, () => setRec(null)) : Promise.resolve());
  // Recording can start from elsewhere (after the mic tab), so keep the state fresh.
  useEffect(() => { refresh(); const t = setInterval(refresh, 1500); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!rec?.recording) return;
    const t = setInterval(() => setSince((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [rec?.recording]);

  const learning = tasks?.find((t) => t.learnStage && LEARNING.includes(t.learnStage));
  const fresh = tasks?.find((t) => (t.learnStage === "ready" || t.learnStage === "failed") && t.endedAt && Date.now() - t.endedAt < 6 * 3600_000 && !seen(t.sessionId));
  const live = run && isLive(run.status) ? run : null;
  const state: OrbState = rec?.recording ? "watching" : live?.pending ? "waiting" : learning ? "thinking" : live ? "working" : fresh?.learnStage === "ready" ? "done" : "idle";

  const start = () => act("start", async () => {
    const r = await ext<{ needsMic?: boolean }>("start");
    if (r?.needsMic) toast("Allow the microphone in the tab that just opened. I will start recording right after.");
    setSince(0); await refresh();
  });
  // The recording ends even if something fails on the way out, so always show the real state after.
  const stop = () => act("stop", async () => {
    try {
      const r = await ext<{ error?: string | null; discarded?: boolean }>("stop");
      if (r?.discarded) toast("Nothing was recorded, so I didn't keep it.");
      else if (r?.error) toast.error(r.error);
    }
    finally { await refresh(); reloadTasks(); }
  });
  const answer = (body: object) => act("answer", async () => { await api(`/runs/${live!.id}/answer`, "POST", body); reloadRun(); });
  const dismiss = (id: string) => { markSeen(id); setTick((n) => n + 1); };

  const done = live ? live.items.filter((i) => ["done", "skipped", "failed"].includes(i.status)).length : 0;
  const head =
    state === "watching" ? { hi: `Watching · ${String(Math.floor(since / 60)).padStart(2, "0")}:${String(since % 60).padStart(2, "0")}`, big: "Do it once. Tell me why as you go." }
    : state === "waiting" ? { hi: `Working · ${done} of ${live!.items.length}`, big: live!.pending!.kind === "approval" ? "I need your OK" : live!.pending!.kind === "ask" ? "I have a question" : "Your turn in the browser" }
    : state === "thinking" ? { hi: learning!.title || "New task", big: "Thinking…", sub: STAGE[learning!.learnStage!] }
    : state === "working" ? { hi: live!.items[live!.current] ? "Working on" : "Starting", big: `${done} of ${live!.items.length} done`, sub: live!.items[live!.current]?.label }
    : state === "done" ? { hi: "Learned", big: fresh!.title || "Your task" }
    : rec?.waitingForMic ? { hi: "One thing first", big: "Allow the microphone", sub: "In the tab that opened. I start recording right after." }
    : { hi: "Hi, I'm Remuse", big: "Show me a task once. I'll do it again." };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-11 items-center gap-2 px-4">
        <Lockup className="h-[21px]" />
        <button type="button" onClick={() => open("#/")} className="ml-auto inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground">
          Full view <ExternalLink className="size-3.5" />
        </button>
      </header>

      {/* The orb and what it's doing. */}
      <section className="flex flex-col items-center px-6 pt-6 pb-7 text-center" aria-live="polite">
        <Orb state={state} size={92} />
        <p className="mt-6 text-[13px] text-muted-foreground">{head.hi}</p>
        <h1 className={cn("mt-1 max-w-[18ch] text-[24px] leading-[1.15] font-medium tracking-[-0.025em]", state === "thinking" && "shimmer")}>{head.big}</h1>
        {"sub" in head && head.sub ? <p className="mt-2 line-clamp-2 max-w-[34ch] text-[13px] text-muted-foreground">{state === "working" ? <ItemLabel text={head.sub} /> : head.sub}</p> : null}
        {rec?.rec?.audioError && state === "watching" ? <p className="mt-2 text-[12.5px] text-warn">No voice: {rec.rec.audioError}</p> : null}
        {/* The one control sits with the orb: show Remuse something, or say you're done. */}
        {inPanel && rec?.recording ? (
          <Button size="lg" variant="outline" onClick={stop} disabled={!!busy} className="mt-6 rounded-full border-tally/40 bg-tally/10 px-5 hover:bg-tally/20">
            {busy === "stop" ? <LoaderCircle className="animate-spin" /> : <Square className="size-3 fill-tally text-tally" />}Stop, I've shown you
          </Button>
        ) : inPanel && !learning && !live ? (
          <Button size="lg" onClick={start} disabled={!!busy} className="mt-6 rounded-full px-5">
            {busy === "start" ? <LoaderCircle className="animate-spin" /> : <Mic />}Watch me do a task
          </Button>
        ) : null}
      </section>

      <div className="flex-1 space-y-6 px-4 pb-8">
        {live?.pending ? (
          <PendingCard key={`${live.pending.kind}-${live.pending.item}-${live.pending.shot}`} p={live.pending} r={live} file={(f) => `/api/runs/${live.id}/files/${f}`} busy={!!busy} answer={answer} />
        ) : null}
        {live && !live.pending ? (
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => open(`#/run/${live.id}`)}>See every item</Button>
            <Button variant="ghost" onClick={() => act("halt", () => api(`/runs/${live.id}/stop`, "POST"))}><Square className="fill-current" />Stop</Button>
          </div>
        ) : null}
        {fresh && !learning ? <Learned t={fresh} onDone={() => dismiss(fresh.sessionId)} onRetry={() => act("relearn", async () => { await api(`/sessions/${fresh.sessionId}/learn`, "POST"); reloadTasks(); })} /> : null}
        <Sites top />
        <Tasks tasks={tasks} />
        <Sites />
      </div>

    </div>
  );
}

/** "I learned …": everything Remuse worked out on its own, shown once for a quick yes. */
function Learned({ t, onDone, onRetry }: { t: Task; onDone: () => void; onRetry: () => void }) {
  if (t.learnStage === "failed") return (
    <section className="glass rounded-2xl p-4">
      <p className="flex items-center gap-2 font-medium"><CircleAlert className="size-4 text-warn" />I couldn't learn that one</p>
      <p className="mt-1 text-[13px] text-muted-foreground">{t.learnError}</p>
      <div className="mt-3 flex gap-2"><Button size="sm" onClick={onRetry}><RotateCcw />Try again</Button><Button size="sm" variant="ghost" onClick={onDone}>Dismiss</Button></div>
    </section>
  );
  const ok = t.checks.total > 0 && t.checks.passed === t.checks.total;
  return (
    <section className="glass rounded-2xl p-4">
      <p className="text-[13px] text-muted-foreground">Here's what I'll do</p>
      <p className="mt-1 leading-snug">{t.goal}</p>
      {t.rules.length ? (
        <ul className="mt-3 space-y-2">
          {t.rules.slice(0, 4).map((r, i) => (
            <li key={i} className="text-[13px]">
              {r.said ? <Said>{r.said}</Said> : <span>If {r.if}</span>}
              <span className="text-muted-foreground"> → {words(r.then)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="mt-3 space-y-1 text-[12.5px]">
        <li className={cn("flex items-center gap-1.5", ok ? "text-ok" : "text-warn")}>{ok ? <Check className="size-3.5" /> : <CircleAlert className="size-3.5" />}{t.checks.passed} of {t.checks.total} checks pass against your demo</li>
        {t.guessed.length ? <li className="flex items-center gap-1.5 text-warn"><CircleAlert className="size-3.5" />I guessed how to {t.guessed.map(words).join(", ")}; check it once</li> : null}
        <li className="flex items-center gap-1.5 text-muted-foreground"><Check className="size-3.5" />Anything I'd pay or send for waits for your OK</li>
      </ul>
      {t.askedSchedule && t.specId ? <AskedSchedule t={t} onDone={onDone} /> : null}
      <div className="mt-4 flex gap-2">
        <Button size="sm" className="flex-1" variant={t.askedSchedule ? "outline" : "default"} onClick={onDone}>Looks right</Button>
        <Button size="sm" variant="outline" onClick={() => open(`#/task/${t.sessionId}`)}>Review</Button>
      </div>
    </section>
  );
}

/** You said how often ("every hour"): one tap sets it up. */
function AskedSchedule({ t, onDone }: { t: Task; onDone: () => void }) {
  const { busy, run } = useAction();
  const s = t.askedSchedule!;
  const go = () => run("sched", async () => {
    await api("/schedules", "POST", { specId: t.specId, everyMinutes: s.everyMinutes, time: s.time, days: s.days });
    toast.success(`I'll do it ${describeSchedule(s)}, even with Chrome closed.`);
    onDone();
  });
  return (
    <Button className="mt-4 w-full rounded-full" onClick={go} disabled={!!busy}>
      {busy ? <LoaderCircle className="animate-spin" /> : <CalendarClock />}Yes, repeat it {describeSchedule(s)}
    </Button>
  );
}

function Tasks({ tasks }: { tasks: Task[] | null }) {
  const { data: sched, reload } = useApi<Schedule[]>("/schedules");
  const list = (tasks ?? []).filter((t) => t.specId && !(t.learnStage && LEARNING.includes(t.learnStage)));
  if (!tasks) return <div className="h-14 animate-pulse rounded-2xl bg-muted" />;
  if (!list.length) return null;
  return (
    <section>
      <h2 className="mb-2 px-1 text-[13px] font-medium text-muted-foreground">Do it again</h2>
      <ul className="glass divide-y divide-rule overflow-hidden rounded-2xl">{list.map((t) => <TaskRow key={t.sessionId} t={t} schedule={sched?.find((x) => x.sessionId === t.sessionId) ?? null} onSchedule={reload} />)}</ul>
    </section>
  );
}

function TaskRow({ t, schedule, onSchedule }: { t: Task; schedule: Schedule | null; onSchedule: () => void }) {
  const [time, setTime] = useState(schedule?.time ?? "09:00");
  const [days, setDays] = useState(schedule?.days ?? "12345");
  const [hourly, setHourly] = useState<number | null>(schedule?.everyMinutes ?? t.askedSchedule?.everyMinutes ?? null);
  const [openForm, setOpenForm] = useState(false);
  const [rows, setRows] = useState([t.columns.map((c) => c.name).join(","), t.columns.map((c) => c.demoValue).join(",")].join("\n"));
  const [count, setCount] = useState("");
  const { busy, run } = useAction();
  const isRows = t.source === "rows";
  const isOnce = t.source === "once";
  const repeat = () => run("sched", async () => {
    const extra = isRows ? { rows: parseCsv(rows) } : { limit: count ? Number(count) : undefined };
    await api("/schedules", "POST", { specId: t.specId, ...(hourly ? { everyMinutes: hourly } : { time, days }), ...extra });
    toast.success(`I'll do this ${hourly ? every(hourly) : when(days, time)}, even with Chrome closed.`);
    onSchedule();
  });
  const unschedule = () => run("sched", async () => { await api(`/schedules/${schedule!.id}`, "DELETE"); onSchedule(); });
  const go = () => run("run", async () => {
    const body = isRows ? { rows: parseCsv(rows) } : { limit: count ? Number(count) : undefined };
    if (isRows && !body.rows?.length) throw new Error("Add at least one line under the header.");
    await api(`/specs/${t.specId}/runs`, "POST", body);
    setOpenForm(false);
  });
  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => open(`#/spec/${t.specId}`)} className="min-w-0 flex-1 text-left">
          <span className="block truncate font-medium">{t.title || "Untitled task"}</span>
          {schedule
            ? <span className="mt-0.5 inline-flex items-center gap-1 text-[12.5px] text-muted-foreground"><CalendarClock className="size-3.5" />{describeSchedule(schedule)}</span>
            : t.goal ? <span className="line-clamp-1 text-[12.5px] text-muted-foreground">{t.goal}</span> : null}
        </button>
        {t.built
          ? <Button size="sm" variant={openForm ? "ghost" : "secondary"} className="rounded-full" onClick={() => setOpenForm((o) => !o)} aria-expanded={openForm}>{openForm ? <X /> : <Play className="fill-current" />}Again</Button>
          : <Button size="sm" variant="outline" className="rounded-full" onClick={() => open(`#/spec/${t.specId}`)}>Review</Button>}
      </div>
      {t.lastReport ? (
        <button type="button" onClick={() => open(`#/run/${t.lastReport!.runId}`)} className="mt-2 block w-full rounded-xl bg-white/[0.04] px-3 py-2 text-left">
          <span className="block text-[11.5px] text-muted-foreground">Latest update · {new Date(t.lastReport.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
          <span className="line-clamp-3 text-[13px]">{t.lastReport.text}</span>
        </button>
      ) : null}
      {openForm ? (
        <div className="mt-3 space-y-2.5">
          {isOnce ? null : isRows ? (
            <>
              <p className="text-[12.5px] text-muted-foreground">One {t.itemName ?? "item"} per line. Pasting from a spreadsheet works.</p>
              <Textarea value={rows} onChange={(e) => setRows(e.target.value)} rows={4} spellCheck={false} className="rounded-xl bg-black/30 font-mono text-[12.5px]" />
            </>
          ) : (
            <label className="flex items-center gap-2 text-[13px] text-muted-foreground">How many {t.itemName ?? "item"}s
              <Input type="number" min={1} value={count} onChange={(e) => setCount(e.target.value)} placeholder="All" className="h-8 w-20 rounded-lg font-mono" />
            </label>
          )}
          <Button className="w-full rounded-full" onClick={go} disabled={!!busy}>{busy === "run" ? <LoaderCircle className="animate-spin" /> : <Play className="fill-current" />}Do it now</Button>
          <div className="rounded-xl border border-dashed px-3 py-2.5">
            <p className="text-[12.5px] text-muted-foreground">Or on its own, even with Chrome closed</p>
            <div className="mt-2 flex gap-1 text-[12px]">
              {[["Every few hours", 60], ["On days", null]].map(([label, v]) => (
                <button key={String(label)} type="button" aria-pressed={hourly === null ? v === null : v !== null} onClick={() => setHourly(v as number | null)}
                  className={cn("rounded-full border px-3 py-1 font-medium transition-colors", (hourly === null ? v === null : v !== null) ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>{label}</button>
              ))}
            </div>
            {hourly !== null ? (
              <label className="mt-2 flex items-center gap-2 text-[13px] text-muted-foreground">Every
                <Input type="number" min={1} max={24} value={hourly / 60} onChange={(e) => setHourly(Math.max(1, Math.min(24, Number(e.target.value) || 1)) * 60)} className="h-7 w-16 rounded-full px-3 font-mono text-[12.5px]" />
                hour(s)
              </label>
            ) : <div className="mt-2 flex flex-wrap items-center gap-1">
              {DAYS.map((d, i) => {
                const on = days.includes(String(i + 1));
                return (
                  <button key={i} type="button" aria-pressed={on} aria-label={NAMES[i]} onClick={() => setDays((x) => (on ? x.replace(String(i + 1), "") : [...x, String(i + 1)].sort().join("")))}
                    className={cn("size-7 rounded-full border text-[12px] font-medium transition-colors", on ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>{d}</button>
                );
              })}
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" className="ml-auto h-7 w-[96px] rounded-full px-3 font-mono text-[12.5px]" />
            </div>}
            <div className="mt-2.5 flex gap-2">
              <Button size="sm" variant="outline" className="flex-1 rounded-full" onClick={repeat} disabled={!!busy || !days}><CalendarClock />{schedule ? "Update" : "Repeat it"}</Button>
              {schedule ? <Button size="sm" variant="ghost" className="rounded-full" onClick={unschedule} disabled={!!busy}>Stop repeating</Button> : null}
            </div>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/** `top`: just the "Use my login" button, shown first. Otherwise: the connected sites list. */
function Sites({ top = false }: { top?: boolean }) {
  const tabTick = useTabChanges();
  const [list, setList] = useState<string[] | null>(null);
  const [tab, setTab] = useState<{ site: string | null } | null>(null);
  const [show, setShow] = useState(false);
  const { busy, run } = useAction();
  const load = () => Promise.all([ext<{ sites: string[] }>("sites").then((r) => setList(r.sites)), ext("currentTab").then(setTab)]).catch(() => {});
  useEffect(() => { if (inPanel) load(); }, [tabTick]);
  if (!inPanel) return null;
  const here = tab?.site;
  const connect = () => run("connect", async () => {
    const r = await ext<{ signin?: boolean }>("connect");
    if (r?.signin) toast("Sign in to Google in the window that opened, then close it. Google sees it as a new device, so nothing else gets signed out.", { duration: 12000 });
    else toast.success(`Connected ${here}. I'll use your login there.`);
    await load();
  });
  const drop = (s: string) => run(s, async () => { await ext("disconnect", { site: s }); await load(); });
  if (top) return here && list && !list.includes(here) ? (
        <button type="button" onClick={connect} disabled={!!busy} className="glow-edge flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left disabled:opacity-60">
          <Globe className="size-4 text-live" />
          <span className="min-w-0 flex-1"><span className="block font-medium">Use my login on {here}</span><span className="block text-[12.5px] text-muted-foreground">So I can work there, even with Chrome closed</span></span>
          {busy === "connect" ? <LoaderCircle className="size-4 animate-spin" /> : null}
        </button>
      ) : null;
  return (
    <section>
      <button type="button" onClick={() => setShow((s) => !s)} className="flex w-full items-center gap-1 px-1 text-[13px] font-medium text-muted-foreground hover:text-foreground" aria-expanded={show}>
        Connected sites{list?.length ? ` · ${list.length}` : ""}<ChevronDown className={cn("ml-auto size-4 transition-transform", show && "rotate-180")} />
      </button>
      {show ? (
        <div className="mt-2">
          <p className="mb-2 px-1 text-[12.5px] text-muted-foreground">I use the login you already have on these. It stays on this computer.</p>
          {list?.length ? (
            <ul className="glass divide-y divide-rule overflow-hidden rounded-2xl">
              {list.map((s) => (
                <li key={s} className="flex items-center gap-2 px-4 py-2.5">
                  <Globe className="size-3.5 text-muted-foreground" /><span className="font-medium">{s}</span>
                  <Button size="xs" variant="ghost" className="ml-auto text-muted-foreground" disabled={busy === s} onClick={() => drop(s)}>Disconnect</Button>
                </li>
              ))}
            </ul>
          ) : <p className="px-1 text-[12.5px] text-muted-foreground">None yet. Open a site and choose "Use my login".</p>}
        </div>
      ) : null}
    </section>
  );
}
