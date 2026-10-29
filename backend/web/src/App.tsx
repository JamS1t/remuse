import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Shell } from "@/components/shell";
import { ActivityPage } from "@/pages/activity";
import { Remote } from "@/pages/remote";
import { RunPage } from "@/pages/run";
import { Session } from "@/pages/session";
import { SitesPage } from "@/pages/sites";
import { SpecPage } from "@/pages/spec";
import { TaskPage, TasksPage } from "@/pages/tasks";
import { useHash } from "@/lib/api";

export default function App() {
  const [view = "", id, tab] = useHash();
  const aurora = <div className="aurora" aria-hidden><i /><i /><i /></div>;
  // The Chrome sidebar gets its own compact remote, without the app frame.
  if (view === "remote") return <TooltipProvider>{aurora}<Remote /><Toaster position="bottom-center" /></TooltipProvider>;
  const page =
    view === "task" && id ? <TaskPage key={id} id={id} tab={tab} />
    : view === "run" && id ? <RunPage key={id} id={id} />
    : view === "spec" && id ? <SpecPage key={id} id={Number(id)} />
    : view === "session" && id ? <Session key={id} id={id} />
    : view === "activity" || view === "runs" ? <ActivityPage />
    : view === "sites" ? <SitesPage />
    : <TasksPage />;
  return (
    <TooltipProvider>
      {aurora}
      <Shell at={view}>{page}</Shell>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
