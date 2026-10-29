// Rebuild the horizontal Remuse lockups from the symbol and the wordmark with designer proportions:
// the symbol is 1.8x the wordmark's x-height (so the mark leads and the word reads as a separate name),
// the gap is half the symbol's diameter, and the word's x-height band is centred on the symbol.
// Each file keeps its own colours. Run: node scripts/brand-lockups.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const B = join(import.meta.dirname, "..", "brand");
const RATIO = 1.8; // symbol diameter / x-height
const GAP = 0.5; // gap / symbol diameter
const PAD = 1 / 8; // padding around kit files, in symbol diameters (UI drop-ins get none)

const paths = (svg) => [...svg.matchAll(/<path[^>]*?\sd="([^"]+)"/g)].map((m) => m[1]);
const fills = (svg) => [...svg.matchAll(/<path[^>]*?fill="([^"]+)"/g)].map((m) => m[1]);
const symbol = {
  master: { d: paths(readFileSync(join(B, "symbol/remuse-symbol.svg"), "utf8"))[0], cx: 128, cy: 126, r: 106 },
  small: { d: paths(readFileSync(join(B, "symbol/remuse-symbol-small.svg"), "utf8"))[0], cx: 128, cy: 128, r: 116 },
};
const wordmark = (file) => {
  const svg = readFileSync(join(B, file), "utf8");
  const vb = /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/.exec(svg).slice(1).map(Number);
  return { ds: paths(svg), width: vb[2], top: vb[1], bottom: vb[1] + vb[3] };
};
const words = { master: wordmark("wordmark/remuse-wordmark.svg"), small: wordmark("wordmark/remuse-wordmark-small.svg") };

function lockup(cut, { symbolFill, wordFill, gradient, title, pad }) {
  const s = symbol[cut], w = words[cut];
  const D = RATIO * 100; // wordmark x-height is 100 units (baseline 0, x-height -100)
  const k = D / (2 * s.r);
  const cx = -GAP * D - D / 2, cy = -50;
  const p = pad ? PAD * D : 0;
  const x0 = cx - D / 2 - p, x1 = w.width + p;
  const y0 = Math.min(cy - D / 2, w.top) - p, y1 = Math.max(cy + D / 2, w.bottom) + p;
  const f = (n) => +n.toFixed(2);
  const defs = gradient
    ? `<defs><linearGradient id="orb" gradientUnits="userSpaceOnUse" x1="${f(cx - D / 2)}" y1="${f(cy - D / 2)}" x2="${f(cx + D / 2)}" y2="${f(cy + D / 2)}"><stop offset="0" stop-color="#6E9BFF"/><stop offset="1" stop-color="#9A7BFF"/></linearGradient></defs>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(x0)} ${f(y0)} ${f(x1 - x0)} ${f(y1 - y0)}" width="${f(x1 - x0)}" height="${f(y1 - y0)}" role="img" aria-labelledby="title"><title id="title">${title}</title>${defs}`
    + `<path fill="${gradient ? "url(#orb)" : symbolFill}" fill-rule="evenodd" transform="translate(${f(cx - s.cx * k)} ${f(cy - s.cy * k)}) scale(${f(k * 1e4) / 1e4})" d="${s.d}"/>`
    + w.ds.map((d) => `<path fill="${wordFill}" fill-rule="evenodd" d="${d}"/>`).join("")
    + `</svg>\n`;
}

// Kit files: keep each one's colours, rebuild the geometry.
const kit = [
  ["lockup/remuse-horizontal.svg", "master"], ["lockup/remuse-horizontal-black.svg", "master"], ["lockup/remuse-horizontal-white.svg", "master"],
  ["lockup/remuse-horizontal-mono-848bff.svg", "master"], ["lockup/remuse-horizontal-small.svg", "small"],
  ["colour/remuse-horizontal-gradient-on-dark.svg", "master"], ["colour/remuse-horizontal-gradient-on-light.svg", "master"],
  ["colour/remuse-horizontal-small-gradient-on-dark.svg", "small"], ["colour/remuse-horizontal-small-gradient-on-light.svg", "small"],
];
for (const [file, cut] of kit) {
  const old = readFileSync(join(B, file), "utf8");
  const [symbolFill, wordFill] = fills(old);
  const title = /<title[^>]*>([^<]*)<\/title>/.exec(old)?.[1] ?? "Remuse logo";
  writeFileSync(join(B, file), lockup(cut, { symbolFill, wordFill, gradient: symbolFill.startsWith("url("), title, pad: true }));
  console.log("rebuilt", file);
}
// UI drop-in: white, small cut, tight; the app swaps white for currentColor.
writeFileSync(join(B, "ui/lockup-dark.svg"), lockup("small", { symbolFill: "#FFFFFF", wordFill: "#FFFFFF", title: "Remuse", pad: false }));
console.log("rebuilt ui/lockup-dark.svg");
