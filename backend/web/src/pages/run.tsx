import { useEffect, useState } from "react";
import { Check, CircleAlert, LoaderCircle, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Crumb, ErrorNote, ItemLabel, Orb, Page, Revision, Shot, Status, useAction } from "@/components/bits";
import { Loading } from "@/pages/lists";
import { api, fmtSecs, fmtWhen, isLive, timecode, useApi, type Candidate, type Item, type Pending, type Run, type SpecRow } from "@/lib/api";
import { cn } from "@/lib/utils";

const settled = (i: Item) => ["done", "skipped", "failed"].includes(i.status);
const dur = (i: Item, now: number) => (i.log.length ? (settled(i) ? i.log[i.log.length - 1].at : now) - i.log[0].at : 0);
const matches = (i: Item) => (i.expected === "ask" ? i.decidedBy !== "rules" : i.outcome === i.expected);
const words = (s?: string) => s?.replaceAll("_", " ");
const clean = (s: string) => s.replace(/^[\u2713\u2714]\s*/, "");

export function RunPage({ id }: { id: string }) {
  const { data: r, error, reload } = useApi<Run>(`/runs/${id}`, 1000, (d) => isLive(d.status));
  const [sel, setSel] = useState<number | null>(null);
  const { busy, run } = useAction();
  const { data: spec } = useApi<SpecRow>(r ? `/specs/${r.specId}` : null);
  if (error) return <Page><ErrorNote>{error}</ErrorNote></Page>;
  if (!r) return <Page><Loading /></Page>;

  const live = isLive(r.status);
  const now = live ? Date.now() : r.endedAt ?? Date.now();
  const done = r.items.filter(settled).length;
  const shown = sel ?? Math.min(r.current, r.items.length - 1);
  const it = r.items[shown];
  const file = (f: string) => `/api/runs/${id}/files/${f}`;
  const scale = Math.max(1, ...r.items.map((i) => dur(i, now)));
  const stop = () => run("stop", async () => { await api(`/runs/${id}/stop`, "POST"); reload(); });
  const answer = (body: object) => run("answer", async () => { await api(`/runs/${id}/answer`, "POST", body); reload(); });

  return (
    <Page>
      <div className="flex flex-wrap items-center gap-2">
        <Crumb href={`#/spec/${r.specId}`}>Task Spec</Crumb>
        {spec ? <Revision v={spec.version} href={`#/spec/${r.specId}`} /> : null}
      </div>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div>
          <h1 className="text-[22px] font-semibold">Run of {fmtWhen(r.startedAt)}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
            <Status s={r.status} />
            <span><span className="font-mono text-[13px] text-foreground">{done} of {r.items.length}</span> items finished</span>
            {r.autoApprove ? <span>· approving in advance</span> : null}
            {r.newSpecId ? <span>· <a href={`#/spec/${r.newSpecId}`}>New spec version from this run</a></span> : null}
          </p>
        </div>
        <div className="flex items-center gap-5">
          {r.score ? (
            <p className="text-right leading-tight">
              <span className="font-mono text-[22px] font-semibold">{r.score.matched}<span className="text-muted-foreground"> / {r.score.total}</span></span>
              <span className="block text-[12px] text-muted-foreground">match the right answer</span>
            </p>
          ) : null}
          {live ? <Button variant="outline" onClick={stop} disabled={!!busy}><Square className="fill-current" />Stop</Button> : null}
        </div>
      </div>
      {r.error ? <div className="mt-4"><ErrorNote>{r.error}</ErrorNote></div> : null}

      <div className="mt-6 grid items-start gap-6 min-[900px]:grid-cols-[minmax(340px,420px)_minmax(0,1fr)] min-[1280px]:grid-cols-[460px_minmax(0,1fr)]">
        {/* The rundown: items in order, each with its time drawn to one shared scale. */}
        <div className="overflow-hidden rounded-lg border bg-card max-[899px]:order-2">
          <div className="grid grid-cols-[32px_1fr_104px] gap-2 border-b bg-muted/50 px-3 py-2 text-[12px] font-medium text-muted-foreground">
            <span className="text-right">No.</span><span>Item and outcome</span><span className="flex justify-between">Time<span className="font-mono font-normal">0–{fmtSecs(scale)}</span></span>
          </div>
          <ol>
            {r.items.map((i, n) => {
              const d = dur(i, now);
              const isLiveRow = live && n === r.current && !settled(i);
              return (
                <li key={i.url}>
                  <button type="button" onClick={() => setSel(n)} aria-current={n === shown}
                    className={cn("grid w-full grid-cols-[32px_1fr_104px] items-start gap-2 border-b border-rule px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-muted/60", n === shown && "bg-muted")}>
                    <span className="pt-px text-right font-mono text-[12px] text-muted-foreground">{n + 1}</span>
                    <span className="min-w-0">
                      <span className="line-clamp-2 font-medium leading-snug" title={i.label}><ItemLabel text={i.label} /></span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-muted-foreground">
                        <Status s={i.status} word={i.status !== "done" || !i.outcome} />
                        {i.outcome ? <span className="text-foreground capitalize">{i.status !== "done" ? "· " : ""}{words(i.outcome)}</span> : null}
                        {i.decidedBy && i.decidedBy !== "rules" ? <span>· {i.decidedBy === "you" ? "you decided" : "learned"}</span> : null}
                        {i.expected && i.outcome && !matches(i) ? <span className="text-destructive">· expected {words(i.expected)}</span> : null}
                      </span>
                    </span>
                    <span className="pt-1">
                      <span className="block h-1.5 w-full">
                        <span className={cn("block h-full", isLiveRow ? "live-bar bg-tally" : i.status === "failed" ? "bg-destructive/40" : i.status === "skipped" ? "bg-muted-foreground/40" : "bg-foreground/75")}
                          style={{ width: `${d ? Math.max(3, (d / scale) * 100) : 0}%` }} />
                      </span>
                      <span className={cn("mt-1 block font-mono text-[11.5px]", isLiveRow ? "text-tally" : "text-muted-foreground")}>{d ? fmtSecs(d) : "–"}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="min-w-0 space-y-6 max-[899px]:order-1">
          {r.pending ? <PendingCard key={`${r.pending.kind}-${r.pending.item}-${r.pending.shot}`} p={r.pending} r={r} file={file} busy={!!busy} answer={answer} /> : null}

          {r.heals.length || r.learned.length ? (
            <section className="rounded-lg border bg-card px-4 py-3">
              <h2 className="text-[13px] font-semibold">Changed during this run</h2>
              <ul className="mt-1.5 space-y-1">
                {[...new Set(r.heals.map((h) => `“${h.from}” is now “${h.to}”`)), ...r.learned.map((l) => `Learned: ${words(l.requestType)} → ${words(l.outcome)}${l.note ? `. ${l.note}` : ""}`)].map((t) => (
                  <li key={t} className="grid grid-cols-[1fr_16px] gap-2"><span>{t}</span><span className="font-mono font-semibold" aria-label="changed">*</span></li>
                ))}
              </ul>
              <p className="mt-1.5 text-[12.5px] text-muted-foreground">These go into the next spec version when the run ends.</p>
            </section>
          ) : null}

          {!r.pending && it ? (
            <section>
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="truncate text-[15px] font-semibold"><span className="mr-2 font-mono text-[13px] text-muted-foreground">{shown + 1}</span><ItemLabel text={it.label} /></h2>
                <Status s={it.status} />
              </div>
              {it.because ? <p className="mt-1.5">Decision: <span className="font-semibold capitalize">{words(it.outcome)}</span>, because {words(it.because)}</p> : null}
              {it.report ? (
                <div className="glass mt-3 rounded-2xl px-4 py-3">
                  <p className="text-[12.5px] text-muted-foreground">Update</p>
                  <p className="mt-1 text-[16px] leading-snug whitespace-pre-wrap">{it.report}</p>
                </div>
              ) : null}
              {it.candidates?.length ? <Compared list={it.candidates} file={file} /> : null}
              {it.log.some((l) => l.shot) ? (
                <div className="mt-4">
                  <h3 className="mb-2 text-[13px] font-semibold">Screens checked</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {it.log.filter((l) => l.shot).map((l, k) => <Shot key={k} src={file(l.shot!)} alt={clean(l.msg)} caption={clean(l.msg)} />)}
                  </div>
                </div>
              ) : null}
              <h3 className="mt-5 text-[13px] font-semibold">Step by step</h3>
              <ol className="mt-2 rounded-lg border bg-card px-4">
                {it.log.length ? it.log.map((l, k) => (
                  <li key={k} className="grid grid-cols-[44px_1fr] gap-2 border-b border-rule py-1.5 text-[13px] last:border-b-0">
                    <span className="pt-px font-mono text-[11.5px] text-muted-foreground">{timecode(l.at - it.log[0].at)}</span>
                    <span className={cn(l.level === "warn" && "text-warn", l.level === "error" && "text-destructive")}>
                      {l.level === "warn" || l.level === "error" ? <CircleAlert className="mr-1 inline size-3.5 align-[-2px]" /> : l.level === "ok" ? <Check className="mr-1 inline size-3.5 align-[-2px] text-ok" /> : null}
                      {clean(l.msg)}
                    </span>
                  </li>
                )) : <li className="py-3 text-muted-foreground">Not started yet.</li>}
              </ol>
              {live && r.shot && shown === r.current ? <div className="mt-4"><Shot src={file(r.shot)} alt="Latest screen" caption="Latest screen" /></div> : null}
            </section>
          ) : null}
        </div>
      </div>
    </Page>
  );
}

export function PendingCard({ p, r, file, busy, answer }: { p: Pending; r: Run; file: (f: string) => string; busy: boolean; answer: (b: object) => void }) {
  const [outcome, setOutcome] = useState(p.kind === "ask" ? p.options[0] ?? "" : "");
  const [note, setNote] = useState("");
  const [reply, setReply] = useState("");
  const [learn, setLearn] = useState(true);
  const label = r.items[p.item]?.label;

  // A approves, R skips. Ignored while typing.
  useEffect(() => {
    if (p.kind !== "approval") return;
    const on = (e: KeyboardEvent) => {
      if (busy || e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest("input,textarea,select")) return;
      if (e.key === "a") answer({ decision: "approve" });
      if (e.key === "r") answer({ decision: "reject" });
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [p, busy, answer]);

  if (p.kind === "handoff") return (
    <section className="animate-in fade-in slide-in-from-top-2 glass overflow-hidden rounded-2xl duration-300 ease-out" aria-live="assertive">
      <div className="flex items-center gap-2.5 border-b border-rule px-4 py-3">
        <Orb state="waiting" size={20} /><h2 className="text-[14px] font-semibold">Your turn in the browser</h2>
        <span className="ml-auto font-mono text-[12px] text-muted-foreground">Item {p.item + 1}</span>
      </div>
      <div className="grid gap-4 p-4">
        <div>
          <p className="text-muted-foreground"><ItemLabel text={label ?? ""} /></p>
          <p className="mt-1 text-[16px] leading-snug">I got stuck on <span className="font-semibold">{p.step.replace(/^./, (c) => c.toLowerCase())}</span>.</p>
          <p className="mt-1.5 text-muted-foreground">{p.problem}</p>
          <p className="mt-1.5">If a sign-in page, a security check or a popup is in the way, deal with it in the Remuse browser window, then try again.</p>
        </div>
        <Shot src={file(p.shot)} alt="The screen where Remuse got stuck" />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="lg" onClick={() => answer({ decision: "retry" })} disabled={busy}>Try again</Button>
          <Button size="lg" variant="ghost" className="ml-auto" onClick={() => answer({ decision: "skip" })} disabled={busy}>Skip this one</Button>
        </div>
      </div>
    </section>
  );

  const head = (icon: React.ReactNode, title: string) => (
    <div className="flex items-center gap-2.5 border-b border-rule px-4 py-3">
      {icon}<h2 className="text-[14px] font-semibold">{title}</h2>
      <span className="ml-auto font-mono text-[12px] text-muted-foreground">Item {p.item + 1}</span>
    </div>
  );

  if (p.kind === "approval") return (
    <section className="animate-in fade-in slide-in-from-top-2 glass overflow-hidden rounded-2xl duration-300 ease-out" aria-live="assertive">
      {head(<Orb state="waiting" size={20} />, "Waiting for your OK")}
      <div className="grid gap-4 p-4">
        <div>
          <p className="text-muted-foreground"><ItemLabel text={label ?? ""} /></p>
          <p className="mt-1 text-[16px] leading-snug">About to <span className="font-semibold">{p.step.replace(/^./, (c) => c.toLowerCase())}</span>{p.target && !p.step.includes(p.target) ? <> with “{p.target}”</> : null}</p>
          {p.because ? <p className="mt-1.5">Decision: <span className="font-semibold capitalize">{words(p.outcome)}</span>, because {words(p.because)}</p> : null}
          {p.healed ? <p className="mt-1.5 text-warn">{p.healed}</p> : null}
        </div>
        <Shot src={file(p.shot)} alt="The screen before this step" />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="lg" onClick={() => answer({ decision: "approve" })} disabled={busy}>Approve <Kbd className="ml-1 bg-background/15 text-background">A</Kbd></Button>
          <Button size="lg" variant="outline" onClick={() => answer({ decision: "approve_all" })} disabled={busy}>Approve all remaining</Button>
          <Button size="lg" variant="ghost" className="ml-auto" onClick={() => answer({ decision: "reject" })} disabled={busy}>
            Skip this one <Kbd className="ml-1">R</Kbd>
          </Button>
        </div>
      </div>
    </section>
  );

  return (
    <section className="animate-in fade-in slide-in-from-top-2 glass overflow-hidden rounded-2xl duration-300 ease-out" aria-live="assertive">
      {head(<Orb state="waiting" size={20} />, "Remuse has a question")}
      <div className="grid gap-5 p-4">
        <div>
          <p className="text-muted-foreground"><ItemLabel text={label ?? ""} /></p>
          <p className="mt-1 text-[16px] leading-snug">{p.question}</p>
        </div>
        <div className="grid gap-2">
          <Label className="text-[13px] font-semibold">What should it do?</Label>
          <RadioGroup value={outcome} onValueChange={setOutcome} className="grid gap-1.5 sm:grid-cols-2">
            {[...p.options, ""].map((o) => (
              <Label key={o || "skip"} className={cn("flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 font-normal", outcome === o && "border-foreground bg-muted")}>
                <RadioGroupItem value={o} />{o ? <span className="capitalize">{words(o)}</span> : <span className="text-muted-foreground">Skip this one</span>}
              </Label>
            ))}
          </RadioGroup>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="note" className="text-[13px] font-semibold">Why <span className="font-normal text-muted-foreground">Remuse remembers this</span></Label>
          <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Wrong item sent: ship the right one" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="reply" className="text-[13px] font-semibold">Reply to send instead <span className="font-normal text-muted-foreground">optional, {"{{variables}}"} work</span></Label>
          <Textarea id="reply" rows={3} value={reply} onChange={(e) => setReply(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Checkbox id="learn" checked={learn} onCheckedChange={(v) => setLearn(v === true)} />
            <Label htmlFor="learn" className="font-normal">Do the same for similar items without asking</Label>
          </div>
          <Button size="lg" className="ml-auto" disabled={busy}
            onClick={() => answer({ outcome: outcome || undefined, note: note || undefined, reply: reply || undefined, learn })}>
            {busy ? <LoaderCircle className="animate-spin" /> : null}{outcome ? "Use this answer" : "Skip it"}
          </Button>
        </div>
        <Shot src={file(p.shot)} alt="The item Remuse is asking about" />
      </div>
    </section>
  );
}

/** Every result Remuse opened for this item, ranked by the person's rule. */
function Compared({ list, file }: { list: Candidate[]; file: (f: string) => string }) {
  const keys = [...new Set(list.flatMap((c) => Object.keys(c.vars)))];
  const ranked = [...list].sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
  const show = (v: unknown) => (v === null || v === undefined ? "–" : typeof v === "number" ? (+v.toFixed(2)).toLocaleString() : String(v));
  return (
    <section className="mt-4">
      <h3 className="mb-2 text-[13px] font-semibold">Compared {list.length} results</h3>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-[12px] text-muted-foreground">
              <th className="px-3 py-2 font-medium">Result</th>
              {keys.map((k) => <th key={k} className="px-3 py-2 text-right font-medium whitespace-nowrap">{words(k)}</th>)}
              <th className="px-3 py-2 text-right font-medium">Score</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((c) => (
              <tr key={c.url} className={cn("border-b border-rule last:border-b-0", c.best && "bg-muted")}>
                <td className="max-w-[280px] px-3 py-2">
                  <a href={c.url} target="_blank" rel="noreferrer" className="line-clamp-2 text-foreground">{c.title || c.url}</a>
                  {c.best ? <span className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-medium text-ok"><Check className="size-3.5" />Chosen</span> : null}
                  {c.shot ? <a href={file(c.shot)} target="_blank" rel="noreferrer" className="ml-2 text-[12px] text-muted-foreground">screen</a> : null}
                </td>
                {keys.map((k) => <td key={k} className="px-3 py-2 text-right font-mono whitespace-nowrap">{show(c.vars[k])}</td>)}
                <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{c.score === null ? <span className="text-muted-foreground">doesn't qualify</span> : show(c.score)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
