import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, ChevronLeft, CircleAlert, CircleDashed, Hand, ListChecks, KeyRound, LoaderCircle, MessageCircleQuestion, Minus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api, useApi, type ItemStatus, type PracticeState } from "@/lib/api";
import { cn } from "@/lib/utils";
import lockupSvg from "@/assets/lockup.svg?raw";
import markSvg from "@/assets/mark.svg?raw";

/** Run an async action with a busy flag; errors become a toast. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try { return await fn(); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(null); }
  };
  return { busy, run };
}

/** Opens the Remuse browser (its own Chrome profile) so the person can sign in to sites once. */
export function SignIn() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("https://");
  const { busy, run } = useAction();
  const go = () => run("open", async () => {
    await api(`/browser/open?url=${encodeURIComponent(url)}`, "POST");
    toast.success("The Remuse browser is open. Sign in there, then close it.");
    setOpen(false);
  });
  return (
    <>
      <Button variant="ghost" size="sm" className="w-full justify-start gap-2.5 px-3 text-muted-foreground" onClick={() => setOpen(true)}>
        <KeyRound />Sign in to sites
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogTitle>Sign in to a site</DialogTitle>
          <p className="text-muted-foreground">Remuse uses its own Chrome window. Sign in there once, and every run after stays signed in. Your passwords never reach Remuse.</p>
          <form className="mt-1 flex gap-2" onSubmit={(e) => { e.preventDefault(); go(); }}>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.lazada.com.ph" className="font-mono" aria-label="Site address" />
            <Button type="submit" disabled={!!busy}>{busy ? <LoaderCircle className="animate-spin" /> : null}Open</Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Demo controls for the mock apps, shown only while they run (for the demo video). */
export function DemoMenu() {
  const { busy, run } = useAction();
  const { data: mock } = useApi<{ up: boolean }>("/mock/status");
  const demo = (label: string, path: string) => run(path, async () => { await api(path, "POST"); toast.success(label); });
  if (!mock?.up) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="w-full justify-start gap-2.5 px-3 text-muted-foreground" disabled={!!busy}>
          {busy ? <LoaderCircle className="animate-spin" /> : <ChevronDown />}Demo apps
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">Mock inbox, store and courier</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => demo("Demo data reset", "/mock/reset")}>Reset demo data</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => demo("Store uses the original layout", "/mock/layout?v=v1")}>Store layout: original</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => demo("Store uses the redesigned layout", "/mock/layout?v=v2")}>Store layout: redesigned</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type OrbState = "idle" | "watching" | "thinking" | "working" | "waiting" | "done";

/** Remuse's presence: a glass orb whose light shows what it's doing. */
export function Orb({ state = "idle", size = 18, className }: { state?: OrbState; size?: number; className?: string }) {
  return (
    <span className={cn("orb inline-block", className)} data-state={state} style={{ ["--s" as string]: `${size}px` }} aria-hidden>
      <span className="core"><span className="swirl" /><span className="swirl b" /></span>
      <span className="gloss" />
    </span>
  );
}

/** The Remuse logo (C Inner mark + soft geometric wordmark), drawn in the current text colour. */
export function Lockup({ className }: { className?: string }) {
  return <span role="img" aria-label="Remuse" className={cn("inline-flex [&>svg]:h-full [&>svg]:w-auto", className)} dangerouslySetInnerHTML={{ __html: lockupSvg }} />;
}
export function Mark({ className }: { className?: string }) {
  return <span role="img" aria-label="Remuse" className={cn("inline-flex [&>svg]:h-full [&>svg]:w-auto", className)} dangerouslySetInnerHTML={{ __html: markSvg }} />;
}

export function Page({ children }: { children: ReactNode }) {
  return <main className="mx-auto max-w-[1240px] px-5 pt-6 pb-20">{children}</main>;
}

export function Crumb({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} className="inline-flex items-center gap-1 text-[13px] text-muted-foreground no-underline hover:text-foreground"><ChevronLeft className="size-3.5" />{children}</a>;
}

export function Section({ title, aside, children, className }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("mt-10", className)}>
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {aside ? <div className="text-[13px] text-muted-foreground">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children ? <div className="mx-auto mt-1 max-w-[52ch] text-muted-foreground">{children}</div> : null}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive">{children}</p>;
}

const STATUS: Record<ItemStatus | "starting" | "stopped", { icon: typeof Check; word: string; cls: string }> = {
  waiting: { icon: CircleDashed, word: "Waiting", cls: "text-muted-foreground" },
  starting: { icon: LoaderCircle, word: "Starting", cls: "text-tally" },
  running: { icon: LoaderCircle, word: "Running", cls: "text-tally" },
  approval: { icon: Hand, word: "Needs your OK", cls: "text-foreground" },
  asking: { icon: MessageCircleQuestion, word: "Has a question", cls: "text-foreground" },
  planned: { icon: ListChecks, word: "Planned", cls: "text-foreground" },
  ready: { icon: Hand, word: "Ready for your OK", cls: "text-foreground" },
  done: { icon: Check, word: "Done", cls: "text-ok" },
  skipped: { icon: Minus, word: "Skipped", cls: "text-muted-foreground" },
  failed: { icon: X, word: "Failed", cls: "text-destructive" },
  stopped: { icon: Minus, word: "Stopped", cls: "text-muted-foreground" },
};

/** Status as glyph + word, never colour alone. */
export function Status({ s, word = true, className }: { s: keyof typeof STATUS; word?: boolean; className?: string }) {
  const { icon: Icon, word: w, cls } = STATUS[s] ?? STATUS.waiting;
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", cls, className)} title={w}>
      <Icon className={cn("size-3.5 shrink-0", (s === "running" || s === "starting") && "animate-spin [animation-duration:1.6s]")} strokeWidth={2.25} />
      {word ? <span className="text-[13px] font-medium">{w}</span> : <span className="sr-only">{w}</span>}
    </span>
  );
}

