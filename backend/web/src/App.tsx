import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TopBar } from "@/components/bits";
import { Home, Runs } from "@/pages/lists";
import { Session } from "@/pages/session";
import { SpecPage } from "@/pages/spec";
import { RunPage } from "@/pages/run";
import { Remote } from "@/pages/remote";
import { useHash } from "@/lib/api";

export default function App() {
  const [view = "", id] = useHash();
  // The Chrome sidebar gets its own compact remote, without the full app's top bar.
  if (view === "remote") return <TooltipProvider><Remote /><Toaster position="bottom-center" /></TooltipProvider>;
  return (
    <TooltipProvider>
      <TopBar at={view} />
      {view === "session" && id ? <Session key={id} id={id} />
        : view === "spec" && id ? <SpecPage key={id} id={Number(id)} />
        : view === "run" && id ? <RunPage key={id} id={id} />
        : view === "runs" ? <Runs />
        : <Home />}
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
