import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Kbd } from "@/components/ui/kbd";
import { Empty, ErrorNote, Page, Status } from "@/components/bits";
import { fmtWhen, isLive, useApi, type RunRow, type SessionRow } from "@/lib/api";

const go = (href: string) => () => { location.hash = href; };
const rowCls = "cursor-pointer";

export function Home() {
  const { data, error } = useApi<SessionRow[]>("/sessions");
  return (
    <Page>
      <h1 className="text-[22px] font-semibold">Recordings</h1>
      <p className="mt-1 max-w-[68ch] text-muted-foreground">
        Do a task once in Chrome with the Showrun extension recording, and say your reasons out loud as you go.
        Showrun turns the recording into a Task Spec you can check, then repeats it on every new item.
      </p>
      <div className="mt-6">
        {error ? <ErrorNote>{error}</ErrorNote> : !data ? <Loading /> : !data.length ? (
          <Empty title="No recordings yet">
            Click the Showrun icon in Chrome, press <Kbd>Start recording</Kbd>, do the task once, then press <Kbd>Stop</Kbd>. It shows up here.
          </Empty>
        ) : (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">Task</TableHead>
                  <TableHead className="w-44">Recorded</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                  <TableHead className="w-32 pr-4 text-right">Task Spec</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((s) => (
                  <TableRow key={s.id} className={rowCls} onClick={go(`#/session/${s.id}`)}>
                    <TableCell className="pl-4 font-medium"><a href={`#/session/${s.id}`} className="text-foreground no-underline">{s.title || "Untitled task"}</a></TableCell>
                    <TableCell className="text-muted-foreground">{fmtWhen(s.started_at)}</TableCell>
                    <TableCell className="text-right font-mono text-[13px]">{s.events}</TableCell>
                    <TableCell className="pr-4 text-right">
                      {s.latest_spec ? <a href={`#/spec/${s.latest_spec}`} onClick={(e) => e.stopPropagation()}>Open spec</a> : <span className="text-muted-foreground">Not written</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </Page>
  );
}

export function Runs() {
  const { data, error } = useApi<RunRow[]>("/runs", 3000, (d) => d.some((r) => isLive(r.status)));
  return (
    <Page>
      <h1 className="text-[22px] font-semibold">Runs</h1>
      <p className="mt-1 text-muted-foreground">Every time a Task Spec was played on a list. The latest 20.</p>
      <div className="mt-6">
        {error ? <ErrorNote>{error}</ErrorNote> : !data ? <Loading /> : !data.length ? (
          <Empty title="No runs yet">Open a Task Spec, build it, then press Run on the list.</Empty>
        ) : (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">Started</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Right answer</TableHead>
                  <TableHead className="pr-4 text-right">Spec</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((r) => (
                  <TableRow key={r.id} className={rowCls} onClick={go(`#/run/${r.id}`)}>
                    <TableCell className="pl-4 font-medium"><a href={`#/run/${r.id}`} className="text-foreground no-underline">{fmtWhen(r.startedAt)}</a></TableCell>
                    <TableCell><Status s={r.status === "failed" ? "failed" : r.status} /></TableCell>
                    <TableCell className="text-right font-mono text-[13px]">{r.items}</TableCell>
                    <TableCell className="text-right font-mono text-[13px]">{r.score ? `${r.score.matched} / ${r.score.total}` : "–"}</TableCell>
                    <TableCell className="pr-4 text-right"><a href={`#/spec/${r.specId}`} onClick={(e) => e.stopPropagation()}>#{r.specId}</a></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </Page>
  );
}

export function Loading() {
  return <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />)}</div>;
}
