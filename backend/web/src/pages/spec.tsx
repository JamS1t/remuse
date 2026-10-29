import { useState, type ReactNode } from "react";
import { Check, CircleAlert, Eye, Hand, LoaderCircle, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Crumb, ErrorNote, Revision, Said, revColor, revName, useAction } from "@/components/bits";
import { Loading } from "@/pages/lists";
import { api, useApi, type SessionFull, type SpecRow, type Step } from "@/lib/api";
import { cn } from "@/lib/utils";

const KIND: Record<string, string> = { text: "Read from the page", vision: "Looked at in a photo", judge: "Judged from the text", computed: "Worked out" };

/** Lines changed in this revision carry an asterisk in the right margin, like a revised script page. */
function Line({ n, changed, children }: { n?: number; changed?: boolean; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[28px_1fr_16px] gap-x-2 border-b border-rule py-3 last:border-b-0">
      <span className="pt-px text-right font-mono text-[12px] text-muted-foreground">{n ?? ""}</span>
      <div className="min-w-0">{children}</div>
      <span className="font-mono text-[14px] font-semibold" aria-label={changed ? "changed in this version" : undefined}>{changed ? "*" : ""}</span>
    </li>
  );
}

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol>
      {steps.map((s, i) => (
        <Line key={s.id ?? i} n={i + 1} changed={!!s.healed}>
          <p>{s.describe}</p>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-muted-foreground">
            {s.target?.name && s.do !== "open_item" ? <span>{s.target.role} <span className="font-medium text-foreground">“{s.target.name}”</span></span> : null}
            {s.do === "fill" && s.value ? <span>types <span className="font-mono text-foreground">{s.value}</span></span> : null}
            {s.do === "compare" ? <span className="font-medium text-foreground">Opens the top {s.max ?? 5} results and keeps the best</span> : null}
            {s.do === "report" && s.message ? <span>tells you <span className="text-foreground">“{s.message}”</span></span> : null}
            {s.vars?.length ? <span>{s.do === "compare" ? "reads on each" : "reads"} <span className="font-mono text-foreground">{s.vars.join(", ")}</span></span> : null}
            {s.tool ? <span>uses the site's WebMCP tool <span className="font-mono text-foreground">{s.tool.name}</span> when offered</span> : null}
            {s.irreversible ? <span className="inline-flex items-center gap-1 font-medium text-foreground"><Hand className="size-3.5" />Waits for your OK</span> : null}
          </p>
          {s.do === "compare" && s.said ? <p className="mt-1.5"><Said>{s.said}</Said></p> : null}
          {s.healed ? <p className="mt-1 text-[12.5px] text-warn">Updated after a layout change: {s.healed}</p> : null}
        </Line>
      ))}
    </ol>
  );
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
/** Header line + rows, comma or tab separated (pasting from a spreadsheet gives tabs). Quotes allowed. */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const sep = lines[0].includes("\t") ? "\t" : ",";
  const split = (l: string) => {
    const out: string[] = []; let cur = "", q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === sep) { out.push(cur.trim()); cur = ""; } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const head = split(lines[0]);
  return lines.slice(1).map((l) => { const c = split(l); return Object.fromEntries(head.map((h, i) => [h, c[i] ?? ""])); });
}

const Sheet = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn("rounded-lg border bg-card px-4", className)}>{children}</div>
);

