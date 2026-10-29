// Check: the Showrun extension's sidebar loads the Agent's remote page, and connecting a site shares
// that site's login with the Agent (and disconnecting removes it). Starts its own Agent on port 3200.
// Run: node test/sidepanel.check.ts [screenshot.png]
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const API = "http://127.0.0.1:3200/api";
const ext = resolve(import.meta.dirname, "../../extension");
const agent = spawn(process.execPath, ["--env-file-if-exists=../.env", "src/server.ts"], { cwd: resolve(import.meta.dirname, ".."), stdio: "ignore" });
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "showrun-panel-")), {
  channel: "chromium", headless: true, viewport: { width: 400, height: 900 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
try {
  for (let i = 0; i < 40 && !(await fetch(`${API}/sessions`).then((r) => r.ok, () => false)); i++) await new Promise((r) => setTimeout(r, 250));
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
  const id = new URL(sw.url()).host;

  await ctx.addCookies([{ name: "sr_test", value: "signed-in", domain: ".example.com", path: "/", secure: true, httpOnly: true, sameSite: "Lax", expires: Date.now() / 1000 + 3600 }]);
  const connected = await sw.evaluate(() => (globalThis as any).showrun.connect("example.com"));
  const logins = await (await fetch(`${API}/logins`)).json();
  console.log("connected:", connected, "agent has:", logins);
  console.assert(logins.some((l: any) => l.site === "example.com" && l.cookies >= 1), "login not shared with the Agent");

  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  const frame = panel.frameLocator("#ui");
  await frame.getByText("Connected sites").waitFor({ timeout: 15000 });
  await frame.getByText("example.com").waitFor({ timeout: 5000 });
  console.log("sidebar shows the connected site");
  if (process.argv[2]) await panel.screenshot({ path: process.argv[2], fullPage: true });

  await sw.evaluate(() => (globalThis as any).showrun.disconnect("example.com"));
  const after = await (await fetch(`${API}/logins`)).json();
  console.assert(!after.some((l: any) => l.site === "example.com"), "login not removed on disconnect");
  console.log("disconnect removed it:", !after.some((l: any) => l.site === "example.com"));
} finally {
  await ctx.close();
  agent.kill();
}
