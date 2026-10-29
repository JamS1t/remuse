import { useState, type ReactNode } from "react";
import { LoaderCircle, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/components/bits";
import { parseCsv } from "@/pages/spec";
import { api, type Task } from "@/lib/api";

type Mode = "normal" | "unattended";

/** Starting a run: asks only for what the task needs (a list, or how many), then opens the live run.
 *  `open("unattended")` runs without stopping for approvals, after a confirmation. */
export function useRunTask(task: Task): { open: (mode: Mode) => void; busy: boolean; dialog: ReactNode } {
  const [ask, setAsk] = useState<Mode | null>(null);
  const [rows, setRows] = useState([task.columns.map((c) => c.name).join(","), task.columns.map((c) => c.demoValue).join(",")].join("\n"));
  const [count, setCount] = useState("");
  const { busy, run } = useAction();
  const item = task.itemName ?? "item";
  const needsInput = task.source === "rows" || task.source === "list";

  const start = (mode: Mode) => run("run", async () => {
    const body = task.source === "rows" ? { rows: parseCsv(rows) } : task.source === "list" ? { limit: count ? Number(count) : undefined } : {};
    if (task.source === "rows" && !("rows" in body && body.rows?.length)) throw new Error(`Add at least one ${item} under the header line.`);
    const r = await api<{ id: string }>(`/specs/${task.specId}/runs`, "POST", { ...body, autoApprove: mode === "unattended" });
    setAsk(null);
    location.hash = `#/run/${r.id}`;
  });
  const open = (mode: Mode) => (needsInput || mode === "unattended" ? setAsk(mode) : start(mode));

  const dialog = (
    <Dialog open={!!ask} onOpenChange={(o) => !o && setAsk(null)}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogTitle>{ask === "unattended" ? "Run without asking you?" : `Run ${task.title ?? "this task"}`}</DialogTitle>
        <DialogDescription>
          {ask === "unattended"
            ? "Remuse will pay, send or submit on its own when your rules say so. It still stops for anything outside your rules."
            : task.source === "rows" ? `One ${item} per line, under the header. Pasting from a spreadsheet works.` : `How many ${item}s from the list?`}
        </DialogDescription>
        {task.source === "rows" ? <Textarea value={rows} onChange={(e) => setRows(e.target.value)} rows={6} spellCheck={false} className="font-mono text-[12.5px]" /> : null}
        {task.source === "list" ? (
          <label className="flex items-center gap-2 text-muted-foreground">
            <Input type="number" min={1} value={count} onChange={(e) => setCount(e.target.value)} placeholder="All" className="w-24 font-mono" />{item}s
          </label>
        ) : null}
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setAsk(null)}>Cancel</Button>
          <Button onClick={() => start(ask ?? "normal")} disabled={!!busy} className={ask === "unattended" ? "bg-warn text-black hover:bg-warn/90" : undefined}>
            {busy ? <LoaderCircle className="animate-spin" /> : <Play className="fill-current" />}{ask === "unattended" ? "Run without asking" : "Start"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
  return { open, busy: !!busy, dialog };
}

/** "Run now": one button. Other ways to run live in the task's menu. */
export function RunButton({ task, size = "default" }: { task: Task; size?: "default" | "sm" }) {
  const { open, busy, dialog } = useRunTask(task);
  if (!task.built) return <Button size={size} variant="outline" className="rounded-full" onClick={() => { location.hash = `#/spec/${task.specId}`; }}>Finish setup</Button>;
  return (
    <>
      <Button size={size} className="rounded-full px-4" onClick={() => open("normal")} disabled={busy}>
        {busy ? <LoaderCircle className="animate-spin" /> : <Play className="fill-current" />}Run now
      </Button>
      {dialog}
    </>
  );
}
