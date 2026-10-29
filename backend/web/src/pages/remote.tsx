import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, ExternalLink, Globe, LoaderCircle, Mic, Play, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ItemLabel, Mark, Status, useAction } from "@/components/bits";
import { PendingCard } from "@/pages/run";
import { parseCsv } from "@/pages/spec";
import { api, isLive, useApi, type Run, type RunRow } from "@/lib/api";
import { ext, inPanel, useTabChanges } from "@/lib/bridge";
import { cn } from "@/lib/utils";

type Task = { sessionId: string; title?: string; specId?: number; version?: number; built: boolean; goal?: string; itemName?: string; source?: "list" | "rows"; columns: { name: string; demoValue: string }[] };
type Schedule = { id: number; specId: number; time: string; days: string };
const DAYS = ["M", "T", "W", "T", "F", "S", "S"];
const NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function when(days: string, time: string) {
  const at = new Date(`2000-01-01T${time}`).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const d = days === "1234567" ? "every day" : days === "12345" ? "every weekday" : days === "67" ? "every weekend" : `every ${[...days].map((x) => NAMES[Number(x) - 1]).join(", ")}`;
  return `${d} at ${at}`;
}
type Rec = { recording: boolean; rec?: { audioError?: string }; last?: { id: string; events: number; turns: number; error?: string } | null };

const AGENT = location.origin;
const open = (hash: string) => (inPanel ? ext("openTab", { url: `${AGENT}/${hash}` }) : window.open(`/${hash}`, "_blank"));
const H = ({ children }: { children: React.ReactNode }) => <h2 className="mb-2 text-[13px] font-semibold">{children}</h2>;

/** The sidebar: a remote for repeated work. Watch me, Again, approvals, connected sites. No chat. */
export function Remote() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 flex h-11 items-center gap-2 border-b bg-background px-4">
        <Mark /><span className="text-[14px] font-semibold tracking-[-0.02em]">Showrun</span>
        <button type="button" onClick={() => open("#/")} className="ml-auto inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground">
          Full view <ExternalLink className="size-3.5" />
        </button>
      </header>
      <div className="space-y-7 px-4 pt-4 pb-10">
        <LiveRun />
        <WatchMe />
        <Tasks />
        <Sites />
      </div>
    </div>
  );
}

function LiveRun() {
  const { data: runs } = useApi<RunRow[]>("/runs", 2000, () => true);
  const live = runs?.find((r) => isLive(r.status));
  const { data: r, reload } = useApi<Run>(live ? `/runs/${live.id}` : null, 1000, (d) => isLive(d.status));
  const { busy, run } = useAction();
  if (!live || !r) return null;
  const done = r.items.filter((i) => ["done", "skipped", "failed"].includes(i.status)).length;
  const it = r.items[r.current];
  const answer = (body: object) => run("answer", async () => { await api(`/runs/${r.id}/answer`, "POST", body); reload(); });
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <H>Running now</H>
        <Button size="xs" variant="ghost" onClick={() => run("stop", () => api(`/runs/${r.id}/stop`, "POST"))}><Square className="fill-current" />Stop</Button>
      </div>
      <div className="rounded-lg border bg-card px-3 py-2.5">
        <div className="flex items-center gap-2"><Status s={r.status} /><span className="ml-auto font-mono text-[12px]">{done} of {r.items.length}</span></div>
        <div className="mt-2 h-1 w-full bg-rule"><div className="live-bar h-full bg-tally" style={{ width: `${Math.max(4, (done / Math.max(1, r.items.length)) * 100)}%` }} /></div>
        {it ? <p className="mt-2 line-clamp-2"><ItemLabel text={it.label} /></p> : null}
        <button type="button" onClick={() => open(`#/run/${r.id}`)} className="mt-1 text-[12.5px] text-muted-foreground underline underline-offset-3 hover:text-foreground">See every item</button>
      </div>
      {r.pending ? <div className="mt-3"><PendingCard key={`${r.pending.kind}-${r.pending.item}-${r.pending.shot}`} p={r.pending} r={r} file={(f) => `/api/runs/${r.id}/files/${f}`} busy={!!busy} answer={answer} /></div> : null}
    </section>
  );
}