const REV = ["White", "Blue", "Pink", "Yellow", "Green", "Goldenrod"];
export const revColor = (v: number) => `var(--rev-${((v - 1) % 6) + 1})`;
export const revName = (v: number) => REV[(v - 1) % 6];

/** A spec version as its script revision: colour chip + "v3 Pink". */
export function Revision({ v, href, active }: { v: number; href?: string; active?: boolean }) {
  const body = (
    <>
      <span className="size-3 rounded-[3px] border border-black/15" style={{ background: revColor(v) }} />
      <span className="font-mono text-[12px]">v{v}</span>
      <span className="text-[12px] text-muted-foreground">{revName(v)}</span>
    </>
  );
  const cls = cn("inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 no-underline text-foreground", active && "bg-muted", href && "hover:bg-muted");
  return href ? <a href={href} className={cls} aria-current={active ? "page" : undefined}>{body}</a> : <span className={cls}>{body}</span>;
}

/** Screenshot that opens full size. */
export function Shot({ src, alt, className, caption }: { src: string; alt: string; className?: string; caption?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn("group block w-full cursor-zoom-in overflow-hidden rounded-md border bg-muted text-left", className)}>
        <img src={src} alt={alt} loading="lazy" className="block w-full transition-opacity group-hover:opacity-90" />
        {caption ? <span className="block border-t bg-card px-2 py-1 text-[12px] text-muted-foreground">{caption}</span> : null}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-auto max-w-[94vw] sm:max-w-[94vw] p-2">
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          <img src={src} alt={alt} className="max-h-[86vh] max-w-[90vw] rounded-sm" />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Mock item labels: drop emoji, keep a trailing date on one line in mono. */
export function ItemLabel({ text }: { text: string }) {
  const clean = text.replace(/\p{Extended_Pictographic}\uFE0F?\s*/gu, "").trim();
  const m = clean.match(/^(.*?)\s*(\d{4}-\d{2}-\d{2})$/);
  return m ? <>{m[1]} <span className="whitespace-nowrap font-mono text-[0.92em] font-normal text-muted-foreground">{m[2]}</span></> : <>{clean}</>;
}

/** The user's own words, set like script dialogue. */
export function Said({ children }: { children: ReactNode }) {
  return <q className="font-script text-[13.5px] leading-snug text-foreground/85 [quotes:'“''”']">{children}</q>;
}

const asText = (v: unknown) => (v === null || v === undefined || v === "" ? "nothing" : typeof v === "string" ? v : JSON.stringify(v));
const plain = (s?: string) => s?.replaceAll("_", " ") ?? "";

/** How the practice on your example went, in plain lines: what it read, what it chose, where it stopped. */
export function PracticeLines({ p, className }: { p: PracticeState | null | undefined; className?: string }) {
  if (!p) return null;
  const going = p.status === "starting" || p.status === "running";
  if (going) return <ul className={className}><li className="shimmer">Practicing once on your example…</li></ul>;
  const r = p.result;
  if (!r || p.status === "stopped") return <ul className={className}><li className="flex items-center gap-1.5 text-muted-foreground"><Minus className="size-3.5" />Practice stopped before it finished</li></ul>;
  const ok = (good: boolean, text: ReactNode, key: string) => (
    <li key={key} className={cn("flex gap-1.5", good ? "text-ok" : "text-warn")}>
      {good ? <Check className="mt-0.5 size-3.5 shrink-0" /> : <CircleAlert className="mt-0.5 size-3.5 shrink-0" />}<span>{text}</span>
    </li>
  );
  const lines: ReactNode[] = [];
  if (r.problem) lines.push(ok(false, <>Practice got stuck: {r.problem}</>, "problem"));
  else {
    if (!r.sameItem && p.label) lines.push(<li key="other" className="text-muted-foreground">Your example wasn't in the list any more, so I practiced on “{p.label}”.</li>);
    const bad = r.values.filter((v) => !v.ok);
    if (r.values.length && !bad.length) lines.push(ok(true, r.sameItem ? `Read the same ${r.values.length === 1 ? "value" : `${r.values.length} values`} you saw` : `Found all ${r.values.length} values`, "values"));
    for (const v of bad.slice(0, 3)) lines.push(ok(false, v.got === null ? <>Couldn't read {plain(v.name)}</> : <>Read {plain(v.name)} as <span className="font-mono">{asText(v.got)}</span>; you saw <span className="font-mono">{asText(v.want)}</span></>, `v-${v.name}`));
    if (r.asked) lines.push(ok(false, <>Would ask you about your own example: {r.asked}</>, "asked"));
    else if (r.outcome && r.expected && r.sameItem) lines.push(ok(r.outcome === r.expected, r.outcome === r.expected ? <>Chose to {plain(r.outcome)}, like you did</> : <>Chose to {plain(r.outcome)}; you did {plain(r.expected)}</>, "outcome"));
    if (r.stoppedBefore) lines.push(<li key="stop" className="flex gap-1.5 text-muted-foreground"><Hand className="mt-0.5 size-3.5 shrink-0" /><span>Stopped before “{r.stoppedBefore.replace(/^./, (c) => c.toLowerCase())}”. {r.stoppedForOk === false ? "It changes something on the site, so a practice doesn't do it." : "Real runs wait for your OK there."}</span></li>);
  }
  return <ul className={cn("space-y-1", className)}>{lines}</ul>;
}
