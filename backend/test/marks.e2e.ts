// End-to-end: drawing on the page while teaching. A right-button drag around something makes a "mark" on it, with a
// picture that shows the ink; a plain right-click still opens the menu; the pen (Alt+Shift+D) draws with the left
// button without clicking the page; nothing draws when not teaching. Uses its own Agent on port 3298 and a copy of
// the extension pointed at it, so the Agent you use (3200) keeps running. Run: node test/marks.e2e.ts
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright";

const PORT = "3298";
const API = `http://127.0.0.1:${PORT}/api`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: [string, boolean, string][] = [];
const check = (n: string, ok: boolean, d = "") => { results.push([n, ok, d]); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  (${d})` : ""}`); };
const get = async (p: string) => (await fetch(API + p)).json();
if (await fetch(`${API}/sessions`).then(() => true, () => false)) { console.error(`Port ${PORT} is busy: another test is running.`); process.exit(1); }

// The extension, pointed at this test's Agent.
const tmp = mkdtempSync(join(tmpdir(), "remuse-marks-"));
const ext = join(tmp, "extension");
cpSync(resolve(import.meta.dirname, "../../extension"), ext, { recursive: true });
for (const f of readdirSync(ext).filter((x) => x.endsWith(".js"))) writeFileSync(join(ext, f), readFileSync(join(ext, f), "utf8").replaceAll("127.0.0.1:3200", `127.0.0.1:${PORT}`));
const quiet = join(tmp, "quiet.wav");
{ const n = 16000 * 60, b = Buffer.alloc(44 + n * 2); b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40); writeFileSync(quiet, b); }

const site = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><title>Stats</title><body style="margin:0;font:16px sans-serif">
    <p style="margin:140px 0 0 200px"><span id="views" style="font-size:28px">Views 2,607</span></p>
    <p style="margin:120px 0 0 200px"><span id="ctr" style="font-size:20px">CTR 5.1%</span></p>
    <p style="margin:120px 0 0 200px"><button id="go">Go</button></p>
    <script>window.__menus = []; addEventListener("contextmenu", (e) => __menus.push(e.defaultPrevented)); window.__clicks = 0; document.getElementById("go").onclick = () => __clicks++;</script>`);
}).listen(0);
const SITE = `http://127.0.0.1:${(site.address() as any).port}`;

