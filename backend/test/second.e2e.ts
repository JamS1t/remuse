// End-to-end: a second model checks the first. With a partner key, the checker is Muse Spark Open (Meta's open
// weights, through an OpenAI-style Chat Completions endpoint): it answers the same judgement questions on its own
// before anything irreversible, and looks at the screen after. When the two models disagree, Remuse asks you
// (even in a run you started "without asking"). Without a key, Muse Spark is asked again, fresh.
// Uses its own Agent, data folder, a stand-in shop and stand-in models. Needs port 3200 free.
// Run: node test/second.e2e.ts
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const API = "http://127.0.0.1:3200/api";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: [string, boolean, string][] = [];
const check = (n: string, ok: boolean, d = "") => { results.push([n, ok, d]); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  (${d})` : ""}`); };
const get = async (p: string) => (await fetch(API + p)).json();
const post = async (p: string, b: unknown = {}) => (await fetch(API + p, { method: "POST", body: JSON.stringify(b) })).json();
if (await fetch(`${API}/sessions`).then(() => true, () => false)) { console.error("Port 3200 is busy: stop the Remuse Agent first."); process.exit(1); }

// Three claims, each with a photo. What was done to each is recorded.
const claims = [{ id: 1, subject: "Cracked mug" }, { id: 2, subject: "Late parcel" }, { id: 3, subject: "Torn box" }];
const done: string[] = [];
const photo = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><rect width="160" height="120" fill="#c84"/><path d="M20 20 L140 100" stroke="#000" stroke-width="6"/></svg>')}`;
const site = createServer(async (req, res) => {
  const m = /^\/(replace|refund)\?id=(\d)$/.exec(req.url ?? "");
  if (req.method === "POST" && m) { done.push(`${m[1]} ${m[2]}`); res.writeHead(303, { Location: "/ok" }); return res.end(); }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  if (req.url === "/claims") return res.end(`<!doctype html><title>Claims</title>${claims.map((c) => `<p><a class="claim" href="/claim?id=${c.id}">${c.subject}</a></p>`).join("")}`);
  if (req.url === "/ok") return res.end("<p>Done</p>");
  const c = claims.find((x) => req.url === `/claim?id=${x.id}`);
  res.end(c ? `<!doctype html><title>${c.subject}</title><main><h1>${c.subject}</h1><p>Photo attached.</p><img src="${photo}" width="160" height="120" alt="photo">
    <form method="post" action="/replace?id=${c.id}"><button>Send replacement</button></form><form method="post" action="/refund?id=${c.id}"><button>Refund</button></form></main>` : "<p>Not found</p>");
}).listen(0);
const SITE = `http://127.0.0.1:${(site.address() as any).port}`;

// Stand-in models. Muse Spark (Responses API) judges every photo "damaged". Muse Spark Open (Chat Completions)
// disagrees on the late parcel. Both note what they were asked.
const asked: { api: "responses" | "chat"; label: string; body: any; auth?: string }[] = [];
const model = createServer(async (req, res) => {
  let raw = ""; for await (const c of req) raw += c;
  const body = JSON.parse(raw || "{}");
  const api = req.url?.endsWith("/chat/completions") ? "chat" : "responses";
  const textOf = api === "chat" ? body.messages?.[0]?.content?.find((p: any) => p.type === "text")?.text ?? "" : body.input?.[0]?.content?.find((p: any) => p.type === "input_text")?.text ?? "";
  const label = textOf.includes("Did the step work?") ? "check" : textOf.includes("Answer each question") ? "judge" : "other";
  asked.push({ api, label, body, auth: req.headers.authorization });
  const answer = label === "check" ? { ok: true, why: "the page says Done" }
    : label === "judge" ? { damage: { answer: api === "chat" && textOf.includes("Late parcel") ? "fine" : "damaged", why: api === "chat" ? "checker's look" : "first look" } }
    : {};
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(api === "chat" ? { choices: [{ message: { content: JSON.stringify(answer) } }], usage: { total_tokens: 1 } } : { output_text: JSON.stringify(answer), usage: { total_tokens: 1 } }));
}).listen(0);
const MODEL = `http://127.0.0.1:${(model.address() as any).port}/v1`;

