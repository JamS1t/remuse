// What a finished run took, for the video and the README: seconds per item and the AI model calls it made (by what
// they were for). Only measured numbers go on screen. Ask the Agent that ran it, while it's still running (model
// calls are kept in its memory): node scripts/measure.ts <run id> [port, default 3200]
const [id, port = "3200"] = process.argv.slice(2);
if (!id) { console.error("usage: node scripts/measure.ts <run id> [port]"); process.exit(1); }
const api = `http://127.0.0.1:${port}/api`;
const run = await (await fetch(`${api}/runs/${id}`)).json();
if (run.error && !run.items) { console.error(run.error); process.exit(1); }
const calls = ((await (await fetch(`${api}/calls`)).json()) as { at: number; label: string; ms: number; model: string }[])
  .filter((c) => c.at >= run.startedAt && c.at <= (run.endedAt ?? Date.now()));
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

console.log(`Run ${id} · ${run.status} · ${run.items.length} item(s) · ${secs((run.endedAt ?? Date.now()) - run.startedAt)} in all\n`);
console.log("| Item | Status | Time | Model calls |\n|---|---|---|---|");
for (const it of run.items as { label: string; status: string; log: { at: number }[] }[]) {
  const from = it.log[0]?.at, to = it.log.at(-1)?.at;
  const n = from ? calls.filter((c) => c.at >= from && c.at <= (to ?? from)).length : 0;
  console.log(`| ${it.label} | ${it.status} | ${from && to ? secs(to - from) : "–"} | ${n} |`);
}
const by = new Map<string, { n: number; ms: number }>();
for (const c of calls) { const b = by.get(c.label) ?? { n: 0, ms: 0 }; b.n++; b.ms += c.ms; by.set(c.label, b); }
console.log(`\nModel calls: ${calls.length}${calls.length ? ` (${[...by].map(([l, b]) => `${l} ${b.n}`).join(", ")})` : ""}`);
console.log(`Models: ${[...new Set(calls.map((c) => c.model))].join(", ") || "none"}`);
