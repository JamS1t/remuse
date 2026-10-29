// Screenshot a UI route for review. Run: node test/shot.ts <route like run/ID> <out.png> [width]
import { chromium } from "playwright";
const [route, out, width = "1440"] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: Number(width), height: 900 } });
await p.goto(`http://127.0.0.1:3200/#/${route}`);
await p.waitForTimeout(1500);
console.log(p.url());
await p.screenshot({ path: out, fullPage: true });
await b.close();
