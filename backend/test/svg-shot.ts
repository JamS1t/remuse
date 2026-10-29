// Render an SVG file on a background for review. Run: node test/svg-shot.ts <file.svg> <out.png> [bg]
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
const [file, out, bg = "#0b0b0d"] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 760, height: 220 } });
await p.setContent(`<body style="margin:0;background:${bg};display:grid;place-items:center;height:100vh">${readFileSync(file, "utf8").replace("<svg ", '<svg style="width:640px;height:auto" ')}</body>`);
await p.screenshot({ path: out });
await b.close();
