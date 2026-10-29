import { useState } from "react";
import { toast } from "sonner";
import { CalendarClock, Check, FolderOpen, Eye, ChevronRight, CircleAlert, Code2, Ellipsis, Hand, LoaderCircle, Mic, RotateCcw, ShieldAlert, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Orb, Said, useAction } from "@/components/bits";
import { RunButton, useRunTask } from "@/components/run-button";
import { ScheduleEditor, describeSchedule } from "@/components/schedule";
import { Content, PageHead } from "@/components/shell";
import { RunsList } from "@/pages/activity";
import { cn } from "@/lib/utils";
import { ago, api, useApi, type FolderRow, type ScheduleRow, type SessionFull, type SpecRow, type Task } from "@/lib/api";

const LEARNING: Record<string, string> = {
  listening: "Listening back to what you said",
  understanding: "Working out the steps and your rules",
  building: "Writing your rules as code and testing them",
};
const words = (s?: string | null) => s?.replaceAll("_", " ") ?? "";

/** Home: every task Remuse knows, what it does, when it runs, what it last said. */
export function TasksPage() {
  const { data: tasks, error, reload } = useApi<Task[]>("/tasks", 3000, () => true);
  const { data: sched } = useApi<ScheduleRow[]>("/schedules", 5000, () => true);
  return (
    <Content>
      <PageHead title="Tasks" sub="Show Remuse a task once from the Chrome sidebar. It learns it and shows up here, ready to do again." />
      {error ? <p className="text-destructive">{error}</p> : !tasks ? <div className="h-28 animate-pulse rounded-2xl bg-muted" /> : !tasks.length ? (
        <div className="glass flex flex-col items-center rounded-2xl px-6 py-14 text-center">
          <Orb size={64} />
          <p className="mt-6 text-[17px] font-medium">No tasks yet</p>
          <p className="mt-1 max-w-[46ch] text-muted-foreground">In Chrome, click the Remuse icon, press <span className="text-foreground">Watch me</span> and do the task once while saying why. Remuse does the rest.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {tasks.map((t) => <TaskCard key={t.sessionId} t={t} schedule={sched?.find((s) => s.sessionId === t.sessionId) ?? null} onChange={reload} />)}
        </ul>
      )}
    </Content>
  );
}

