import { Status } from "@/components/bits";
import { Content, PageHead } from "@/components/shell";
import { ago, fmtSecs, isLive, useApi, type ActivityRun } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Every run, newest first: what ran, how it went, what it said. */
export function ActivityPage() {
  return (
    <Content>
      <PageHead title="Activity" sub="Every time Remuse did one of your tasks, newest first." />
      <RunsList />
    </Content>
  );
}

export function RunsList({ task, limit }: { task?: string; limit?: number }) {
  const { data, error } = useApi<ActivityRun[]>(task ? `/runs?task=${task}` : "/runs", 3000, () => true);
  if (error) return <p className="text-destructive">{error}</p>;
  if (!data) return <div className="h-24 animate-pulse rounded-2xl bg-muted" />;
  const runs = limit ? data.slice(0, limit) : data;
  if (!runs.length) return <p className="glass rounded-2xl px-5 py-8 text-center text-muted-foreground">Nothing has run yet. Press Run now on a task, or let a schedule start it.</p>;
  return (
    <ul className="glass divide-y divide-rule overflow-hidden rounded-2xl">
      {runs.map((r) => {
        const state = r.waiting ? "approval" : r.status === "done" && r.done < r.items ? "done" : r.status;
        const took = r.endedAt ? fmtSecs(r.endedAt - r.startedAt) : null;
        return (
          <li key={r.id}>
            <a href={`#/run/${r.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-1 px-5 py-3.5 text-foreground no-underline transition-colors hover:bg-white/[0.035] sm:grid-cols-[minmax(0,1fr)_150px_120px]">
              <span className="min-w-0">
                {task ? null : <span className="block truncate font-medium">{r.task ?? "Untitled task"}</span>}
                <span className={cn("block truncate text-[13px]", task ? "text-foreground" : "text-muted-foreground")}>
                  {r.mode === "practice" ? `Practice on your example${r.practiceOk === true ? ": matched what you did" : r.practiceOk === false && r.status === "done" ? ": something didn't match" : ""}` : r.report ?? (r.error ? r.error : r.items ? `${r.done} of ${r.items} done` : "Starting")}
                </span>
              </span>
              <Status s={r.waiting ? "approval" : isLive(r.status) ? "running" : (state as any)} className="justify-self-end sm:justify-self-start" />
              <span className="hidden text-right text-[13px] text-muted-foreground sm:block">
                {ago(r.startedAt)}{took ? <span className="block font-mono text-[12px]">{took}</span> : null}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
