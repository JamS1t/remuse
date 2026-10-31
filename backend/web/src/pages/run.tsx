import { useEffect, useState } from "react";
import { Check, CircleAlert, LoaderCircle, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { ErrorNote, ItemLabel, Orb, PracticeLines, Shot, Status, useAction } from "@/components/bits";
import { Content, PageHead } from "@/components/shell";
import { Loading } from "@/pages/lists";
import { ago, api, fmtSecs, isLive, timecode, useApi, type Candidate, type Item, type Pending, type Run, type SpecRow } from "@/lib/api";
import { cn } from "@/lib/utils";

const settled = (i: Item) => ["done", "skipped", "failed"].includes(i.status);
// A planned item's clock stops while it waits for Go.
const dur = (i: Item, now: number) => {
  if (!i.log.length) return 0;
  const end = settled(i) || i.status === "planned" ? i.log[i.log.length - 1].at : now;
  // Acted after a plan: looking time plus doing time, not the wait for Go in between.
  const k = i.log.findIndex((l) => l.msg.startsWith("Doing it now"));
  return k > 0 ? i.log[k - 1].at - i.log[0].at + (end - i.log[k].at) : end - i.log[0].at;
};
// Test sites only: an outcome by what it means, whatever the model named it (same as meaning() in runner.ts).
const meaning = (o?: string) => (!o ? o : /lost/i.test(o) ? "lost_refund" : /declin/i.test(o) ? "decline" : /replac/i.test(o) ? "replace" : /refund/i.test(o) ? "refund" : o);
const matches = (i: Item) => (i.expected === "ask" ? i.decidedBy !== "rules" : meaning(i.outcome) === i.expected);
const words = (s?: string) => s?.replaceAll("_", " ");
// "avg_view_duration" -> "Avg view duration", with short forms in capitals ("ctr" -> "CTR").
const nice = (name: string) => name.split("_").map((w, i) => (/^(ctr|avd|url|id|sku|rpm|cpm)$/i.test(w) ? w.toUpperCase() : i ? w : w[0].toUpperCase() + w.slice(1))).join(" ");
const clean = (s: string) => s.replace(/^[\u2713\u2714]\s*/, "");

export function RunPage({ id }: { id: string }) {
  const { data: r, error, reload } = useApi<Run>(`/runs/${id}`, 1000, (d) => isLive(d.status));
  const [sel, setSel] = useState<number | null>(null);
  const [sure, setSure] = useState(false); // "Do them again" asks once before redoing the whole list
  const { busy, run } = useAction();
  const { data: spec } = useApi<SpecRow>(r ? `/specs/${r.specId}` : null);
  if (error) return <Content><ErrorNote>{error}</ErrorNote></Content>;
  if (!r) return <Content><Loading /></Content>;

  const live = isLive(r.status);
  const now = live ? Date.now() : r.endedAt ?? Date.now();
  const done = r.items.filter(settled).length;
  const single = r.items.length <= 1;
  const shown = sel ?? Math.min(r.current, Math.max(0, r.items.length - 1));
  const it = r.items[shown];
  const file = (f: string) => `/api/runs/${id}/files/${f}`;
  const scale = Math.max(1, ...r.items.map((i) => dur(i, now)));
  const stop = () => run("stop", async () => { await api(`/runs/${id}/stop`, "POST"); reload(); });
  const answer = (body: object) => run("answer", async () => { await api(`/runs/${id}/answer`, "POST", body); reload(); });
  // A decision is worth showing only when there was a real choice (several outcomes) or you made it.
  const choices = spec ? Object.keys(spec.spec.outcomes).length : 2;
  const title = spec?.spec.title ?? spec?.spec.goal ?? "Run";
  const took = (r.endedAt ?? now) - r.startedAt;

  return (
    <Content wide={!single}>
      <PageHead
        back={spec ? { href: `#/task/${spec.sessionId}/activity`, label: "Back to the task" } : { href: "#/activity", label: "Activity" }}
        title={title}
        sub={
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <Status s={r.pending ? "approval" : r.status} />
            <span>·</span><span>{r.mode === "practice" ? "Practice on your example, stopping before anything irreversible," : r.trigger === "schedule" ? "Started by its schedule" : "Started by you"} {ago(r.startedAt)}</span>
            <span>·</span><span className="font-mono text-[13px]">{fmtSecs(took)}</span>
            {!single ? <><span>·</span><span>{done} of {r.items.length} done</span></> : null}
            {r.browser ? <><span>·</span><span>{r.browser === "chrome" ? "In your Chrome" : "In Remuse's browser"}</span></> : null}
            {r.autoApprove ? <><span>·</span><span className="text-warn">without asking you</span></> : null}
            {r.alreadyDone ? <><span>·</span><span>{r.alreadyDone} done before, left alone</span></> : null}
            {r.checker ? <><span>·</span><span>checked by {r.checker}</span></> : null}
            {live && r.phase === "plan" && !r.pending ? <><span>·</span><span className="shimmer">Looking at every item first</span></> : null}
          </span>
        }
        actions={
          <>
            {r.score ? <span className="mr-2 font-mono text-[15px]">{r.score.matched}<span className="text-muted-foreground"> / {r.score.total} right</span></span> : null}
            {live ? <Button variant="outline" className="rounded-full" onClick={stop} disabled={!!busy}><Square className="fill-current" />Stop</Button> : null}
            {!live && !r.items.length && r.alreadyDone ? <Button variant="outline" className="rounded-full" disabled={!!busy}
              onClick={() => (sure ? run("redo", async () => { const n = await api<{ id: string }>(`/specs/${r.specId}/runs`, "POST", { redo: true, plan: true }); location.hash = `#/run/${n.id}`; }) : setSure(true))}>
              {sure ? `Yes, all ${r.alreadyDone} again (I'll show the plan first)` : "Do them again"}</Button> : null}
          </>
        }
      />
      {r.error ? <div className="mb-6"><ErrorNote>{r.error}</ErrorNote></div> : null}
      {r.mode === "practice" && !live ? (
        <section className="glass mb-6 rounded-2xl px-5 py-4">
          <h2 className="text-[13px] font-medium">How the practice went</h2>
          <PracticeLines className="mt-2 text-[13.5px]" p={{ runId: r.id, status: r.status, label: r.items[0]?.label ?? null, result: r.practice ?? null }} />
        </section>
      ) : null}
      {r.pending ? <div className="mb-6"><PendingCard key={`${r.pending.kind}-${r.pending.item}-${r.pending.shot}`} p={r.pending} r={r} file={file} busy={!!busy} answer={answer} /></div> : null}
      {r.heals.length || r.learned.length ? (
        <section className="glass mb-6 rounded-2xl px-5 py-4">
          <h2 className="text-[13px] font-medium">Learned during this run</h2>
          <ul className="mt-1.5 space-y-1 text-[13.5px] text-muted-foreground">
            {[...new Set(r.heals.map((h) => `“${h.from}” is now “${h.to}”`)), ...r.learned.map((l) => `${words(l.requestType)} → ${words(l.outcome)}${l.note ? `. ${l.note}` : ""}`)].map((t) => <li key={t}>{t}</li>)}
          </ul>
          {r.newSpecId ? <p className="mt-2 text-[13px]"><a href={`#/spec/${r.newSpecId}`}>Saved as a new version</a></p> : null}
        </section>
      ) : null}

      {!r.items.length && r.alreadyDone && !live ? <p className="glass rounded-2xl px-5 py-4 text-muted-foreground">Nothing new since last time. The {r.alreadyDone} already there were done before, so I left them alone.</p> : null}
      {single ? (
        it ? <ItemDetail it={it} file={file} choices={choices} live={live && !settled(it)} latest={r.shot} /> : live ? <p className="text-muted-foreground">Starting…</p> : null
      ) : (
        <div className="grid items-start gap-6 min-[900px]:grid-cols-[minmax(320px,400px)_minmax(0,1fr)]">
          {/* Every item in order, each with its time drawn to one shared scale. */}
          <div className="glass overflow-hidden rounded-2xl max-[899px]:order-2">
            <div className="grid grid-cols-[28px_1fr_96px] gap-2 border-b border-rule px-4 py-2.5 text-[12px] text-muted-foreground">
              <span className="text-right">#</span><span>Item</span><span className="text-right">Time</span>
            </div>
            <ol>
              {r.items.map((i, n) => {
                const d = dur(i, now);
                const isLiveRow = live && n === r.current && !settled(i);
                return (
                  <li key={i.url || n}>
                    <button type="button" onClick={() => setSel(n)} aria-current={n === shown}
                      className={cn("grid w-full grid-cols-[28px_1fr_96px] items-start gap-2 border-b border-rule px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-white/[0.04]", n === shown && "bg-white/[0.06]")}>
                      <span className="pt-px text-right font-mono text-[12px] text-muted-foreground">{n + 1}</span>
                      <span className="min-w-0">
                        <span className="line-clamp-2 leading-snug" title={i.label}><ItemLabel text={i.label} /></span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-muted-foreground">
                          <Status s={i.status} word={i.status !== "done" || !i.outcome} />
                          {i.outcome ? <span className="text-foreground capitalize">{words(i.outcome)}</span> : null}
                          {i.expected && i.outcome && !matches(i) ? <span className="text-destructive">· expected {words(i.expected)}</span> : null}
                        </span>
                      </span>
                      <span className="pt-1">
                        <span className="block h-1 w-full rounded-full bg-white/[0.06]">
                          <span className={cn("block h-full rounded-full", isLiveRow ? "live-bar bg-live" : i.status === "failed" ? "bg-destructive/60" : "bg-foreground/60")}
                            style={{ width: `${d ? Math.max(4, (d / scale) * 100) : 0}%` }} />
                        </span>
                        <span className="mt-1 block text-right font-mono text-[11.5px] text-muted-foreground">{d ? fmtSecs(d) : "–"}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
          <div className="min-w-0 max-[899px]:order-1">
            {it ? (
              <>
                <div className="mb-4 flex items-baseline justify-between gap-3">
                  <h2 className="truncate text-[16px] font-medium"><ItemLabel text={it.label} /></h2>
                  <Status s={it.status} />
                </div>
                <ItemDetail it={it} file={file} choices={choices} live={live && shown === r.current && !settled(it)} latest={r.shot} />
              </>
            ) : null}
          </div>
        </div>
      )}
    </Content>
  );
}

/** One item: its update, its decision (when there was one), what it compared, its steps and screens. */
function ItemDetail({ it, file, choices, live, latest }: { it: Item; file: (f: string) => string; choices: number; live: boolean; latest?: string }) {
  const showDecision = !!it.because && (choices > 1 || it.decidedBy !== "rules");
  return (
    <div className="space-y-6">
      {it.report ? (
        <section className="glass rounded-2xl px-6 py-5">
          <p className="text-[12.5px] text-muted-foreground">Update</p>
          <p className="mt-1.5 text-[20px] leading-snug font-medium tracking-[-0.01em] whitespace-pre-wrap">{it.report}</p>
        </section>
      ) : null}
      {showDecision ? (
        <p className="text-[15px]">Decided to <span className="font-medium">{words(it.outcome)}</span>{it.decidedBy === "you" ? ", as you said" : it.decidedBy === "learned" ? ", as you showed earlier" : ""}. <span className="text-muted-foreground">{words(it.because)}</span></p>
      ) : null}
      {it.candidates?.length ? <Compared list={it.candidates} file={file} /> : null}
      {live && latest ? <Shot src={file(latest)} alt="What Remuse sees now" caption="What Remuse sees now" /> : null}

      <section>
        <h3 className="mb-2 text-[13px] font-medium text-muted-foreground">Steps</h3>
        <ol className="glass divide-y divide-rule overflow-hidden rounded-2xl">
          {it.log.length ? it.log.map((l, k) => {
            const msg = clean(l.msg);
            if (msg.startsWith("Update: ") || (!showDecision && msg.startsWith("Decision: "))) return null;
            const read = /^(\w+) = (.+?)( \(computed\))?(: .*)?$/.exec(msg);
            const label = msg.replace(/ \(checked on screen: .*\)$/, "");
            return (
              <li key={k} className="grid grid-cols-[20px_minmax(0,1fr)_auto_48px] items-start gap-3 px-5 py-2.5 text-[13.5px]">
                <span className="pt-0.5">
                  {l.level === "warn" || l.level === "error" ? <CircleAlert className={cn("size-3.5", l.level === "error" ? "text-destructive" : "text-warn")} />
                    : l.level === "ok" ? <Check className="size-3.5 text-ok" /> : <span className="mt-1.5 ml-1 block size-1 rounded-full bg-muted-foreground/60" />}
                </span>
                {read ? (
                  <span className="min-w-0"><span className="text-muted-foreground">{nice(read[1])}</span> {read[2] === "null" ? <span className="ml-1 text-muted-foreground">{read[4] ? read[4].slice(2) : "none"}</span> : <span className="ml-1 font-mono text-[13px]">{JSON.parse(JSON.stringify(read[2])).replace(/^"|"$/g, "")}</span>}</span>
                ) : (
                  <span className="min-w-0">
                    <span className={cn(l.level === "error" && "text-destructive", l.level === "warn" && "text-warn")}>{label}</span>
                    {l.why ? <span className="mt-0.5 block text-[12.5px] leading-snug text-muted-foreground">{l.how === "screen" ? `Looked at the screen${l.by ? ` (${l.by})` : ""}: ` : l.how === "page" ? "Checked on the page: " : ""}{l.why}</span> : null}
                  </span>
                )}
                {l.shot ? <Shot src={file(l.shot)} alt={label} className="w-20 sm:w-24" /> : <span />}
                <span className="pt-0.5 text-right font-mono text-[11.5px] text-muted-foreground">{timecode(l.at - it.log[0].at)}</span>
              </li>
            );
          }) : <li className="px-5 py-4 text-muted-foreground">Not started yet.</li>}
        </ol>
      </section>

    </div>
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

  // Every item read and decided, nothing done yet: the plan, and your Go.
  if (p.kind === "plan") {
    const planned = r.items.map((it, n) => ({ it, n })).filter(({ it }) => it.status === "planned");
    return (
      <section className="animate-in fade-in slide-in-from-top-2 glass overflow-hidden rounded-2xl duration-300 ease-out" aria-live="assertive">
        <div className="flex items-center gap-2.5 border-b border-rule px-4 py-3">
          <Orb state="waiting" size={20} /><h2 className="text-[14px] font-semibold">My plan for {planned.length} {planned.length === 1 ? "item" : "items"}</h2>
        </div>
        <div className="grid gap-4 p-4">
          <div>
            <p className="text-[16px] leading-snug">{Object.entries(p.counts).sort((a, b) => b[1] - a[1]).map(([o, n]) => `${n} ${words(o)}`).join(" · ")}</p>
            {p.skipped || p.failed ? <p className="mt-1 text-[13px] text-muted-foreground">{[p.skipped && `${p.skipped} skipped`, p.failed && `${p.failed} I couldn't read`].filter(Boolean).join(", ")}; I'll leave those.</p> : null}
          </div>
          <ol className="max-h-72 divide-y divide-rule overflow-y-auto rounded-xl bg-white/[0.03]">
            {planned.map(({ it, n }) => (
              <li key={n} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-3 py-2 text-[13px]">
                <span className="truncate"><ItemLabel text={it.label} /></span>
                <span className="font-medium capitalize">{words(it.outcome)}</span>
                {it.because ? <span className="col-span-2 line-clamp-1 text-[12px] text-muted-foreground">{it.decidedBy === "you" ? "You said so" : it.because === "otherwise" ? "None of your other rules fit" : words(it.because)}</span> : null}
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="lg" onClick={() => answer({ decision: "approve" })} disabled={busy}>Go</Button>
            {p.needsOk ? <Button size="lg" variant="outline" onClick={() => answer({ decision: "approve_all" })} disabled={busy}>Approve all {p.needsOk} and go</Button> : null}
            <Button size="lg" variant="ghost" className="ml-auto" onClick={() => answer({ decision: "reject" })} disabled={busy}>Cancel</Button>
          </div>
          <p className="text-[12.5px] text-muted-foreground">
            {p.needsOk ? `With Go I still ask before each of the ${p.needsOk} that send, pay or submit. Nothing has been done yet.` : "None of these send, pay or submit. Nothing has been done yet."}
          </p>
        </div>
      </section>
    );
  }

  // A batch: each item prepared and checked up to the step Remuse never does alone. One OK finishes them.
  if (p.kind === "ready") {
    const ready = p.items.map((n) => ({ n, it: r.items[n] })).filter(({ it }) => it);
    return (
      <section className="animate-in fade-in slide-in-from-top-2 glass overflow-hidden rounded-2xl duration-300 ease-out" aria-live="assertive">
        <div className="flex items-center gap-2.5 border-b border-rule px-4 py-3">
          <Orb state="waiting" size={20} /><h2 className="text-[14px] font-semibold">{ready.length} ready for your OK</h2>
        </div>
        <div className="grid gap-4 p-4">
          <ol className="max-h-80 divide-y divide-rule overflow-y-auto rounded-xl bg-white/[0.03]">
            {ready.map(({ n, it }) => {
              const proof = [...it.log].reverse().find((l) => l.how === "page" && l.level === "ok");
              return (
                <li key={n} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2.5 text-[13px]">
                  <span className="truncate font-medium"><ItemLabel text={it.label} /></span>
                  <Button size="sm" variant="outline" onClick={() => answer({ decision: "approve", items: [n] })} disabled={busy}>{it.ready?.step ?? "Approve"}</Button>
                  {proof?.why ? <span className="col-span-2 line-clamp-1 text-[12px] text-muted-foreground">Checked: {proof.why}</span> : null}
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="lg" onClick={() => answer({ decision: "approve_all" })} disabled={busy}>Approve all {ready.length}</Button>
            <Button size="lg" variant="ghost" className="ml-auto" onClick={() => answer({ decision: "reject" })} disabled={busy}>Leave them prepared</Button>
          </div>
          <p className="text-[12.5px] text-muted-foreground">Each one is prepared and checked. Nothing that sends, submits or turns in has been done yet.</p>
        </div>
      </section>
    );
  }

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