const spec = {
  title: "Handle claims", goal: "Replace damaged items, refund the rest.", scope: "", scopeTypes: [],
  inputs: { source: "list", itemName: "claim", listUrl: `${SITE}/claims`, itemSelector: "a.claim" },
  variables: [{ name: "damage", kind: "judge", description: "Is the item in the photo damaged?", question: "Does the photo show damage?", options: ["damaged", "fine"], demoValue: "damaged" }],
  steps: [{ id: "s1", do: "open_item", describe: "Open the claim" }, { id: "s2", do: "extract", vars: ["damage"], describe: "Look at the photo" }],
  rules: [{ if: "damage is damaged", then: "replace" }, { if: "otherwise", then: "refund" }],
  outcomes: {
    replace: { describe: "Replace it", demonstrated: true, steps: [{ id: "s3", do: "click", target: { role: "button", name: "Send replacement" }, describe: "Send a replacement", expect: { textIncludes: "Done" } }] },
    refund: { describe: "Refund it", demonstrated: false, steps: [{ id: "s4", do: "click", target: { role: "button", name: "Refund" }, describe: "Refund it", expect: { textIncludes: "Done" } }] },
  },
};
const code = `({ extract: {}, compute: {}, decide: (v) => v.damage === "damaged" ? { outcome: "replace", rule: 0 } : { outcome: "refund", rule: 1 } })`;

