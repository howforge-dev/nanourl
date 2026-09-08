// Our own SVG of a QR module matrix: the module and eye styles, the gradient,
// the centre plate with the logo or a label, and the caption under the code.
//
// node-qrcode supplies only the matrix. Its own SVG renderer draws one shape
// per module and nothing else, and a styling library would be a second
// renderer to keep in step with this one; drawing from the matrix here is
// what lets the styles, the plate and the text all be options of one
// document that the PNG export rasterises as it is.
//
// Units are modules throughout: the viewBox is `size + 2 * margin` wide, and
// the caption adds rows under it. `scale` only sets `width`/`height` on the
// document, so an `<img>` of it has an intrinsic size to rasterise at.
import { LOGO_RECTS, LOGO_VIEWBOX } from '../ui/logo';
import { PLATE_SHARE_MAX, type EyeStyle, type RenderOptions } from './options';

/** What `QRCode.create(...).modules` is: a square matrix read by row and
 *  column, `get` truthy for a dark module. */
export interface Matrix {
  size: number;
  get(row: number, col: number): number | boolean;
}

/** A matrix from rows of `#` (dark) and anything else (light) — for tests. */
export function matrixFrom(rows: readonly string[]): Matrix {
  const size = rows.length;
  return { size, get: (r, c) => rows[r]?.[c] === '#' };
}

/** The width of each finder pattern, and the three corners they sit in. */
const EYE = 7;
const eyeOrigins = (size: number): [number, number][] => [
  [0, 0],
  [0, size - EYE],
  [size - EYE, 0],
];

const inEye = (size: number, r: number, c: number): boolean =>
  eyeOrigins(size).some(([er, ec]) => r >= er && r < er + EYE && c >= ec && c < ec + EYE);

/** The symbol version for a module count: 21 is version 1, 4 more per step. */
const versionOf = (size: number): number => (size - 17) / 4;

/**
 * The row/column coordinates alignment-pattern centres sit on (ISO/IEC 18004
 * Annex E), by the derivation node-qrcode uses: evenly spaced between 6 and
 * `size - 7`, on an even interval, with version 32's one irregular spacing.
 * Version 1 has none.
 */
export function alignmentCoords(size: number): number[] {
  const version = versionOf(size);
  if (version < 2) return [];
  const count = Math.floor(version / 7) + 2;
  const interval = size === 145 ? 26 : Math.ceil((size - 13) / (2 * count - 2)) * 2;
  const coords = [size - 7];
  for (let i = 1; i < count - 1; i++) coords.push(coords[i - 1] - interval);
  coords.push(6);
  return coords.reverse();
}

/** The centres of the alignment patterns: every pair of coordinates except
 *  the three that would sit on a finder. */
export function alignmentCentres(size: number): [number, number][] {
  const coords = alignmentCoords(size);
  const last = size - 7;
  const out: [number, number][] = [];
  for (const r of coords) {
    for (const c of coords) {
      if ((r === 6 && c === 6) || (r === 6 && c === last) || (r === last && c === 6)) continue;
      out.push([r, c]);
    }
  }
  return out;
}

const ALIGN = 5;
const inAlignment = (size: number, r: number, c: number): boolean =>
  alignmentCentres(size).some(([ar, ac]) => Math.abs(r - ar) <= 2 && Math.abs(c - ac) <= 2);

/** The timing patterns: row 6 and column 6 between the finders, dark on
 *  the even indices. */
const TIMING = 6;
const timingRange = (size: number): [number, number] => [EYE + 1, size - EYE - 2];
const inTiming = (size: number, r: number, c: number): boolean => {
  const [lo, hi] = timingRange(size);
  return (r === TIMING && c >= lo && c <= hi) || (c === TIMING && r >= lo && r <= hi);
};

/** A finder, alignment or timing pattern: drawn as shapes, never in the
 *  module style, because a scanner reads them as contiguous runs. */
const isFunctionPattern = (size: number, r: number, c: number): boolean =>
  inEye(size, r, c) || inAlignment(size, r, c) || inTiming(size, r, c);