const agent = spawn(process.execPath, ["--env-file-if-exists=../.env", "src/server.ts"], {
  cwd: resolve(import.meta.dirname, ".."), env: { ...process.env, PORT, DATA_DIR: join(tmp, "data"), BROWSER_PROFILE: join(tmp, "browser"), HEADLESS: "1", SHOWRUN_NO_NOTIFY: "1", OPEN_MODEL_KEY: "", BASETEN_API_KEY: "" }, stdio: process.env.SHOW_AGENT ? "inherit" : "ignore",
});
const ctx = await chromium.launchPersistentContext(join(tmp, "profile"), {
  channel: "chromium", headless: true, viewport: { width: 1000, height: 700 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${quiet}`],
});

// A ring drawn around an element's box, with the given mouse button.
async function ring(page: Page, sel: string, button: "left" | "right") {
  const b = (await page.locator(sel).boundingBox())!;
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2, rx = b.width / 2 + 18, ry = b.height / 2 + 14;
  await page.mouse.move(cx + rx, cy); await page.mouse.down({ button });
  for (let a = 0; a <= 360; a += 20) await page.mouse.move(cx + rx * Math.cos((a * Math.PI) / 180), cy + ry * Math.sin((a * Math.PI) / 180), { steps: 2 });
  await page.mouse.up({ button });
}
async function underline(page: Page, sel: string) {
  const b = (await page.locator(sel).boundingBox())!;
  await page.mouse.move(b.x - 4, b.y + b.height + 4); await page.mouse.down({ button: "right" });
  await page.mouse.move(b.x + b.width + 4, b.y + b.height + 6, { steps: 12 }); await page.mouse.up({ button: "right" });
}

try {
  for (let i = 0; i < 40 && !(await fetch(`${API}/sessions`).then((r) => r.ok, () => false)); i++) await sleep(250);
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
  const call = (fn: string, ...a: unknown[]) => sw.evaluate(([f, args]) => (globalThis as any).showrun[f as string](...(args as unknown[])), [fn, a] as const) as Promise<any>;
  // A second tab, open before teaching starts, to hop to and back.
  const second = await ctx.newPage();
  await second.goto(`${SITE}/sheet`);
  const page = await ctx.newPage();
  await page.goto(SITE);
  await call("start", "");
  for (let i = 0; i < 20 && !(await call("status")).recording; i++) await sleep(500);
  const id = (await call("status")).rec.id;
  await page.bringToFront(); await sleep(800);

  await ring(page, "#views", "right"); await sleep(2500);
  await underline(page, "#ctr"); await sleep(2500);
  const b = (await page.locator("#go").boundingBox())!;
  await page.mouse.click(b.x + 200, b.y + 40, { button: "right" }); await sleep(600);
  const menus = await page.evaluate(() => (window as any).__menus);

  await call("command", "pen"); await sleep(300);
  await ring(page, "#go", "left"); await sleep(2500);
  const clicksDuringPen = await page.evaluate(() => (window as any).__clicks);
  await call("command", "pen"); await sleep(300);

  const s = await get(`/sessions/${id}`);
  const marks = s.events.filter((e: any) => e.kind === "mark");
  const m = marks[0], u = marks[1], p = marks[2];
  console.log("   marks:", JSON.stringify(marks.map((x: any) => ({ shape: x.shape, targets: x.targets?.map((t: any) => t.text), before: !!x.before }))));
  check("circling a number with the right button makes a mark on it, with a picture", m?.shape === "circle" && m.targets?.some((t: any) => /Views 2,607/.test(t.text ?? "")) && !!m.before, JSON.stringify(m)?.slice(0, 300));
  check("underlining makes an underline mark on what's above it", u?.shape === "underline" && u.targets?.some((t: any) => /CTR 5\.1%/.test(t.text ?? "")), JSON.stringify(u)?.slice(0, 300));
  check("a drag doesn't open the right-click menu; a plain right-click does", menus.length >= 1 && menus.at(-1) === false && !menus.slice(0, -1).some((x: boolean) => x === false), JSON.stringify(menus));
  check("pen mode: a left drag draws and isn't a click", p?.shape === "circle" && p.targets?.some((t: any) => /Go/.test(t.text ?? "")) && clicksDuringPen === 0 && !s.events.some((e: any) => e.kind === "click"), JSON.stringify({ p: p?.shape, clicksDuringPen, clicks: s.events.filter((e: any) => e.kind === "click").length }));

  // Hopping to another tab and back is recorded, with what each tab shows, even with nothing clicked there.
  await second.bringToFront(); await sleep(2000);
  await page.bringToFront(); await sleep(2000);
  const hops = (await get(`/sessions/${id}`)).events.filter((e: any) => e.kind === "tab");
  check("switching to another tab is recorded, with a picture of it", hops.some((e: any) => e.url.endsWith("/sheet") && e.after), JSON.stringify(hops.map((e: any) => [e.url, !!e.after])));
  check("and switching back", hops.at(-1)?.url === `${SITE}/` && hops.length >= 2, JSON.stringify(hops.map((e: any) => e.url)));

  await call("stop"); await sleep(1500);
  await ring(page, "#views", "right"); await sleep(1500);
  const after = (await get(`/sessions/${id}`)).events.filter((e: any) => e.kind === "mark").length;
  check("not teaching: dragging draws nothing", after === marks.length, `${after} marks`);
} catch (e) {
  check("the test ran to the end", false, (e as Error).stack ?? String(e));
} finally {
  await ctx.close().catch(() => {});
  agent.kill(); site.close();
  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map(([n]) => n).join(" | ")}` : ""}`);
  process.exit(failed.length ? 1 : 0);
}