function TaskCard({ t, schedule, onChange }: { t: Task; schedule: ScheduleRow | null; onChange: () => void }) {
  const learning = t.learnStage && LEARNING[t.learnStage];
  const { busy, run } = useAction();
  const relearn = () => run("relearn", async () => { await api(`/sessions/${t.sessionId}/learn`, "POST"); onChange(); });
  return (
    <li className="glass rounded-2xl">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
        <a href={`#/task/${t.sessionId}`} className="min-w-0 flex-1 text-foreground no-underline">
          <span className="flex items-center gap-2.5">
            {learning ? <Orb size={16} state="thinking" /> : null}
            <span className="truncate text-[15px] font-medium">{t.title || "New task"}</span>
          </span>
          <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
            {learning ? <span className="shimmer">{learning}…</span> : t.learnStage === "failed" ? <span className="text-warn">Couldn't learn this: {t.learnError}</span> : t.goal}
          </span>
          {!learning && t.learnStage !== "failed" ? (
            <span className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><CalendarClock className="size-3.5" />{schedule ? `Repeats ${describeSchedule(schedule)}` : "Runs when you ask"}</span>
              {t.lastReport ? <span>Last update {ago(t.lastReport.at)}</span> : null}
            </span>
          ) : null}
        </a>
        {t.learnStage === "failed" ? <Button size="sm" variant="outline" className="rounded-full" onClick={relearn} disabled={!!busy}><RotateCcw />Try again</Button>
          : learning || !t.specId ? null : <RunButton task={t} size="sm" />}
      </div>
      {t.lastReport ? (
        <a href={`#/run/${t.lastReport.runId}`} className="block border-t border-rule px-5 py-3 text-[13.5px] text-foreground no-underline hover:bg-white/[0.03]">{t.lastReport.text}</a>
      ) : null}
    </li>
  );
}

/** One task: Overview, Activity, How it works, Recording. Running and scheduling live in the header. */
export function TaskPage({ id, tab = "overview" }: { id: string; tab?: string }) {
  const { data: tasks, reload } = useApi<Task[]>("/tasks", 3000, () => true);
  const { data: sched, reload: reloadSched } = useApi<ScheduleRow[]>("/schedules");
  const t = tasks?.find((x) => x.sessionId === id);
  const { data: spec } = useApi<SpecRow>(t?.specId ? `/specs/${t.specId}` : null);
  const [editing, setEditing] = useState<null | "schedule" | "delete">(null);
  const [cur, setCur] = useState(tab);
  const { busy, run } = useAction();
  if (tasks && !t) return <Content><PageHead title="Task not found" back={{ href: "#/", label: "Tasks" }} /></Content>;
  if (!t) return <Content><div className="h-40 animate-pulse rounded-2xl bg-muted" /></Content>;
  const schedule = sched?.find((s) => s.sessionId === id) ?? null;
  const learning = t.learnStage && LEARNING[t.learnStage];

  const del = () => run("delete", async () => { await api(`/sessions/${id}`, "DELETE"); toast(`Deleted ${t.title ?? "the task"}.`); location.hash = "#/"; });
  const relearn = () => run("relearn", async () => { await api(`/sessions/${id}/learn`, "POST"); reload(); });
  const setTab = (v: string) => { setCur(v); history.replaceState(null, "", `#/task/${id}/${v}`); };

  return (
    <Content>
      <PageHead
        back={{ href: "#/", label: "Tasks" }}
        title={<span className="flex items-center gap-3">{learning ? <Orb size={22} state="thinking" /> : null}{t.title || "New task"}</span>}
        sub={learning ? <span className="shimmer">{learning}…</span> : t.goal}
        actions={learning ? null : (
          <>
            {t.specId ? <RunButton task={t} /> : null}
            <TaskMenu t={t} hasSchedule={!!schedule} onSchedule={() => setEditing("schedule")} onRelearn={relearn} onDelete={() => setEditing("delete")} busy={!!busy} />
          </>
        )}
      />

      <Tabs value={cur} onValueChange={setTab}>
        <TabsList variant="line" className="w-full justify-start gap-5 overflow-x-auto overflow-y-hidden border-b *:flex-none *:px-0.5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="how">How it works</TabsTrigger>
          <TabsTrigger value="recording">Recording</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-6">
            {t.lastReport ? (
              <section className="glass rounded-2xl px-5 py-4">
                <p className="text-[12.5px] text-muted-foreground">Latest update · {ago(t.lastReport.at)}</p>
                <p className="mt-1.5 text-[17px] leading-snug">{t.lastReport.text}</p>
              </section>
            ) : null}
            {spec ? <WhatItDoes spec={spec} /> : null}
            {t.rules.length ? (
              <section>
                <h2 className="mb-2 text-[13px] font-medium text-muted-foreground">Your rules, in your words</h2>
                <ol className="glass divide-y divide-rule overflow-hidden rounded-2xl">
                  {t.rules.map((r, i) => (
                    <li key={i} className="px-5 py-3">
                      {r.said ? <Said>{r.said}</Said> : <span>If {r.if}</span>}
                      <span className="text-muted-foreground"> → {words(r.then)}</span>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}
            <section>
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-[13px] font-medium text-muted-foreground">Recent runs</h2>
                <button type="button" className="text-[13px] text-muted-foreground hover:text-foreground" onClick={() => setTab("activity")}>See all</button>
              </div>
              <RunsList task={id} limit={3} />
            </section>
          </div>
          <aside className="space-y-4">
            <section className="glass rounded-2xl px-5 py-4">
              <p className="text-[13px] font-medium">When it runs</p>
              <p className="mt-1 text-muted-foreground">{schedule ? `By itself, ${describeSchedule(schedule)}. Chrome can be closed.` : "Only when you press Run now."}</p>
              {t.askedSchedule && !schedule ? <p className="mt-1 text-[12.5px] text-muted-foreground">You said “{t.askedSchedule.said ?? describeSchedule(t.askedSchedule)}”.</p> : null}
              <Button size="sm" variant="outline" className="mt-3 rounded-full" onClick={() => setEditing("schedule")}><CalendarClock />{schedule ? "Change" : t.askedSchedule ? `Repeat ${describeSchedule(t.askedSchedule)}` : "Repeat by itself"}</Button>
            </section>
            <Safety spec={spec} />
            {t.specId ? <FilesCard t={t} onChange={reload} /> : null}
            <section className="glass rounded-2xl px-5 py-4 text-[13px]">
              <p className="font-medium">Checks</p>
              <p className={t.checks.total && t.checks.passed === t.checks.total ? "mt-1 inline-flex items-center gap-1.5 text-ok" : "mt-1 inline-flex items-center gap-1.5 text-warn"}>
                {t.checks.total && t.checks.passed === t.checks.total ? <Check className="size-3.5" /> : <CircleAlert className="size-3.5" />}
                {t.checks.passed} of {t.checks.total} pass against your demo
              </p>
              {t.guessed.length ? <p className="mt-1 text-warn">I guessed how to {t.guessed.map(words).join(", ")}. Check it under How it works.</p> : null}
            </section>
          </aside>
        </TabsContent>

        <TabsContent value="activity" className="mt-6"><RunsList task={id} /></TabsContent>

        <TabsContent value="how" className="mt-6">{spec ? <HowItWorks spec={spec} /> : null}</TabsContent>

        <TabsContent value="recording" className="mt-6"><RecordingSummary id={id} /></TabsContent>
      </Tabs>

      <Dialog open={editing === "schedule"} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogTitle>Repeat by itself</DialogTitle>
          <DialogDescription>Remuse runs it on its own, even with Chrome closed, and tells you when it needs you.</DialogDescription>
          <ScheduleEditor task={t} schedule={schedule} onSaved={() => { reloadSched(); setEditing(null); }} />
        </DialogContent>
      </Dialog>
      <Dialog open={editing === "delete"} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogTitle>Delete {t.title ?? "this task"}?</DialogTitle>
          <DialogDescription>Its recording, schedule and run history go too. This can't be undone.</DialogDescription>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="destructive" onClick={del} disabled={!!busy}>{busy === "delete" ? <LoaderCircle className="animate-spin" /> : <Trash2 />}Delete</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Content>
  );
}

/** The task in plain words: where it starts, what it does each time, how it ends. */
function WhatItDoes({ spec: row }: { spec: SpecRow }) {
  const s = row.spec;
  const outcomes = Object.entries(s.outcomes);
  return (
    <section>
      <h2 className="mb-2 text-[13px] font-medium text-muted-foreground">What it does</h2>
      <ol className="glass divide-y divide-rule overflow-hidden rounded-2xl">
        {s.steps.map((st, i) => (
          <li key={st.id ?? i} className="flex gap-3 px-5 py-3">
            <span className="w-5 shrink-0 pt-px text-right font-mono text-[12px] text-muted-foreground">{i + 1}</span>
            <span>{st.describe}</span>
          </li>
        ))}
        {outcomes.length ? (
          <li className="flex gap-3 px-5 py-3">
            <span className="w-5 shrink-0" />
            <span className="text-muted-foreground">Then {outcomes.length === 1 ? words(outcomes[0][1].describe).replace(/^./, (c) => c.toLowerCase()) : `one of: ${outcomes.map(([k]) => words(k)).join(", ")}`}</span>
          </li>
        ) : null}
      </ol>
    </section>
  );
}

/** What it will never do without asking. */
function Safety({ spec }: { spec?: SpecRow | null }) {
  const gated = spec ? [...spec.spec.steps, ...Object.values(spec.spec.outcomes).flatMap((o) => o.steps)].filter((s) => s.irreversible) : [];
  return (
    <section className="glass rounded-2xl px-5 py-4 text-[13px]">
      <p className="flex items-center gap-1.5 font-medium"><Hand className="size-3.5" />Waits for your OK</p>
      {gated.length
        ? <ul className="mt-1.5 space-y-1 text-muted-foreground">{gated.map((g, i) => <li key={i}>{g.describe}</li>)}</ul>
        : <p className="mt-1 text-muted-foreground">Nothing in this task pays, sends or submits. It still asks if something looks off.</p>}
    </section>
  );
}

/** Behind the scenes, kept short: the full detail is in the advanced editor. */
function HowItWorks({ spec: row }: { spec: SpecRow }) {
  const s = row.spec;
  const tests = row.tests ?? [];
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section>
        <h2 className="mb-2 text-[13px] font-medium text-muted-foreground">What it reads</h2>
        <ul className="glass divide-y divide-rule overflow-hidden rounded-2xl">
          {s.variables.map((v) => (
            <li key={v.name} className="px-5 py-2.5">
              <span className="font-mono text-[12.5px]">{v.name}</span>
              <span className="block text-[13px] text-muted-foreground">{v.description}</span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="mb-2 text-[13px] font-medium text-muted-foreground">Checks against your demo</h2>
        <ul className="glass divide-y divide-rule overflow-hidden rounded-2xl">
          {tests.map((x, i) => (
            <li key={i} className="flex gap-2.5 px-5 py-2.5 text-[13px]">
              {x.ok ? <Check className="mt-0.5 size-3.5 shrink-0 text-ok" /> : <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />}{x.name}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[13px] text-muted-foreground">
          Version {row.version}{row.note ? ` · ${row.note}` : ""}. <a href={`#/spec/${row.id}`}>Open the advanced editor</a> to see every step, the code, and to edit or rebuild it.
        </p>
      </section>
    </div>
  );
}

/** What you showed and said, in short. */
function RecordingSummary({ id }: { id: string }) {
  const { data: s } = useApi<SessionFull>(`/sessions/${id}`);
  if (!s) return <div className="h-24 animate-pulse rounded-2xl bg-muted" />;
  const actions = s.events.filter((e) => e.kind !== "start" && e.kind !== "tools").length;
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">Recorded {new Date(s.started_at).toLocaleString()} · {actions} actions · {s.turns.length} things you said</p>
      {s.turns.length ? (
        <ul className="glass divide-y divide-rule overflow-hidden rounded-2xl">
          {s.turns.map((v, i) => <li key={i} className="flex gap-3 px-5 py-3"><Mic className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /><Said>{v.text}</Said></li>)}
        </ul>
      ) : <p className="text-muted-foreground">No voice in this recording.</p>}
      <a href={`#/session/${id}`} className="inline-flex items-center gap-1 text-[13px] text-muted-foreground">See every click with screenshots<ChevronRight className="size-3.5" /></a>
    </div>
  );
}

/** The task's other actions, each with its icon: run without approvals, schedule, learn again, editor, delete. */
function TaskMenu({ t, hasSchedule, onSchedule, onRelearn, onDelete, busy }: { t: Task; hasSchedule: boolean; onSchedule: () => void; onRelearn: () => void; onDelete: () => void; busy: boolean }) {
  const runner = useRunTask(t);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="rounded-full" aria-label="More"><Ellipsis /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
      {t.built ? <DropdownMenuItem onSelect={() => runner.open("watch")}><Eye />Run and watch it work</DropdownMenuItem> : null}
      {t.built ? <DropdownMenuItem onSelect={() => runner.open("unattended")}><ShieldAlert />Run without asking me</DropdownMenuItem> : null}
          <DropdownMenuItem onSelect={() => onSchedule()}><CalendarClock />{hasSchedule ? "Change schedule" : "Repeat by itself…"}</DropdownMenuItem>
          <DropdownMenuItem onSelect={onRelearn} disabled={busy}><RotateCcw />Learn again from the recording</DropdownMenuItem>
          {t.specId ? <DropdownMenuItem onSelect={() => { location.hash = `#/spec/${t.specId}`; }}><Code2 />Advanced editor</DropdownMenuItem> : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => onDelete()}><Trash2 />Delete task</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {runner.dialog}
    </>
  );
}

const PICKS = { next: "Next in line (never repeats)", newest: "Newest file", dated: "Labelled for today and now" } as const;
const sel = "w-full rounded-lg border border-input bg-black/30 px-2.5 py-1.5 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

/** Which folder uploads come from (and which file), and where downloads go. Changes save a new version. */
function FilesCard({ t, onChange }: { t: Task; onChange: () => void }) {
  const { data: folders } = useApi<FolderRow[]>("/folders");
  const up = t.uploads[0];
  const { data: next } = useApi<{ folder: string | null; file: string | null }>(up ? `/specs/${t.specId}/next-file` : null, 15000, () => true);
  const { busy, run } = useAction();
  const save = (body: object, msg: string) => run("files", async () => { await api(`/specs/${t.specId}/files`, "POST", body); toast.success(msg); onChange(); });
  const byName = (name: string | null) => folders?.find((f) => f.name === name)?.id ?? "";
  if (!folders) return null;
  return (
    <section className="glass space-y-3 rounded-2xl px-5 py-4 text-[13px]">
      <p className="flex items-center gap-1.5 font-medium"><FolderOpen className="size-3.5" />Files</p>
      {!folders.length ? <p className="text-muted-foreground">Add a folder on the <a href="#/folders">Folders</a> page to upload from it or save downloads into it.</p> : (
        <>
          {up ? (
            <div className="space-y-1.5">
              <label className="block text-muted-foreground">Uploads from
                <select className={cn(sel, "mt-1")} value={byName(up.folder)} disabled={!!busy} onChange={(e) => save({ uploadFolder: e.target.value || null }, "Upload folder saved.")}>
                  <option value="">Choose a folder…</option>
                  {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </label>
              <label className="block text-muted-foreground">Which file
                <select className={cn(sel, "mt-1")} value={up.pick} disabled={!!busy} onChange={(e) => save({ pick: e.target.value }, "Saved.")}>
                  {Object.entries(PICKS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              {up.folder ? <p className="text-muted-foreground">Next upload: <span className="text-foreground">{next?.file ?? "nothing new yet"}</span></p> : <p className="text-warn">Choose a folder so it can upload.</p>}
            </div>
          ) : null}
          <label className="block text-muted-foreground">Save downloads to
            <select className={cn(sel, "mt-1")} value={byName(t.saveDownloads)} disabled={!!busy} onChange={(e) => save({ saveDownloads: e.target.value || null }, e.target.value ? "Downloads will be saved there." : "Downloads won't be kept.")}>
              <option value="">Don't keep downloads</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
        </>
      )}
    </section>
  );
}