export function SpecPage({ id }: { id: number }) {
  const { data: row, error, reload } = useApi<SpecRow>(`/specs/${id}`);
  const { data: session } = useApi<SessionFull | null>(row ? `/sessions/${row.sessionId}` : null);
  const { busy, run } = useAction();
  const [limit, setLimit] = useState("");
  const [auto, setAuto] = useState(false);
  const [json, setJson] = useState<string | null>(null);
  const [rowsText, setRowsText] = useState<string | null>(null);

  if (error) return <main className="mx-auto max-w-[1240px] px-5 pt-6"><ErrorNote>{error}</ErrorNote></main>;
  if (!row) return <main className="mx-auto max-w-[1240px] px-5 pt-6"><Loading /></main>;
  const s = row.spec;
  const item = s.inputs?.itemName || "item";
  const tests = row.tests ?? [];
  const passed = tests.filter((t) => t.ok).length;
  const versions = session?.specs ?? [];
  const cols = s.inputs.columns ?? [];
  const isRows = s.inputs.source === "rows" || (!s.inputs.listUrl && cols.length > 0);
  const isOnce = s.inputs.source === "once";
  const rowsValue = rowsText ?? [cols.map((c) => c.name).join(","), cols.map((c) => csvCell(c.demoValue)).join(",")].join("\n");

  const build = () => run("build", async () => { await api(`/specs/${id}/build`, "POST"); reload(); });
  const start = () => run("run", async () => {
    const rows = isRows ? parseCsv(rowsValue) : undefined;
    if (isRows && !rows?.length) throw new Error("Add at least one row under the header line.");
    const r = await api<{ id: string }>(`/specs/${id}/runs`, "POST", { limit: limit ? Number(limit) : undefined, autoApprove: auto, rows });
    location.hash = `#/run/${r.id}`;
  });
  const save = () => run("save", async () => {
    let spec;
    try { spec = JSON.parse(json ?? ""); } catch (e) { throw new Error(`That is not valid JSON: ${(e as Error).message}`); }
    const r = await api<{ id: number }>(`/specs/${id}`, "PUT", { spec });
    location.hash = `#/spec/${r.id}`;
  });

  return (
    <>
      {/* The spec sheet takes its revision colour, edge to edge. */}
      <div className="border-b border-black/10" style={{ background: revColor(row.version) }}>
        <div className="mx-auto max-w-[1240px] px-5 pt-5 pb-5">
          <Crumb href={`#/session/${row.sessionId}`}>Recording</Crumb>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
            <div className="max-w-[72ch]">
              <h1 className="text-[22px] leading-tight font-semibold">{s.goal}</h1>
              <p className="mt-1.5 text-foreground/75">Task Spec v{row.version}, {revName(row.version)} revision{row.note ? ` · ${row.note}` : ""}</p>
            </div>
            {versions.length > 1 ? (
              <div className="flex flex-wrap gap-0.5" aria-label="Versions">
                {[...versions].reverse().map((x) => <Revision key={x.id} v={x.version} href={`#/spec/${x.id}`} active={x.id === id} />)}
              </div>
            ) : null}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-black/10 bg-card/80 px-3 py-2.5">
            <div className="flex items-center gap-3">
              <Button variant={row.code ? "outline" : "default"} onClick={build} disabled={!!busy}>
                {busy === "build" ? <><LoaderCircle className="animate-spin" />Writing and testing the code</> : row.code ? "Build again" : "Build the rules into code"}
              </Button>
              {row.code ? (
                <span className={cn("inline-flex items-center gap-1.5 text-[13px] font-medium", passed === tests.length ? "text-ok" : "text-destructive")}>
                  {passed === tests.length ? <Check className="size-3.5" /> : <X className="size-3.5" />}{passed} of {tests.length} checks pass
                </span>
              ) : <span className="text-[13px] text-muted-foreground">Needed before a run</span>}
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-4">
              {isOnce ? null : <div className="flex items-center gap-2">
                <Label htmlFor="limit" className="font-normal text-muted-foreground">{item[0].toUpperCase() + item.slice(1)}s</Label>
                <Input id="limit" type="number" min={1} placeholder="All" value={limit} onChange={(e) => setLimit(e.target.value)} className="h-8 w-20 bg-card font-mono" />
              </div>}
              <div className="flex items-center gap-2">
                <Checkbox id="auto" checked={auto} onCheckedChange={(v) => setAuto(v === true)} />
                <Label htmlFor="auto" className="font-normal">Approve irreversible steps in advance</Label>
              </div>
              <Button onClick={start} disabled={!!busy || !row.code} title={row.code ? undefined : "Build the rules first"}>
                {busy === "run" ? <LoaderCircle className="animate-spin" /> : <Play className="fill-current" />}{isRows ? "Run on these rows" : isOnce ? "Run it now" : "Run on the list"}
              </Button>
            </div>
            {isRows ? (
              <div className="basis-full">
                <Label htmlFor="rows" className="text-[13px] font-semibold">One {item} per line <span className="font-normal text-muted-foreground">CSV: keep the header, paste from a spreadsheet, or type</span></Label>
                <Textarea id="rows" value={rowsValue} onChange={(e) => setRowsText(e.target.value)} spellCheck={false} rows={Math.min(8, Math.max(3, rowsValue.split("\n").length + 1))} className="mt-1.5 bg-card font-mono text-[12.5px]" />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-[1240px] px-5 pt-6 pb-20">
        <Tabs defaultValue="steps">
          <TabsList variant="line" className="w-full justify-start gap-4 overflow-x-auto overflow-y-hidden border-b *:flex-none *:px-0.5">
            <TabsTrigger value="steps">Steps</TabsTrigger>
            <TabsTrigger value="rules">Your rules</TabsTrigger>
            <TabsTrigger value="outcomes">What each decision does</TabsTrigger>
            <TabsTrigger value="reads">What it reads</TabsTrigger>
            <TabsTrigger value="code">Code and checks</TabsTrigger>
            <TabsTrigger value="edit" onClick={() => setJson((j) => j ?? JSON.stringify(s, null, 2))}>Edit</TabsTrigger>
          </TabsList>

          <TabsContent value="steps" className="mt-5 grid gap-6 lg:grid-cols-[1fr_320px]">
            <div>
              {isOnce
                ? <p className="mb-3 text-muted-foreground">Runs on its own each time, nothing to go through.</p>
                : isRows
                ? <p className="mb-3 text-muted-foreground">For every {item} you give it, with {cols.map((c, i) => <span key={c.name}>{i ? ", " : ""}<span className="font-mono text-[13px] text-foreground">{c.name}</span> ({c.describe})</span>)}</p>
                : <p className="mb-3 text-muted-foreground">For every {item} in <a href={s.inputs.listUrl} target="_blank" rel="noreferrer" className="font-mono text-[13px]">{s.inputs.listUrl}</a></p>}
              <Sheet><Steps steps={s.steps} /></Sheet>
            </div>
            <aside>
              <h3 className="text-[13px] font-semibold">Scope</h3>
              <p className="mt-1 text-muted-foreground">{s.scope}</p>
              {s.scopeTypes?.length ? (
                <ul className="mt-3 space-y-1">
                  {s.scopeTypes.map((t) => <li key={t} className="flex items-center gap-2"><Check className="size-3.5 text-ok" />{t.replaceAll("_", " ")}</li>)}
                  <li className="flex items-center gap-2 text-muted-foreground"><CircleAlert className="size-3.5" />Anything else: Remuse stops and asks you</li>
                </ul>
              ) : null}
            </aside>
          </TabsContent>

          <TabsContent value="rules" className="mt-5 max-w-[860px]">
            <p className="mb-3 text-muted-foreground">Checked top to bottom. The first rule that matches decides.</p>
            <Sheet>
              <ol>
                {s.rules.map((r, i) => (
                  <Line key={i} n={i + 1} changed={r.learned}>
                    <p>If <span className="font-medium">{r.if}</span>, then <span className="font-semibold">{r.then}</span></p>
                    {r.said ? <p className="mt-1.5"><Said>{r.said}</Said></p> : null}
                    {r.learned ? <p className="mt-1 text-[12.5px] text-muted-foreground">Learned from your answer during a run</p> : null}
                  </Line>
                ))}
              </ol>
            </Sheet>
          </TabsContent>

          <TabsContent value="outcomes" className="mt-5 grid max-w-[860px] gap-8">
            {Object.entries(s.outcomes).map(([k, o]) => (
              <section key={k}>
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h3 className="text-[15px] font-semibold capitalize">{k.replaceAll("_", " ")}</h3>
                  {o.demonstrated
                    ? <span className="inline-flex items-center gap-1.5 text-[13px] text-ok"><Eye className="size-3.5" />You showed this</span>
                    : <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-warn"><CircleAlert className="size-3.5" />Inferred from the screen. Check it.</span>}
                </div>
                <p className="mt-1 text-muted-foreground">{o.describe}</p>
                <Sheet className="mt-3"><Steps steps={o.steps} /></Sheet>
                {o.reply ? (
                  <div className="mt-3 rounded-lg border bg-muted/60 px-4 py-3">
                    <p className="text-[12px] font-medium text-muted-foreground">Reply it sends</p>
                    <p className="mt-1 whitespace-pre-wrap">{o.reply}</p>
                  </div>
                ) : null}
              </section>
            ))}
          </TabsContent>

          <TabsContent value="reads" className="mt-5">
            <div className="rounded-lg border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4">Name</TableHead><TableHead>How</TableHead><TableHead>What it is</TableHead><TableHead className="pr-4">In your demo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.variables.map((v) => (
                    <TableRow key={v.name} className="hover:bg-transparent">
                      <TableCell className="pl-4 align-top font-mono text-[12.5px] font-medium">{v.name}</TableCell>
                      <TableCell className="align-top text-muted-foreground">{KIND[v.kind] ?? v.kind}</TableCell>
                      <TableCell className="max-w-[46ch] align-top whitespace-normal">{v.description}{v.question ? <p className="mt-1 text-muted-foreground">Asks: {v.question}</p> : null}</TableCell>
                      <TableCell className="pr-4 align-top font-mono text-[12.5px]">{JSON.stringify(v.demoValue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="code" className="mt-5">
            {!row.code ? (
              <p className="max-w-[68ch] text-muted-foreground">Not built yet. Building has Muse Spark write your rules as JavaScript, then runs it against your demo and its own tests. Dates, thresholds and rule order are computed in code, not guessed.</p>
            ) : (
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <section>
                  <h3 className="mb-2 text-[13px] font-semibold">Checks against your demo</h3>
                  <Sheet>
                    <ul>
                      {tests.map((t, i) => (
                        <li key={i} className="flex gap-2.5 border-b border-rule py-2.5 last:border-b-0">
                          {t.ok ? <Check className="mt-0.5 size-4 shrink-0 text-ok" /> : <X className="mt-0.5 size-4 shrink-0 text-destructive" />}
                          <div className="min-w-0"><p>{t.name}</p>{t.detail ? <p className="text-[12.5px] text-muted-foreground">{t.detail}</p> : null}</div>
                        </li>
                      ))}
                    </ul>
                  </Sheet>
                </section>
                <section className="min-w-0">
                  <h3 className="mb-2 text-[13px] font-semibold">The code</h3>
                  <pre className="max-h-[560px] overflow-auto rounded-lg border bg-[#17181b] p-4 font-mono text-[12px] leading-relaxed text-[#ecebe6]">{row.code}</pre>
                </section>
              </div>
            )}
          </TabsContent>

          <TabsContent value="edit" className="mt-5 max-w-[960px]">
            <p className="mb-3 text-muted-foreground">Saving makes a new version. Build it again before the next run.</p>
            <Textarea value={json ?? ""} onChange={(e) => setJson(e.target.value)} spellCheck={false} className="min-h-[480px] bg-card font-mono text-[12.5px] leading-relaxed" />
            <div className="mt-3 flex gap-2">
              <Button onClick={save} disabled={!!busy}>{busy === "save" ? <LoaderCircle className="animate-spin" /> : null}Save as v{(versions[0]?.version ?? row.version) + 1}</Button>
              <Button variant="ghost" onClick={() => setJson(JSON.stringify(s, null, 2))}>Discard changes</Button>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </>
  );
}