/** The dark timing modules as plain squares. */
export function timingPath(size: number, margin: number): string {
  const [lo, hi] = timingRange(size);
  const parts: string[] = [];
  for (let i = lo; i <= hi; i += 2) {
    parts.push(`M${n(i + margin)} ${n(TIMING + margin)}h1v1h-1z`, `M${n(TIMING + margin)} ${n(i + margin)}h1v1h-1z`);
  }
  return parts.join('');
}

/** Text as SVG character data or an attribute value. */
export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
}

const n = (v: number): string => String(Math.round(v * 1000) / 1000);

/**
 * The plate on the symbol's centre for what the options put there, in
 * modules: `null` when the label would need more than `PLATE_SHARE_MAX` of
 * the symbol, which is the caller's cue to show an error instead.
 *
 * The logo's plate is square, an odd number of modules so it sits on the
 * symbol's centre module. A label's plate is as wide as its text at a size
 * that follows the module count, and grows with the label.
 */
export function plateBox(
  size: number,
  plate: RenderOptions['plate'],
): { x: number; y: number; w: number; h: number; fontSize: number } | null {
  if (!plate) return null;
  const cap = Math.sqrt(PLATE_SHARE_MAX) * size;
  if (plate.kind === 'logo') {
    let side = Math.floor(cap);
    if (side % 2 === 0) side -= 1;
    side = Math.max(3, side);
    const o = (size - side) / 2;
    return { x: o, y: o, w: side, h: side, fontSize: 0 };
  }
  const fontSize = Math.max(1.8, size / 14);
  const w = plate.text.length * fontSize * 0.62 + 1;
  const h = fontSize * 1.3 + 0.6;
  if (w * h > PLATE_SHARE_MAX * size * size) return null;
  return { x: (size - w) / 2, y: (size - h) / 2, w, h, fontSize };
}

/** A caption wrapped to `width` modules at `fontSize`: greedy by word, with
 *  a word longer than a line broken where it runs out. */
export function wrapCaption(text: string, width: number, fontSize: number): string[] {
  const perLine = Math.max(1, Math.floor(width / (fontSize * 0.55)));
  const lines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (w.length > perLine) {
        if (line) {
          lines.push(line);
          line = '';
        }
        lines.push(w.slice(0, perLine));
        w = w.slice(perLine);
      }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= perLine) line += ' ' + w;
      else {
        lines.push(line);
        line = w;
      }
    }
    lines.push(line);
  }
  return lines.filter((l, i, all) => l !== '' || (i > 0 && i < all.length - 1));
}

/** One module as a square with the corners that face no dark neighbour
 *  rounded off, so a run of modules reads as one pill. */
function roundedCell(x: number, y: number, tl: boolean, tr: boolean, br: boolean, bl: boolean): string {
  const r = 0.5;
  let d = `M${n(x + (tl ? r : 0))} ${n(y)}`;
  d += `H${n(x + 1 - (tr ? r : 0))}`;
  if (tr) d += `A${r} ${r} 0 0 1 ${n(x + 1)} ${n(y + r)}`;
  d += `V${n(y + 1 - (br ? r : 0))}`;
  if (br) d += `A${r} ${r} 0 0 1 ${n(x + 1 - r)} ${n(y + 1)}`;
  d += `H${n(x + (bl ? r : 0))}`;
  if (bl) d += `A${r} ${r} 0 0 1 ${n(x)} ${n(y + 1 - r)}`;
  d += `V${n(y + (tl ? r : 0))}`;
  if (tl) d += `A${r} ${r} 0 0 1 ${n(x + r)} ${n(y)}`;
  return d + 'Z';
}

/** A circle as path data, so every style is one `<path>`. */
function circle(cx: number, cy: number, r: number): string {
  return `M${n(cx - r)} ${n(cy)}a${r} ${r} 0 1 0 ${n(2 * r)} 0a${r} ${r} 0 1 0 ${n(-2 * r)} 0Z`;
}

/** The data modules — everything outside the finder and alignment patterns
 *  — as one path. */
