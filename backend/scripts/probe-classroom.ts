// Look at a real Google Classroom assignment the way Remuse sees it, at full and at half width, before building the
// Classroom plug-in and the half-width heal on guesses. Read-only: it opens the file picker to see where its upload
// control lives, but never chooses a file, uploads or turns anything in.
// Run with the Agent idle (it uses Remuse's own browser profile): node scripts/probe-classroom.ts <assignment URL>
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { openBrowser } from "../src/runner.ts";

const url = process.argv[2] ?? "";
if (!/^https:\/\/classroom\.google\.com\//.test(url)) { console.error("usage: node scripts/probe-classroom.ts <classroom assignment URL>"); process.exit(1); }
const out = resolve(import.meta.dirname, "..", "data", "probe");
mkdirSync(out, { recursive: true });

const ctx = await openBrowser(false);
const page = ctx.pages()[0] ?? (await ctx.newPage());
// Every visible control with its role, accessible name and id: what Remuse's element list will offer the model.
const controls = () => page.evaluate(() => [...document.querySelectorAll("button, a, input, textarea, [role=button], [role=link], [role=menuitem], [role=tab]")]
  .filter((el) => { const r = (el as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.height > 0; })
  .map((el) => ({ role: el.getAttribute("role") ?? el.tagName.toLowerCase(), name: (el.getAttribute("aria-label") || (el as HTMLElement).innerText || el.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 60), id: el.id || "" }))
  .filter((x) => x.name).slice(0, 150));
try {
  for (const width of [1280, 640]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(url);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1500);
    const els = await controls();
    console.log(`\n== ${width} px: ${els.length} controls`);
    for (const e of els) console.log(`  ${e.role.padEnd(10)} ${e.name}${e.id ? `  #${e.id}` : ""}`);
    const add = page.getByRole("button", { name: "Add or create" });
    console.log(`  "Add or create" by role + name: ${await add.count()} (visible: ${await add.first().isVisible().catch(() => false)})`);
    const turnIn = page.getByRole("button", { name: /turn in|hand in|mark as done/i });
    console.log(`  Turn in control: ${(await turnIn.count()) ? ((await turnIn.first().getAttribute("aria-label")) ?? (await turnIn.first().innerText())) : "none"}`);
    await page.screenshot({ path: join(out, `classroom-${width}.png`) });
  }
  // Where the upload control is: open the picker (nothing is chosen), list its frames and file inputs, close it.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(url);
  await page.waitForTimeout(1500);
  const add = page.getByRole("button", { name: /add or create/i }).first();
  if (!(await add.count())) console.log("\n  no Add or create button at 1280 px");
  else {
    await add.click();
    await page.waitForTimeout(800);
    const file = page.getByRole("menuitem", { name: /^file$/i }).first();
    if (!(await file.count())) console.log("\n  the Add or create menu has no File item");
    else {
      await file.click();
      await page.waitForTimeout(4000);
      console.log("\n== file picker frames");
      for (const f of page.frames()) console.log(`  ${f.url().slice(0, 90)}  file inputs: ${await f.locator("input[type=file]").count().catch(() => "?")}`);
      await page.screenshot({ path: join(out, "classroom-picker.png") });
      await page.keyboard.press("Escape");
    }
  }
} finally {
  await ctx.close();
}
console.log(`\nScreenshots in ${out}`);
