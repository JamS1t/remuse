// Marks drawn on charts and canvases (Google Sheets, analytics graphs) have no page element inside the ink to say
// what they are. Muse Spark names what was circled from the inked picture, and SAM 3.1 finds that thing on the page;
// the box that best matches the ink is kept on the mark, so learning knows exactly what was meant.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { askJson, png, sam, text, type Box } from "./meta.ts";

const area = (b: Box) => Math.max(0, b.x_max - b.x_min) * Math.max(0, b.y_max - b.y_min);

/** What the ink went around: SAM's boxes centred inside it, joined into one (it finds "2,607" digit by digit); else
 *  the box most like the ink (overlap over union); none if nothing overlaps it. */
export function bestBox(boxes: Box[], ink: Box): Box | null {
  const inside = boxes.filter((b) => { const x = (b.x_min + b.x_max) / 2, y = (b.y_min + b.y_max) / 2; return x >= ink.x_min && x <= ink.x_max && y >= ink.y_min && y <= ink.y_max; });
  if (inside.length) return inside.length === 1 ? inside[0] : { x_min: Math.min(...inside.map((b) => b.x_min)), y_min: Math.min(...inside.map((b) => b.y_min)), x_max: Math.max(...inside.map((b) => b.x_max)), y_max: Math.max(...inside.map((b) => b.y_max)) };
  let best: Box | null = null, score = 0;
  for (const b of boxes) {
    const over = area({ x_min: Math.max(b.x_min, ink.x_min), y_min: Math.max(b.y_min, ink.y_min), x_max: Math.min(b.x_max, ink.x_max), y_max: Math.min(b.y_max, ink.y_max) });
    const s = over / (area(b) + area(ink) - over || 1);
    if (s > score) { score = s; best = b; }
  }
  return best;
}

/** A mark on a canvas or a chart, or on nothing the page can name, that SAM hasn't placed yet. */
// Nothing inside the ink has words: a canvas, or an SVG chart's bars and lines (rect, path, g).
export const needsSam = (e: any) => e.kind === "mark" && !!e.before && !e.samBox && !((e.targets ?? []) as any[]).some((t) => String(t.label ?? "").trim() || String(t.text ?? "").trim());

export async function resolveMarks(events: any[], dir: string, save: (eventId: number, data: object) => void): Promise<void> {
  for (const e of events.filter(needsSam)) {
    try {
      const frame = readFileSync(join(dir, e.before));
      const r = await askJson<{ phrase?: string; kind?: string }>([text(`The person circled or underlined something on this screenshot of a web page; the red ink shows where. What did they mark? Reply with ONLY JSON: {"phrase": "<a 2-4 word noun phrase for that thing, e.g. \\"views chart\\", \\"subscriber count\\">", "kind": "<one plain word for what it looks like: number, chart, bar, line, button, icon, image, table, row, word>"}`), png(frame)], "mark-phrase");
      // SAM finds things by how they look: the specific name first, then the plain kind ("number", "chart").
      for (const phrase of [r?.phrase, r?.kind].map((x) => String(x ?? "").trim()).filter(Boolean)) {
        const box = bestBox(await sam(frame, phrase), e.grid);
        if (box) { save(e.id, { samPhrase: phrase, samBox: box }); break; }
      }
    } catch { /* a mark SAM can't place is still a mark: learning sees the ink */ }
  }
}
