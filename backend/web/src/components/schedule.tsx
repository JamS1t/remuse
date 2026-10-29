import { useState } from "react";
import { toast } from "sonner";
import { CalendarClock, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAction } from "@/components/bits";
import { api, type ScheduleRow, type Task } from "@/lib/api";
import { cn } from "@/lib/utils";

const DAYS = ["M", "T", "W", "T", "F", "S", "S"];
const NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const every = (m: number) => (m % 60 === 0 ? (m === 60 ? "every hour" : `every ${m / 60} hours`) : `every ${m} minutes`);
export function onDays(days: string, time: string) {
  const at = new Date(`2000-01-01T${time}`).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const d = days === "1234567" ? "every day" : days === "12345" ? "every weekday" : days === "67" ? "every weekend" : `every ${[...days].map((x) => NAMES[Number(x) - 1]).join(", ")}`;
  return `${d} at ${at}`;
}
export const describeSchedule = (s: { everyMinutes?: number | null; days?: string; time?: string }) =>
  s.everyMinutes ? every(s.everyMinutes) : onDays(s.days ?? "1234567", s.time ?? "09:00");

/** Choose how often a task repeats by itself: every few hours, or on days at a time. */
export function ScheduleEditor({ task, schedule, onSaved }: { task: Task; schedule: ScheduleRow | null; onSaved: () => void }) {
  const [hourly, setHourly] = useState<number | null>(schedule ? schedule.everyMinutes : task.askedSchedule?.everyMinutes ?? 60);
  const [time, setTime] = useState(schedule?.time && schedule.time !== "00:00" ? schedule.time : task.askedSchedule?.time ?? "09:00");
  const [days, setDays] = useState(schedule?.days ?? task.askedSchedule?.days ?? "12345");
  const { busy, run } = useAction();
  const save = () => run("save", async () => {
    await api("/schedules", "POST", { specId: task.specId, ...(hourly ? { everyMinutes: hourly } : { time, days }) });
    toast.success(`Remuse will do this ${hourly ? every(hourly) : onDays(days, time)}, even with Chrome closed.`);
    onSaved();
  });
  const stop = () => run("stop", async () => { await api(`/schedules/${schedule!.id}`, "DELETE"); toast("It won't repeat by itself anymore."); onSaved(); });
  const tab = (on: boolean) => cn("rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors", on ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground");

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        <button type="button" className={tab(hourly !== null)} aria-pressed={hourly !== null} onClick={() => setHourly(hourly ?? 60)}>Every few hours</button>
        <button type="button" className={tab(hourly === null)} aria-pressed={hourly === null} onClick={() => setHourly(null)}>On days at a time</button>
      </div>
      {hourly !== null ? (
        <label className="flex items-center gap-2 text-muted-foreground">Every
          <Input type="number" min={1} max={24} value={hourly / 60} onChange={(e) => setHourly(Math.max(1, Math.min(24, Number(e.target.value) || 1)) * 60)} className="h-8 w-16 rounded-full px-3 font-mono" />
          hour(s)
        </label>
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          {DAYS.map((d, i) => {
            const on = days.includes(String(i + 1));
            return (
              <button key={i} type="button" aria-pressed={on} aria-label={NAMES[i]} onClick={() => setDays((x) => (on ? x.replace(String(i + 1), "") : [...x, String(i + 1)].sort().join("")))}
                className={cn("size-8 rounded-full border text-[12px] font-medium transition-colors", on ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>{d}</button>
            );
          })}
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" className="ml-2 h-8 w-[104px] rounded-full px-3 font-mono" />
        </div>
      )}
      <div className="flex gap-2">
        <Button size="sm" className="rounded-full" onClick={save} disabled={!!busy || (hourly === null && !days)}>
          {busy === "save" ? <LoaderCircle className="animate-spin" /> : <CalendarClock />}{schedule ? "Save" : "Repeat it"}
        </Button>
        {schedule ? <Button size="sm" variant="ghost" className="rounded-full" onClick={stop} disabled={!!busy}>Stop repeating</Button> : null}
      </div>
    </div>
  );
}
