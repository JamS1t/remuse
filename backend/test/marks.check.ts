// Marks on charts and canvases: of SAM 3.1's boxes, the one that best matches the ink wins. No model calls.
// Run: node test/marks.check.ts
import { bestBox, needsSam } from "../src/marks.ts";

let fails = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (${JSON.stringify(detail)})`}`); if (!ok) fails++; };

const box = (x_min: number, y_min: number, x_max: number, y_max: number) => ({ x_min, y_min, x_max, y_max });
const ink = box(100, 100, 300, 200);
const a = box(250, 150, 600, 400); // overlaps a corner
const b = box(110, 110, 290, 190); // what was circled
const far = box(700, 700, 800, 800);
check("the box overlapping the ink most wins", bestBox([a, b], ink) === b);
check("no overlap: none", bestBox([far], ink) === null);
check("no boxes: none", bestBox([], ink) === null);
// SAM finds "2,607" as one box per digit: the digits inside the ink are joined into the thing that was circled.
const digits = [box(150, 130, 160, 170), box(165, 130, 175, 170), box(180, 130, 190, 170), box(700, 130, 710, 170)];
check("pieces inside the ink are joined into one", JSON.stringify(bestBox(digits, ink)) === JSON.stringify(box(150, 130, 190, 170)), bestBox(digits, ink));
check("a mark around a chart (canvas) needs SAM", needsSam({ kind: "mark", before: "1.png", targets: [{ tag: "canvas" }] }));
check("a mark with nothing under it needs SAM", needsSam({ kind: "mark", before: "1.png", targets: [] }));
check("a mark around text doesn't", !needsSam({ kind: "mark", before: "1.png", targets: [{ tag: "span", text: "Views 2,607" }] }));
check("one already placed doesn't", !needsSam({ kind: "mark", before: "1.png", targets: [], samBox: b }));

console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
