import { LoaderCircle, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Crumb, ErrorNote, ItemLabel, Page, Revision, Said, Section, Shot, useAction } from "@/components/bits";
import { Loading } from "@/pages/lists";
import { api, fmtWhen, timecode, useApi, type SessionFull } from "@/lib/api";

const VERB: Record<string, string> = { start: "Started at", click: "Clicked", fill: "Typed into", input: "Typed into", change: "Changed", key: "Pressed", press: "Pressed", page: "Opened", navigate: "Opened", submit: "Submitted" };

export function Session({ id }: { id: string }) {
  const { data: s, error } = useApi<SessionFull>(`/sessions/${id}`);
  const { busy, run } = useAction();
  if (error) return <Page><ErrorNote>{error}</ErrorNote></Page>;
  if (!s) return <Page><Loading /></Page>;

  const file = (f?: string) => (f ? `/api/sessions/${id}/files/${f}` : "");
  const rows = [
    ...s.events.map((e, i) => ({ t: e.t, key: `e${i}`, voice: false as const, e })),
    ...s.turns.map((v, i) => ({ t: v.startMs, key: `v${i}`, voice: true as const, v })),
  ].sort((a, b) => a.t - b.t);

  // Learn again: the same background pipeline as after recording; the task page shows progress.
  const write = () => run("spec", async () => {
    await api(`/sessions/${id}/learn`, "POST");
    location.hash = `#/task/${id}`;
  });

  return (
    <Page>
      <Crumb href={`#/task/${id}/recording`}>Back to the task</Crumb>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold">{s.title || "Untitled task"}</h1>
          <p className="mt-1 text-muted-foreground">
            Recorded {fmtWhen(s.started_at)} · {s.events.length} actions · {s.turns.length} things you said
          </p>
        </div>
        <Button onClick={write} disabled={!!busy} variant="outline" className="rounded-full">
          {busy ? <><LoaderCircle className="animate-spin" />Starting</> : "Learn it again"}
        </Button>
      </div>
      {busy ? <p className="mt-2 text-right text-[13px] text-muted-foreground">Muse Spark is watching the key frames and your words. About a minute.</p> : null}
      {s.transcribe_error ? <div className="mt-4"><ErrorNote>Your voice could not be transcribed: {s.transcribe_error}</ErrorNote></div> : null}

      {s.specs.length ? (
        <Section title="Task Spec versions">
          <div className="flex flex-wrap gap-1">{s.specs.map((x) => <Revision key={x.id} v={x.version} href={`#/spec/${x.id}`} />)}</div>
        </Section>
      ) : null}

      <Section title="What you did and said" aside="Before and after each action">
        <div className="rounded-lg border bg-card">
          <Table>
            <TableBody>
              {rows.map((r) => r.voice ? (
                <TableRow key={r.key} className="hover:bg-transparent">
                  <TableCell className="w-16 pl-4 align-top font-mono text-[12px] text-muted-foreground">{timecode(r.t)}</TableCell>
                  <TableCell colSpan={2} className="py-3 pr-4 whitespace-normal">
                    <span className="mr-2 inline-flex items-center gap-1 align-[1px] text-[12px] font-medium text-muted-foreground"><Mic className="size-3.5" />You said</span>
                    <span className="inline-block max-w-[78ch] align-top"><Said>{r.v.text}</Said></span>
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow key={r.key} className="hover:bg-transparent">
                  <TableCell className="w-16 pl-4 align-top font-mono text-[12px] text-muted-foreground">{timecode(r.t)}</TableCell>
                  <TableCell className="align-top whitespace-normal">
                    <span className="text-muted-foreground">{VERB[r.e.kind] ?? r.e.kind} </span>
                    {r.e.target ? (
                      <>
                        <span className="text-muted-foreground">{r.e.target.role || r.e.target.tag} </span>
                        <span className="font-medium"><ItemLabel text={r.e.target.label || r.e.target.text || ""} /></span>
                      </>
                    ) : <span className="font-mono text-[12px] break-all">{r.e.url}</span>}
                    {r.e.value !== undefined ? <span className="font-mono text-[12.5px]"> = “{r.e.value}”</span> : null}
                  </TableCell>
                  <TableCell className="w-[332px] pr-4">
                    {r.e.before || r.e.after ? (
                      <div className="grid grid-cols-2 gap-2">
                        {r.e.before ? <Shot src={file(r.e.before)} alt="Screen before the action" caption="Before" /> : <span />}
                        {r.e.after ? <Shot src={file(r.e.after)} alt="Screen after the action" caption="After" /> : null}
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>
    </Page>
  );
}
