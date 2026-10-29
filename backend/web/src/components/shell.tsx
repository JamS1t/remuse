import type { ReactNode } from "react";
import { Activity, ChevronLeft, Globe, ListChecks } from "lucide-react";
import { DemoMenu, Lockup, Orb, SignIn } from "@/components/bits";
import { useApi } from "@/lib/api";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "#/", label: "Tasks", icon: ListChecks, match: ["", "tasks", "task", "spec", "session"] },
  { href: "#/activity", label: "Activity", icon: Activity, match: ["activity", "runs", "run"] },
  { href: "#/sites", label: "Connected sites", icon: Globe, match: ["sites"] },
];

/** The app frame: one sidebar for where you are, the page beside it. */
export function Shell({ at, children }: { at: string; children: ReactNode }) {
  const { data: up } = useApi<unknown[]>("/sessions", 15000, () => true);
  return (
    <div className="min-h-screen md:grid md:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="sticky top-0 z-20 flex flex-col border-b bg-background/40 backdrop-blur-xl md:h-screen md:border-r md:border-b-0">
        <div className="flex h-14 items-center px-5">
          <a href="#/" className="text-foreground no-underline"><Lockup className="h-6" /></a>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2 md:flex-col md:pb-0" aria-label="Main">
          {NAV.map(({ href, label, icon: Icon, match }) => {
            const on = match.includes(at);
            return (
              <a key={href} href={href} aria-current={on ? "page" : undefined}
                className={cn("flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] font-medium no-underline transition-colors",
                  on ? "bg-white/[0.07] text-foreground" : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground")}>
                <Icon className="size-4" />{label}
              </a>
            );
          })}
        </nav>
        <div className="mt-auto hidden space-y-1 px-3 pb-4 md:block">
          <DemoMenu />
          <SignIn />
          <p className="flex items-center gap-2.5 px-3 py-2 text-[12.5px] text-muted-foreground">
            <Orb size={14} state={up ? "idle" : "waiting"} />{up ? "Agent running" : "Agent not answering"}
          </p>
        </div>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Page header: title, one line of context, actions on the right. */
export function PageHead({ title, sub, actions, back }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <header className="mb-8">
      {back ? <a href={back.href} className="inline-flex items-center gap-1 text-[13px] text-muted-foreground no-underline hover:text-foreground"><ChevronLeft className="size-3.5" />{back.label}</a> : null}
      <div className={cn("flex flex-wrap items-start justify-between gap-x-6 gap-y-3", back && "mt-3")}>
        <div className="min-w-0 max-w-[70ch]">
          <h1 className="text-[24px] leading-tight font-medium tracking-[-0.02em]">{title}</h1>
          {sub ? <div className="mt-1.5 text-muted-foreground">{sub}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function Content({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <main className={cn("mx-auto px-5 pt-8 pb-20 md:px-10", wide ? "max-w-[1240px]" : "max-w-[1040px]")}>{children}</main>;
}
