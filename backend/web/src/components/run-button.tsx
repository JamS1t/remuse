import { useState } from "react";
import { ChevronDown, LoaderCircle, Play, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/components/bits";
import { parseCsv } from "@/pages/spec";
import { api, type Task } from "@/lib/api";

/** "Run now": asks only for what this task needs (a list, or how many), then opens the live run. */
export function RunButton({ task, size = "default" }: { task: Task; size?: "default" | "sm" }) {
  const [ask, setAsk] = useState<null | "normal" | "unattended">(null);
  const [rows, setRows] = useState([task.columns.map((c) => c.name).join(","), task.columns.map((c) => c.demoValue).join(",")].join("\n"));
  const [count, setCount] = useState("");
  const { busy, run } = useAction();
  const item = task.itemName ?? "item";
  const needsInput = task.source === "rows" || task.source === "list";

  const start = (unattended: boolean) => run("run", async () => {
    const body = task.source === "rows" ? { rows: parseCsv(rows) } : task.source === "list" ? { limit: count ? Number(count) : undefined } : {};
    if (task.source === "rows" && !("rows" in body && body.rows?.length)) throw new Error(`Add at least one ${item} under the header line.`);
    const r = await api<{ id: string }>(`/specs/${task.specId}/runs`, "POST", { ...body, autoApprove: unattended });
    setAsk(null);
    location.hash = `#/run/${r.id}`;
  });
  const open = (mode: "normal" | "unattended") => (needsInput || mode === "unattended" ? setAsk(mode) : start(false));

  if (!task.built) return <Button size={size} variant="outline" className="rounded-full" onClick={() => { location.hash = `#/spec/${task.specId}`; }}>Finish setup</Button>;
  return (
    <>
      <div className="inline-flex">
        <Button size={size} className="rounded-l-full rounded-r-none pr-3" onClick={() => open("normal")} disabled={!!busy}>
          {busy ? <LoaderCircle className="animate-spin" /> : <Play className="fill-current" />}Run now
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size={size} className="rounded-l-none rounded-r-full border-l border-black/20 px-2" aria-label="More ways to run" disabled={!!busy}><ChevronDown /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem onSelect={() => open("normal")}>Run now<span className="ml-auto text-[12px] text-muted-foreground">asks before paying or sending</span></DropdownMenuItem>
            <DropdownMenuItem onSelect={() => open("unattended")}><ShieldAlert className="text-warn" />Run without asking me</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

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
            <Button onClick={() => start(ask === "unattended")} disabled={!!busy} className={ask === "unattended" ? "bg-warn text-black hover:bg-warn/90" : undefined}>
              {busy ? <LoaderCircle className="animate-spin" /> : <Play className="fill-current" />}{ask === "unattended" ? "Run without asking" : "Start"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
