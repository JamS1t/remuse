import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, CircleDashed, Hand, KeyRound, LoaderCircle, MessageCircleQuestion, Minus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api, useApi, type ItemStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

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
function SignIn() {
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
      <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setOpen(true)}>
        <KeyRound /><span className="max-sm:hidden">Sign in to sites</span>
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

export function TopBar({ at }: { at: string }) {
  const { busy, run } = useAction();
  const { data: mock } = useApi<{ up: boolean }>("/mock/status");
  const demo = (label: string, path: string) => run(path, async () => { await api(path, "POST"); toast.success(label); });
  const link = (href: string, label: string, on: boolean) => (
    <a href={href} aria-current={on ? "page" : undefined}
      className={cn("rounded-md px-2.5 py-1.5 text-[13px] font-medium no-underline transition-colors", on ? "text-foreground bg-muted" : "text-muted-foreground hover:text-foreground")}>{label}</a>
  );
  return (
    <header className="sticky top-0 z-20 border-b bg-background/40 backdrop-blur-xl">
      <div className="mx-auto flex h-12 max-w-[1240px] items-center gap-3 px-4 sm:gap-5 sm:px-5">
        <a href="#/" className="flex items-center gap-2 text-foreground no-underline">
          <Mark />
          <span className="text-[15px] font-semibold tracking-[-0.02em]">Remuse</span>
        </a>
        <nav className="flex items-center gap-1">
          {link("#/", "Recordings", at === "" || at === "session" || at === "spec")}
          {link("#/runs", "Runs", at === "runs" || at === "run")}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <SignIn />
          {mock?.up ? <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={!!busy}>
                {busy ? <LoaderCircle className="animate-spin" /> : null}<span className="max-sm:hidden">Demo apps</span><span className="sm:hidden">Demo</span> <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">Mock inbox, store and courier</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => demo("Demo data reset", "/mock/reset")}>Reset demo data</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => demo("Store uses the original layout", "/mock/layout?v=v1")}>Store layout: original</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => demo("Store uses the redesigned layout", "/mock/layout?v=v2")}>Store layout: redesigned</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu> : null}
        </div>
      </div>
    </header>
  );
}

/** Remuse mark: a play cue inside a frame. */
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

/** Wordmark spot until the logo lands: the idle orb. */
export function Mark() {
  return <Orb size={18} />;
}

export function Page({ children }: { children: ReactNode }) {
  return <main className="mx-auto max-w-[1240px] px-5 pt-6 pb-20">{children}</main>;
}

export function Crumb({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} className="text-[13px] text-muted-foreground no-underline hover:text-foreground">← {children}</a>;
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