function WatchMe() {
  const [title, setTitle] = useState("");
  const [rec, setRec] = useState<Rec | null>(null);
  const [since, setSince] = useState(0);
  const { busy, run } = useAction();
  const refresh = () => (inPanel ? ext<Rec>("status").then(setRec, () => setRec(null)) : Promise.resolve());
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    if (!rec?.recording) return;
    const t = setInterval(() => setSince((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [rec?.recording]);

  const start = () => run("start", async () => { await ext("start", { title: title.trim() || undefined }); setSince(0); await refresh(); });
  const stop = () => run("stop", async () => { await ext("stop"); await refresh(); });
  const write = (id: string) => run("spec", async () => {
    const spec = await api<{ id: number }>(`/sessions/${id}/spec`, "POST");
    toast.success("Task Spec written. Check it, then build it.");
    open(`#/spec/${spec.id}`);
  });

  if (!inPanel) return null;
  return (
    <section>
      <H>Teach a task</H>
      {rec?.recording ? (
        <div className="rounded-lg border border-foreground/80 bg-card p-3">
          <p className="flex items-center gap-2 font-medium text-tally"><Mic className="size-4" />Watching you <span className="ml-auto font-mono text-[12px] text-muted-foreground">{String(Math.floor(since / 60)).padStart(2, "0")}:{String(since % 60).padStart(2, "0")}</span></p>
          <p className="mt-1 text-[13px] text-muted-foreground">Do the task once in any tab. Say why you choose what you choose. Stop before paying or sending.</p>
          {rec.rec?.audioError ? <p className="mt-1 text-[12.5px] text-warn">No voice: {rec.rec.audioError}</p> : null}
          <Button className="mt-3 w-full" onClick={stop} disabled={!!busy}>{busy ? <LoaderCircle className="animate-spin" /> : <Square className="fill-current" />}Stop</Button>
        </div>
      ) : (
        <>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); start(); }}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name it, e.g. Office supply run" aria-label="Task name" />
            <Button type="submit" disabled={!!busy}>{busy === "start" ? <LoaderCircle className="animate-spin" /> : null}Watch me</Button>
          </form>
          {rec?.last ? (
            <div className="mt-2 flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-[13px]">
              <span className="text-muted-foreground">Last: {rec.last.events} actions, {rec.last.turns} things said</span>
              <Button size="xs" className="ml-auto" disabled={!!busy} onClick={() => write(rec.last!.id)}>
                {busy === "spec" ? <><LoaderCircle className="animate-spin" />Writing</> : "Write the Task Spec"}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function Tasks() {
  const { data } = useApi<Task[]>("/tasks");
  const { data: sched, reload } = useApi<Schedule[]>("/schedules");
  const tasks = (data ?? []).filter((t) => t.specId);
  return (
    <section>
      <H>Again</H>
      {!data ? <div className="h-10 animate-pulse rounded-md bg-muted" /> : !tasks.length ? (
        <p className="text-[13px] text-muted-foreground">Tasks you teach show up here. One click repeats them.</p>
      ) : <ul className="divide-y divide-rule rounded-lg border bg-card">{tasks.map((t) => <TaskRow key={t.sessionId} t={t} schedule={sched?.find((x) => x.specId === t.specId) ?? null} onSchedule={reload} />)}</ul>}
    </section>
  );
}

function TaskRow({ t, schedule, onSchedule }: { t: Task; schedule: Schedule | null; onSchedule: () => void }) {
  const [time, setTime] = useState(schedule?.time ?? "09:00");
  const [days, setDays] = useState(schedule?.days ?? "12345");
  const [openForm, setOpenForm] = useState(false);
  const rowsDefault = [t.columns.map((c) => c.name).join(","), t.columns.map((c) => c.demoValue).join(",")].join("\n");
  const [rows, setRows] = useState(rowsDefault);
  const [count, setCount] = useState("");
  const { busy, run } = useAction();
  const isRows = t.source === "rows";
  const repeat = () => run("sched", async () => {
    const extra = isRows ? { rows: parseCsv(rows) } : { limit: count ? Number(count) : undefined };
    await api("/schedules", "POST", { specId: t.specId, time, days, ...extra });
    toast.success(`Showrun will do this ${when(days, time)}, even with Chrome closed.`);
    onSchedule();
  });
  const unschedule = () => run("sched", async () => { await api(`/schedules/${schedule!.id}`, "DELETE"); onSchedule(); });
  const go = () => run("run", async () => {
    const body = isRows ? { rows: parseCsv(rows) } : { limit: count ? Number(count) : undefined };
    if (isRows && !body.rows?.length) throw new Error("Add at least one line under the header.");
    await api(`/specs/${t.specId}/runs`, "POST", body);
    toast.success("Running. Approvals show up at the top.");
    setOpenForm(false);
  });
  return (
    <li className="px-3 py-2.5">
      <div className="flex items-start gap-2">
        <button type="button" onClick={() => open(`#/spec/${t.specId}`)} className="min-w-0 flex-1 text-left">
          <span className="block truncate font-medium">{t.title || "Untitled task"}</span>
          {t.goal ? <span className="line-clamp-2 text-[12.5px] text-muted-foreground">{t.goal}</span> : null}
          {schedule ? <span className="mt-0.5 inline-flex items-center gap-1 text-[12.5px] text-foreground"><CalendarClock className="size-3.5" />Repeats {when(schedule.days, schedule.time)}</span> : null}
        </button>
        {t.built
          ? <Button size="sm" variant={openForm ? "secondary" : "default"} onClick={() => setOpenForm((o) => !o)} aria-expanded={openForm}>{openForm ? <X /> : <Play className="fill-current" />}Again</Button>
          : <Button size="sm" variant="outline" onClick={() => open(`#/spec/${t.specId}`)}>Build</Button>}
      </div>
      {openForm ? (
        <div className={cn("mt-2.5 space-y-2")}>
          {isRows ? (
            <>
              <p className="text-[12.5px] text-muted-foreground">One {t.itemName ?? "item"} per line. Paste from a spreadsheet works.</p>
              <Textarea value={rows} onChange={(e) => setRows(e.target.value)} rows={4} spellCheck={false} className="bg-card font-mono text-[12.5px]" />
            </>
          ) : (
            <label className="flex items-center gap-2 text-[13px] text-muted-foreground">How many {t.itemName ?? "item"}s
              <Input type="number" min={1} value={count} onChange={(e) => setCount(e.target.value)} placeholder="All" className="h-8 w-20 font-mono" />
            </label>
          )}
          <Button className="w-full" onClick={go} disabled={!!busy}>{busy === "run" ? <LoaderCircle className="animate-spin" /> : <Play className="fill-current" />}Start now</Button>
          <div className="rounded-md border border-dashed px-2.5 py-2">
            <p className="text-[12.5px] font-medium">Or repeat it by itself</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {DAYS.map((d, i) => {
                const on = days.includes(String(i + 1));
                return (
                  <button key={d} type="button" aria-pressed={on} onClick={() => setDays((x) => (on ? x.replace(String(i + 1), "") : [...x, String(i + 1)].sort().join("")))}
                    className={cn("h-7 w-8 rounded-md border text-[12px] font-medium transition-colors", on ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>{d}</button>
                );
              })}
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" className="ml-auto h-7 w-[92px] px-2 font-mono text-[12.5px]" />
            </div>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" className="flex-1" onClick={repeat} disabled={!!busy || !days}><CalendarClock />{schedule ? "Update schedule" : "Save schedule"}</Button>
              {schedule ? <Button size="sm" variant="ghost" onClick={unschedule} disabled={!!busy}>Stop repeating</Button> : null}
            </div>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function Sites() {
  const tabTick = useTabChanges();
  const [list, setList] = useState<string[] | null>(null);
  const [tab, setTab] = useState<{ site: string | null } | null>(null);
  const { busy, run } = useAction();
  const load = () => Promise.all([ext<{ sites: string[] }>("sites").then((r) => setList(r.sites)), ext("currentTab").then(setTab)]).catch(() => {});
  useEffect(() => { if (inPanel) load(); }, [tabTick]);
  if (!inPanel) return null;
  const here = tab?.site;
  const connect = () => run("connect", async () => { const r = await ext<{ cookies: number }>("connect"); toast.success(`Connected ${here}. Showrun can work there with your login.`); void r; await load(); });
  const drop = (s: string) => run(s, async () => { await ext("disconnect", { site: s }); await load(); });
  return (
    <section>
      <H>Connected sites</H>
      <p className="mb-2 text-[12.5px] text-muted-foreground">Showrun works on these with the login you already have, even when Chrome is closed. Your login stays on this computer.</p>
      {list?.length ? (
        <ul className="divide-y divide-rule rounded-lg border bg-card">
          {list.map((s) => (
            <li key={s} className="flex items-center gap-2 px-3 py-2">
              <Globe className="size-3.5 text-muted-foreground" /><span className="font-medium">{s}</span>
              <Button size="xs" variant="ghost" className="ml-auto text-muted-foreground" disabled={busy === s} onClick={() => drop(s)}>Disconnect</Button>
            </li>
          ))}
        </ul>
      ) : null}
      {here && !list?.includes(here) ? (
        <Button variant="outline" className="mt-2 w-full" onClick={connect} disabled={!!busy}>
          {busy === "connect" ? <LoaderCircle className="animate-spin" /> : <Globe />}Connect {here}
        </Button>
      ) : null}
    </section>
  );
}
