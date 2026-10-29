# Remuse — Logo Guidelines

## 1. The logo
- **Idea:** the agent's orb holds its own echo — a solid core and the crescent it leaves when it does the task again ("Show it once. Remuse does it again.").
- **Parts:** symbol (`symbol/remuse-symbol.svg`) · wordmark "remuse", lowercase, soft geometric (`wordmark/remuse-wordmark.svg`) · horizontal lockup (`lockup/remuse-horizontal.svg`) · stacked lockup (`lockup/remuse-stacked.svg`).
- **Small-size cuts** (heavier ring, wider crescent; heavier wordmark): `symbol/remuse-symbol-small.svg`, `wordmark/remuse-wordmark-small.svg`, `lockup/remuse-horizontal-small.svg`. Use them at **24 px tall and below** (symbol: 32 px and below).
- The wordmark is custom-drawn outlines. Never retype it in a font.

## 2. Clear space
Keep a clear zone of **½ × the symbol diameter (D)** on all sides of any lockup, and ¼ D around the symbol alone. The space scales with the logo.
Inside the horizontal lockup: symbol diameter = 1.8 × x-height, centred on the x-height band; gap = 0.5 D (so the mark leads and the name reads as a separate word; regenerate with `node scripts/brand-lockups.mjs`). In the stacked lockup: D = 2.1 × x-height, gap = 0.55 × x-height. Don't change these.

## 3. Minimum sizes
| Version | Screen | Print |
|---|---|---|
| Horizontal lockup | 20 px tall (small cut below 24 px) | 6 mm tall |
| Stacked lockup | 48 px tall | 15 mm tall |
| Symbol | 16 px (small cut at 32 px and below) | 4 mm |

## 4. Colour
| Name | HEX | RGB | Use |
|---|---|---|---|
| Ink | `#0B0B0D` | 11, 11, 13 | Primary background (product UI); logo on light |
| White | `#FFFFFF` | 255, 255, 255 | Logo on Ink (primary pairing) |
| Orb Blue | `#6E9BFF` | 110, 155, 255 | Gradient start |
| Orb Violet | `#9A7BFF` | 154, 123, 255 | Gradient end |
| Orb Mid (brand mono) | `#848BFF` | 132, 139, 255 | One-colour brand version, on dark |

- **One colour is the master.** White on Ink is the primary pairing; Ink on white/light is the second.
- **Gradient accent (approved):** only the symbol takes the Orb Blue → Orb Violet gradient (top-left to bottom-right); the wordmark stays one colour (`colour/*-gradient-on-dark.svg`, `*-gradient-on-light.svg`). Use it on dark grounds, app icons, the extension icon and hero moments. Not for print and not below 16 px outside the extension icon.
- **Contrast:** White on Ink 19.7:1 · Orb Mid on Ink 6.7:1 · Orb Mid on white only 3.0:1, so use the brand mono on dark grounds or at large sizes only.
- CMYK and Pantone have not been specified yet; proof before any print run.

## 5. Approved backgrounds
- White logo on Ink `#0B0B0D` or any dark UI surface (glass panels included).
- Ink logo on white or light neutral greys.
- Gradient symbol + white wordmark on Ink; gradient symbol + Ink wordmark on white.
- On photos: white or Ink version over a calm area only. Otherwise put the symbol on the rounded Ink tile (`app-icon/remuse-app-icon.svg`).

## 6. Files at a glance
- **Product UI:** `ui/mark.svg` (symbol, `currentColor`, tight) · `ui/mark-small.svg` (small cut, ≤ 32 px) · `ui/lockup-dark.svg` (white small-cut lockup for 20–24 px headers).
- **Chrome extension:** `extension/icon-16.png`, `-32`, `-48`, `-128`.
- **Web:** `web/favicon.ico`, `web/favicon.svg`, `web/head-snippet.html`, `web/site.webmanifest`, icon PNGs.
- **App icon:** `app-icon/remuse-app-icon(-gradient)-512/1024.png`.

## 7. Don'ts
Don't stretch, squash or rotate the logo. Don't recolour it outside the palette, and don't apply the gradient to the wordmark. Don't add glows, shadows, outlines or blur; the glowing orb belongs to the UI, not the logo. Don't rearrange or resize the parts of a lockup. Don't use the master cuts below 24 px (use the small cuts). Don't place the logo on busy backgrounds without the tile. Don't retype "remuse" in a font.

## 8. Notes
- No trademark search has been done. Run one (trademark databases plus a reverse image search) before launch.
- The wordmark is custom geometry, so no font licence is needed for the logo. Geist is the UI typeface.