export function modulesPath(m: Matrix, style: RenderOptions['style'], margin: number): string {
  const size = m.size;
  const dark = (r: number, c: number): boolean => r >= 0 && c >= 0 && r < size && c < size && !!m.get(r, c);
  const parts: string[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!dark(r, c) || isFunctionPattern(size, r, c)) continue;
      const x = c + margin;
      const y = r + margin;
      switch (style) {
        case 'classic':
          parts.push(`M${n(x)} ${n(y)}h1v1h-1z`);
          break;
        case 'rounded': {
          const up = dark(r - 1, c);
          const down = dark(r + 1, c);
          const left = dark(r, c - 1);
          const right = dark(r, c + 1);
          parts.push(roundedCell(x, y, !up && !left, !up && !right, !down && !right, !down && !left));
          break;
        }
        case 'dots':
        case 'nanourl':
          parts.push(circle(x + 0.5, y + 0.5, 0.4));
          break;
      }
    }
  }
  return parts.join('');
}

/** One concentric pattern — a ring `outer` wide with a hole two narrower,
 *  and a centre two narrower again — at its top-left corner, in the eye
 *  style. The finders are 7 wide, the alignment patterns 5. Painted with
 *  the even-odd rule, so the hole is the second boundary inside the first
 *  and needs no winding of its own. */
function concentric(x: number, y: number, outer: number, eyes: EyeStyle): string[] {
  const hole = outer - 2;
  const core = outer - 4;
  switch (eyes) {
    case 'classic':
      return [
        `M${n(x)} ${n(y)}h${outer}v${outer}h-${outer}z`,
        `M${n(x + 1)} ${n(y + 1)}v${hole}h${hole}v-${hole}z`,
        `M${n(x + 2)} ${n(y + 2)}h${core}v${core}h-${core}z`,
      ];
    case 'rounded':
      return [
        roundedCorners(x, y, outer, outer, outer * 0.29),
        roundedCorners(x + 1, y + 1, hole, hole, hole * 0.24),
        roundedCorners(x + 2, y + 2, core, core, core * 0.3),
      ];
    case 'circle': {
      const cx = x + outer / 2;
      const cy = y + outer / 2;
      return [circle(cx, cy, outer / 2), circle(cx, cy, hole / 2), circle(cx, cy, core / 2)];
    }
  }
}

/** The three finder patterns and every alignment pattern, drawn as shapes
 *  rather than modules so they can be rounded or circular without changing
 *  where they are, followed by the timing patterns as squares. */
export function eyesPath(size: number, eyes: EyeStyle, margin: number): string {
  const parts: string[] = [];
  for (const [er, ec] of eyeOrigins(size)) parts.push(...concentric(ec + margin, er + margin, EYE, eyes));
  for (const [ar, ac] of alignmentCentres(size)) parts.push(...concentric(ac - 2 + margin, ar - 2 + margin, ALIGN, eyes));
  parts.push(timingPath(size, margin));
  return parts.join('');
}

/** A rectangle with all four corners rounded by `r`, clockwise. */
function roundedCorners(x: number, y: number, w: number, h: number, r: number): string {
  return (
    `M${n(x + r)} ${n(y)}H${n(x + w - r)}A${r} ${r} 0 0 1 ${n(x + w)} ${n(y + r)}` +
    `V${n(y + h - r)}A${r} ${r} 0 0 1 ${n(x + w - r)} ${n(y + h)}H${n(x + r)}` +
    `A${r} ${r} 0 0 1 ${n(x)} ${n(y + h - r)}V${n(y + r)}A${r} ${r} 0 0 1 ${n(x + r)} ${n(y)}Z`
  );
}

/** The site's mark as a `<symbol>`, from the same rects the favicon is. */
function logoSymbol(id: string): string {
  const rects = LOGO_RECTS.map(
    (r) =>
      '<rect ' +
      Object.entries(r)
        .map(([k, v]) => `${k}="${String(v)}"`)
        .join(' ') +
      '/>',
  ).join('');
  return `<symbol id="${id}" viewBox="${LOGO_VIEWBOX}">${rects}</symbol>`;
}

export interface Rendered {
  svg: string;
  /** The document's size in modules, caption included. */
  width: number;
  height: number;
  /** Set when a centre label would cover more of the symbol than it can
   *  survive; the symbol is then drawn without it. */
  error: string | null;
}