const data = mkdtempSync(join(tmpdir(), "remuse-second-"));
let agent: ChildProcess | null = null;
const startAgent = async (openKey: string, openUrl = MODEL) => {
  agent = spawn(process.execPath, ["--env-file-if-exists=../.env", "src/server.ts"], {
    cwd: resolve(import.meta.dirname, ".."), stdio: process.env.SHOW_AGENT ? "inherit" : "ignore",
    env: { ...process.env, DATA_DIR: data, HEADLESS: "1", SHOWRUN_NO_NOTIFY: "1", MODEL_API_KEY: "", SHOWRUN_PROXY: MODEL, OPEN_MODEL_URL: openUrl, OPEN_MODEL_KEY: openKey, BASETEN_API_KEY: "" },
  });
  for (let i = 0; i < 40 && !(await fetch(`${API}/sessions`).then((r) => r.ok, () => false)); i++) await sleep(250);
};
const finished = async (id: string, until: (r: any) => boolean = () => false, secs = 90) => {
  let run: any;
  for (let i = 0; i < secs * 2; i++) { run = await get(`/runs/${id}`); if (until(run) || ["done", "failed", "stopped"].includes(run.status)) break; await sleep(500); }
  return run;
};
try {
  await startAgent("test-key");
  const s = await post("/sessions", { title: "Handle claims", startedAt: Date.now() });
  const db = new DatabaseSync(join(data, "showrun.db"));
  const specId = Number(db.prepare("INSERT INTO specs (session_id, version, note, json, code, tests, created_at) VALUES (?, 1, 'test', ?, ?, '[]', ?)").run(s.id, JSON.stringify(spec), code, Date.now()).lastInsertRowid);
  db.close();

  // 1. With a partner key: Muse Spark Open checks.
  const r = await post(`/specs/${specId}/runs`, { autoApprove: true });
  let run = await finished(r.id, (x) => x.pending?.kind === "ask");
  check("the run names its checker: Muse Spark Open", run.checker === "Muse Spark Open", run.checker);
  const agreed = run.items[0].log.find((l: any) => /^Second opinion/.test(l.msg));
  check("before replacing, the checker answered the same question and agreed", /Muse Spark Open agrees/.test(agreed?.msg ?? "") && agreed.by === "Muse Spark Open", agreed?.msg);
  const screen = run.items[0].log.find((l: any) => /^✓ Send a replacement/.test(l.msg));
  check("after the irreversible step, the checker looked at the screen", screen?.by === "Muse Spark Open" && screen.how === "screen", JSON.stringify(screen));
  check("when the two models disagree it asks you, even in a run started without asking", run.pending?.kind === "ask" && /disagree/.test(run.pending.question) && /Muse Spark says "damaged"/.test(run.pending.question) && /Muse Spark Open says "fine"/.test(run.pending.question), run.pending?.question);
  check("nothing was done to that claim before you answered", JSON.stringify(done) === JSON.stringify(["replace 1"]), JSON.stringify(done));
  await post(`/runs/${r.id}/answer`, { outcome: "refund", note: "the parcel was only late" });
  run = await finished(r.id);
  check("your answer decides it, and the rest carries on", run.status === "done" && JSON.stringify(done) === JSON.stringify(["replace 1", "refund 2", "replace 3"]), JSON.stringify(done));
  check("…and it says why it did what it did", run.items[1].decidedBy === "you" && /two models disagreed/.test(run.items[1].because), run.items[1].because);

  // What went to the open model: Chat Completions, the hackathon's model id, the key, the photo as an image.
  const chat = asked.filter((a) => a.api === "chat");
  const judge = chat.find((a) => a.label === "judge");
  check("the checker is called as Muse Spark Open (meta-models/muse-spark-open-1026) with the partner key", chat.length > 0 && chat.every((a) => a.body.model === "meta-models/muse-spark-open-1026" && a.auth === "Bearer test-key"), `${chat.length} calls, ${chat[0]?.body.model}`);
  check("…with the same page text and the photo", judge?.body.messages[0].content.some((p: any) => p.type === "image_url" && /^data:image\/png;base64,/.test(p.image_url.url)), JSON.stringify(judge?.body.messages[0].content.map((p: any) => p.type)));
  check("the first model never did the screen checks", !asked.some((a) => a.api === "responses" && a.label === "check"), asked.filter((a) => a.api === "responses").map((a) => a.label).join(","));
  const firstText = asked.find((a) => a.api === "responses" && a.label === "judge")?.body.input[0].content.find((p: any) => p.type === "input_text")?.text;
  const checkText = chat.find((a) => a.label === "judge")?.body.messages[0].content.find((p: any) => p.type === "text")?.text;
  check("…and the checker was asked exactly what the first model was asked", !!firstText && firstText === checkText);
  check("the partner key goes only to the partner", asked.filter((a) => a.api === "responses").every((a) => a.auth !== "Bearer test-key"));

  // 2. Without a key: Muse Spark asked again, fresh.
  agent?.kill(); await sleep(1500);
  asked.length = 0;
  await startAgent("");
  const r2 = await post(`/specs/${specId}/runs`, { autoApprove: true, redo: true, limit: 1 });
  const run2 = await finished(r2.id, (x) => !!x.pending);
  check("without a key there's no second opinion (the same model asking itself proves nothing): one judgement per item", run2.status === "done" && run2.checker === undefined && asked.filter((a) => a.label === "judge").length === 1 && asked.every((a) => a.api === "responses") && !run2.items[0].log.some((l: any) => /Second opinion/.test(l.msg)), `${run2.status}, ${asked.map((a) => `${a.api}:${a.label}`).join(",")}`);

  // 3. With a key but the partner down: the run still goes; it says there was no second opinion; Muse Spark checks the screen.
  agent?.kill(); await sleep(1500);
  asked.length = 0;
  await startAgent("test-key", "http://127.0.0.1:9/v1");
  const r3 = await post(`/specs/${specId}/runs`, { autoApprove: true, redo: true, limit: 1 });
  const run3 = await finished(r3.id, (x) => !!x.pending, 120);
  const log3 = run3.items[0]?.log ?? [];
  check("if the checker can't be reached, the run still finishes and says so", run3.status === "done" && run3.items[0].status === "done" && log3.some((l: any) => /No second opinion this time/.test(l.msg)), log3.map((l: any) => l.msg).join(" / "));
  check("…and Muse Spark checks the screen instead", log3.some((l: any) => /^✓ Send a replacement/.test(l.msg) && l.how === "screen" && !l.by) && asked.some((a) => a.api === "responses" && a.label === "check"), JSON.stringify(log3.find((l: any) => /^✓ Send/.test(l.msg))));
} finally {
  agent?.kill(); site.close(); model.close();
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map(([n]) => n).join(" | ")}` : ""}`);
}
