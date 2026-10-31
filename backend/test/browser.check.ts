// How big Remuse's own browser draws pages. Hidden runs use a fixed size; a run you watch follows its window, so a
// window snapped to half the screen gets the site's narrow layout (as a person's would). No browser. Run: node test/browser.check.ts
import { viewportFor } from "../src/runner.ts";

let fails = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (${JSON.stringify(detail)})`}`); if (!ok) fails++; };

check("a hidden run draws pages at a fixed size", JSON.stringify(viewportFor(true)) === JSON.stringify({ width: 1440, height: 900 }), viewportFor(true));
check("a run you watch follows its window", viewportFor(false) === null, viewportFor(false));

console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