/**
 * The SVG document. Deterministic for a matrix and its options: the same
 * input is the same string, byte for byte, which the tests hold it to.
 */
export function renderSvg(m: Matrix, o: RenderOptions, idPrefix = 'qr'): Rendered {
  const size = m.size;
  const margin = Math.max(0, o.margin);
  const W = size + 2 * margin;
  const fill = o.gradient ? `url(#${idPrefix}-grad)` : o.dark;

  const captionSize = size / 14;
  const lines = o.caption ? wrapCaption(o.caption, size, captionSize) : [];
  const lineHeight = captionSize * 1.25;
  const captionGap = lines.length ? captionSize * 0.5 : 0;
  const H = W + (lines.length ? captionGap + lines.length * lineHeight + Math.max(margin, 1) : 0);

  let plate = plateBox(size, o.plate);
  let error: string | null = null;
  if (o.plate && !plate) {
    error = `the centre label needs more than ${Math.round(PLATE_SHARE_MAX * 100)}% of the symbol — shorten it, or force a larger version`;
    plate = null;
  }

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(W)} ${n(H)}"` +
      (o.scale ? ` width="${n(W * o.scale)}" height="${n(H * o.scale)}"` : '') +
      ` shape-rendering="${o.style === 'classic' && o.eyes === 'classic' ? 'crispEdges' : 'geometricPrecision'}">`,
  );
  const defs: string[] = [];
  if (o.gradient) {
    defs.push(
      `<linearGradient id="${idPrefix}-grad" gradientUnits="userSpaceOnUse" x1="0" y1="${n(margin)}" x2="0" y2="${n(margin + size)}">` +
        `<stop offset="0" stop-color="${o.gradient[0]}"/><stop offset="1" stop-color="${o.gradient[1]}"/></linearGradient>`,
    );
  }
  if (plate && o.plate?.kind === 'logo') defs.push(logoSymbol(`${idPrefix}-logo`));
  if (defs.length) parts.push(`<defs>${defs.join('')}</defs>`);
  if (o.light) parts.push(`<rect width="${n(W)}" height="${n(H)}" fill="${o.light}"/>`);
  parts.push(`<path class="modules" fill="${fill}" d="${modulesPath(m, o.style, margin)}"/>`);
  parts.push(`<path class="eyes" fill="${fill}" fill-rule="evenodd" d="${eyesPath(size, o.eyes, margin)}"/>`);
  if (plate && o.plate) {
    const px = plate.x + margin;
    const py = plate.y + margin;
    const rx = Math.min(plate.w, plate.h) * 0.22;
    parts.push(`<rect class="plate" x="${n(px)}" y="${n(py)}" width="${n(plate.w)}" height="${n(plate.h)}" rx="${n(rx)}" fill="${o.plateFill}"/>`);
    if (o.plate.kind === 'logo') {
      const pad = 0.5;
      parts.push(
        `<use href="#${idPrefix}-logo" x="${n(px + pad)}" y="${n(py + pad)}" width="${n(plate.w - 2 * pad)}" height="${n(plate.h - 2 * pad)}"/>`,
      );
    } else {
      parts.push(
        `<text class="label" x="${n(px + plate.w / 2)}" y="${n(py + plate.h / 2)}" font-family="${escapeXml(o.font)}" font-size="${n(plate.fontSize)}"` +
          ` font-weight="600" text-anchor="middle" dominant-baseline="central" fill="${o.dark}">${escapeXml(o.plate.text)}</text>`,
      );
    }
  }
  if (lines.length) {
    const x = W / 2;
    let y = W + captionGap + captionSize;
    for (const line of lines) {
      parts.push(
        `<text class="caption" x="${n(x)}" y="${n(y)}" font-family="${escapeXml(o.font)}" font-size="${n(captionSize)}" text-anchor="middle" fill="${o.dark}">${escapeXml(line)}</text>`,
      );
      y += lineHeight;
    }
  }
  parts.push('</svg>');
  return { svg: parts.join(''), width: Number(n(W)), height: Number(n(H)), error };
}
