// Screenshots of every view for design review. Starts its own Agent on 3200.
// Run: node test/screens.ts <out-dir> [orbState]   (orbState forces the sidebar orb, e.g. thinking)
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const out = process.argv[2] ?? "screens";
mkdirSync(out, { recursive: true });
const BASE = "http://127.0.0.1:3200";
const agent = spawn(process.execPath, ["--env-file-if-exists=../.env", "src/server.ts"], { cwd: resolve(import.meta.dirname, ".."), stdio: "ignore" });
const browser = await chromium.launch();
try {
  for (let i = 0; i < 40 && !(await fetch(`${BASE}/api/sessions`).then((r) => r.ok, () => false)); i++) await new Promise((r) => setTimeout(r, 250));
  const runs = await (await fetch(`${BASE}/api/runs`)).json();
  const tasks = await (await fetch(`${BASE}/api/tasks`)).json();
  const views: [string, string, number][] = [
    ["sidebar", "/#/remote", 400],
    ["home", "/#/", 1280],
    ["spec", `/#/spec/${tasks.find((t: any) => t.specId)?.specId}`, 1280],
    ["run", `/#/run/${runs[0]?.id}`, 1280],
  ];
  for (const [name, path, width] of views) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(BASE + path);
    await page.waitForTimeout(1200);
    if (name === "sidebar" && process.argv[3]) await page.evaluate((s) => document.querySelectorAll(".orb").forEach((o) => o.setAttribute("data-state", s)), process.argv[3]);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(out, `${name}.png`), fullPage: name !== "sidebar" });
    await page.close();
  }
  console.log("saved to", out);
} finally {
  await browser.close();
  agent.kill();
}
