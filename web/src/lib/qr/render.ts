// Our own SVG of a QR module matrix: the module and corner styles, solid or
// gradient paints, the background and its shape, the centre plate with the
// logo, an uploaded image or a label, and the caption under the code.
//
// node-qrcode supplies only the matrix. Its own SVG renderer draws one shape
// per module and nothing else, and a styling library would be a second
// renderer to keep in step with this one; drawing from the matrix here is
// what lets the styles, the plate and the text all be options of one
// document that the raster exports rasterise as it is.
//
// Units are modules throughout: the viewBox is `size + 2 * (margin +
// padding)` wide — the quiet zone, then the frame padding — and the caption
// adds rows under it. `scale` only sets `width`/`height` on the document,
// so an `<img>` of it has an intrinsic size to rasterise at.
import { LOGO_RECTS, LOGO_VIEWBOX } from '../ui/logo';
import { PLATE_SHARE_MAX, type CornerType, type ModuleStyle, type Paint, type RenderOptions } from './options';

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

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The plate on the symbol's centre for what the options put there, in
 * modules: `null` when a label would need more than `PLATE_SHARE_MAX` of
 * the symbol, which is the caller's cue to show an error instead.
 *
 * The logo's plate is square, an odd number of modules so it sits on the
 * symbol's centre module. An image's plate is `imageSize` of the symbol's
 * side (already clamped by the level), plus its margin. A label's plate is
 * as wide as its text at a size that follows the module count.
 */
export function plateBox(size: number, plate: RenderOptions['plate'], imageSize = 0, imageMargin = 0): (Box & { fontSize: number }) | null {
  if (!plate) return null;
  if (plate.kind === 'label') {
    const fontSize = Math.max(1.8, size / 14);
    const w = plate.text.length * fontSize * 0.62 + 1;
    const h = fontSize * 1.3 + 0.6;
    if (w * h > PLATE_SHARE_MAX * size * size) return null;
    return { x: (size - w) / 2, y: (size - h) / 2, w, h, fontSize };
  }
  let side: number;
  if (plate.kind === 'logo') {
    side = Math.floor(Math.sqrt(PLATE_SHARE_MAX) * size);
    if (side % 2 === 0) side -= 1;
    side = Math.max(3, side);
  } else {
    side = Math.max(1, imageSize * size + 2 * imageMargin);
  }
  const o = (size - side) / 2;
  return { x: o, y: o, w: side, h: side, fontSize: 0 };
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

/** Radii for the four corners, clockwise from the top-left. */
type Radii = [number, number, number, number];

/** A `w`×`h` rectangle at (x, y) with each corner rounded by its radius
 *  (0 leaves it square), clockwise. */
export function roundedRect(x: number, y: number, w: number, h: number, [tl, tr, br, bl]: Radii): string {
  const arc = (r: number, ex: number, ey: number): string => (r > 0 ? `A${n(r)} ${n(r)} 0 0 1 ${n(ex)} ${n(ey)}` : '');
  return (
    `M${n(x + tl)} ${n(y)}H${n(x + w - tr)}${arc(tr, x + w, y + tr)}` +
    `V${n(y + h - br)}${arc(br, x + w - br, y + h)}H${n(x + bl)}${arc(bl, x, y + h - bl)}` +
    `V${n(y + tl)}${arc(tl, x + tl, y)}Z`
  );
}

/** A circle as path data, so every style is one `<path>`. */
export function circle(cx: number, cy: number, r: number): string {
  return `M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;
}

/** The radius of a dot module: 0.8 of the module across. */
export const DOT_R = 0.4;
/** The radius of a dot in a `dots` corner: touching, so the finder still
 *  reads as the runs a scanner looks for. */
export const CORNER_DOT_R = 0.5;

/**
 * One data module in a style, given which of its neighbours are dark. The
 * run-aware styles round only the corners that face no dark neighbour, so a
 * run of modules reads as one shape — softened at 0.3, a full pill at 0.5.
 * `classy` rounds one corner fully, the top-left on even parity and the
 * bottom-right on odd, so neighbours alternate and a run reads as woven;
 * `classy-rounded` softens the other two like `rounded`.
 */
export function moduleShape(
  style: ModuleStyle,
  x: number,
  y: number,
  parity: number,
  free: { tl: boolean; tr: boolean; br: boolean; bl: boolean },
): string {
  switch (style) {
    case 'classic':
      return `M${n(x)} ${n(y)}h1v1h-1z`;
    case 'rounded':
    case 'extra-rounded': {
      const r = style === 'rounded' ? 0.3 : 0.5;
      return roundedRect(x, y, 1, 1, [free.tl ? r : 0, free.tr ? r : 0, free.br ? r : 0, free.bl ? r : 0]);
    }
    case 'classy':
    case 'classy-rounded': {
      // the parity corner full, its opposite square, the other two softened
      // when free (classy-rounded) or square (classy)
      const even = parity % 2 === 0;
      const soft = style === 'classy-rounded' ? 0.3 : 0;
      return roundedRect(x, y, 1, 1, [even ? 0.5 : 0, free.tr ? soft : 0, even ? 0 : 0.5, free.bl ? soft : 0]);
    }
    case 'dots':
    case 'nanourl':
      return circle(x + 0.5, y + 0.5, DOT_R);
  }
}

/** The data modules — everything outside the function patterns, and
 *  outside `hole` when given — as one path. */
export function modulesPath(m: Matrix, style: ModuleStyle, margin: number, hole: Box | null = null): string {
  const size = m.size;
  const dark = (r: number, c: number): boolean => r >= 0 && c >= 0 && r < size && c < size && !!m.get(r, c);
  const hidden = (r: number, c: number): boolean =>
    !!hole && c + 1 > hole.x && c < hole.x + hole.w && r + 1 > hole.y && r < hole.y + hole.h;
  const parts: string[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!dark(r, c) || isFunctionPattern(size, r, c) || hidden(r, c)) continue;
      const up = dark(r - 1, c);
      const down = dark(r + 1, c);
      const left = dark(r, c - 1);
      const right = dark(r, c + 1);
      parts.push(
        moduleShape(style, c + margin, r + margin, r + c, {
          tl: !up && !left,
          tr: !up && !right,
          br: !down && !right,
          bl: !down && !left,
        }),
      );
    }
  }
  return parts.join('');
}

/**
 * One `w`×`w` block of a finder — the outer boundary, the hole, or the
 * centre — in a corner type. `dots` draws the block's modules as touching
 * dots (the ring's 24, the centre's 9) and so has no hole of its own; for
 * the ring, `finder` lays them over a thin bar (see `ringBar`), since a
 * scanner reads a finder as runs and a row of separate dots is not one.
 */
export function cornerShape(type: CornerType, x: number, y: number, w: number, ring = false): string {
  switch (type) {
    case 'square':
      return `M${n(x)} ${n(y)}h${n(w)}v${n(w)}h-${n(w)}z`;
    case 'rounded':
      return roundedRect(x, y, w, w, [w * 0.2, w * 0.2, w * 0.2, w * 0.2]);
    case 'extra-rounded':
      return roundedRect(x, y, w, w, [w * 0.35, w * 0.35, w * 0.35, w * 0.35]);
    case 'dot':
      return circle(x + w / 2, y + w / 2, w / 2);
    case 'classy':
      return roundedRect(x, y, w, w, [w * 0.4, 0, w * 0.4, 0]);
    case 'classy-rounded':
      return roundedRect(x, y, w, w, [w * 0.45, w * 0.15, w * 0.45, w * 0.15]);
    case 'dots': {
      const parts: string[] = [];
      for (let r = 0; r < w; r++) {
        for (let c = 0; c < w; c++) {
          if (ring && r > 0 && r < w - 1 && c > 0 && c < w - 1) continue;
          parts.push(circle(x + c + 0.5, y + r + 0.5, CORNER_DOT_R));
        }
      }
      return parts.join('');
    }
  }
}

/** The bar under a `dots` ring: a 0.5-wide square ring on the dots'
 *  centre line, as an outer boundary and a hole for the even-odd rule. */
function ringBar(x: number, y: number): string {
  return `M${n(x + 0.25)} ${n(y + 0.25)}h6.5v6.5h-6.5z` + `M${n(x + 0.75)} ${n(y + 0.75)}v5.5h5.5v-5.5z`;
}

/** A finder's ring (7 wide with a 5 hole) and centre (3 wide) at its
 *  top-left corner, each in its own corner type. The ring is painted with
 *  the even-odd rule, so the hole is the second boundary inside the first
 *  and needs no winding of its own; a `dots` ring's beads go in a path of
 *  their own, over the bar, since under even-odd they would cut it. */
function finder(x: number, y: number, ringType: CornerType, coreType: CornerType): { ring: string; beads: string; core: string } {
  const ring = ringType === 'dots' ? ringBar(x, y) : cornerShape(ringType, x, y, EYE) + cornerShape(ringType, x + 1, y + 1, EYE - 2);
  const beads = ringType === 'dots' ? cornerShape('dots', x, y, EYE, true) : '';
  const core = cornerShape(coreType, x + 2, y + 2, EYE - 4);
  return { ring, beads, core };
}

/** An alignment pattern: a 5 ring with a 3 hole and a 1 centre, in the
 *  plain square shape a scanner reads as runs. */
function alignment(x: number, y: number): string {
  return `M${n(x)} ${n(y)}h5v5h-5z` + `M${n(x + 1)} ${n(y + 1)}v3h3v-3z` + `M${n(x + 2)} ${n(y + 2)}h1v1h-1z`;
}

/** The three finders' rings and, separately, their centres, drawn as
 *  shapes rather than modules so they can take any corner type without
 *  changing where they are, and painted apart so each can take its own
 *  paint. */
export function finderPaths(size: number, ringType: CornerType, coreType: CornerType, margin: number): { ring: string; beads: string; core: string } {
  const ring: string[] = [];
  const beads: string[] = [];
  const core: string[] = [];
  for (const [er, ec] of eyeOrigins(size)) {
    const f = finder(ec + margin, er + margin, ringType, coreType);
    ring.push(f.ring);
    beads.push(f.beads);
    core.push(f.core);
  }
  return { ring: ring.join(''), beads: beads.join(''), core: core.join('') };
}

/** Every alignment pattern, then the timing patterns — the function
 *  patterns that sit among the data, as plain squares in the dots' paint. */
export function alignmentPath(size: number, margin: number): string {
  const parts = alignmentCentres(size).map(([ar, ac]) => alignment(ac - 2 + margin, ar - 2 + margin));
  parts.push(timingPath(size, margin));
  return parts.join('');
}

/** Every function pattern as one path: the finders (square), the alignment
 *  patterns and the timing patterns. */
export function eyesPath(size: number, margin: number): string {
  const f = finderPaths(size, 'square', 'square', margin);
  return f.ring + f.core + alignmentPath(size, margin);
}

/** The line a linear gradient runs along, through the centre of `box` at
 *  `rotation` degrees clockwise from left-to-right, long enough to span
 *  the box whatever the angle. */
export function gradientLine(rotation: number, box: Box): [number, number, number, number] {
  const a = (rotation * Math.PI) / 180;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const half = (Math.abs(box.w * Math.cos(a)) + Math.abs(box.h * Math.sin(a))) / 2;
  const dx = Math.cos(a) * half;
  const dy = Math.sin(a) * half;
  return [cx - dx, cy - dy, cx + dx, cy + dy];
}

/** A paint as a fill: a colour, or a gradient definition over `box` in user
 *  space and a reference to it. */
export function paintFill(paint: Paint, id: string, box: Box): { def: string; fill: string } {
  const g = paint.gradient;
  if (!g) return { def: '', fill: paint.color };
  // SVG wants stops in offset order; the settings keep the order the person
  // made, so a copy is sorted here, stably, and nothing upstream moves
  const ordered = g.stops
    .map((st, i) => ({ st, i }))
    .sort((a, b) => a.st.offset - b.st.offset || a.i - b.i)
    .map((x) => x.st);
  const stops = ordered.map((st) => `<stop offset="${n(st.offset)}" stop-color="${st.color}"/>`).join('');
  if (g.type === 'radial') {
    const r = Math.hypot(box.w, box.h) / 2;
    return {
      def: `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${n(box.x + box.w / 2)}" cy="${n(box.y + box.h / 2)}" r="${n(r)}">${stops}</radialGradient>`,
      fill: `url(#${id})`,
    };
  }
  const [x1, y1, x2, y2] = gradientLine(g.rotation, box);
  return {
    def: `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}">${stops}</linearGradient>`,
    fill: `url(#${id})`,
  };
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

/** The extra padding a circle needs so the disc contains the symbol and its
 *  quiet zone: the square's half-diagonal less its half-side, rounded up. */
export function circlePadding(size: number, margin: number): number {
  const side = size + 2 * margin;
  return Math.ceil((side * Math.SQRT2 - side) / 2);
}

/** A deterministic 0..1 value per cell, so the circle shape's decorative
 *  ring is the same on every render of the same matrix. */
const hash01 = (r: number, c: number, seed: number): number => {
  let h = (r * 73856093) ^ (c * 19349663) ^ (seed * 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 0x1_0000_0000;
};

/** The decorative modules in the ring between the symbol's quiet zone and
 *  the disc's edge, in the module style: about half the cells, chosen by a
 *  hash of their position and the matrix. */
export function ringPath(m: Matrix, style: ModuleStyle, origin: number, margin: number, W: number): string {
  const size = m.size;
  const seed = darkSeed(m);
  const R = W / 2;
  const cx = W / 2;
  const inner = { lo: origin - margin, hi: origin + size + margin };
  const parts: string[] = [];
  for (let r = 0; r < W; r++) {
    for (let c = 0; c < W; c++) {
      if (r >= inner.lo && r < inner.hi && c >= inner.lo && c < inner.hi) continue;
      if (Math.hypot(c + 0.5 - cx, r + 0.5 - cx) > R - 0.5) continue;
      if (hash01(r, c, seed) < 0.5) continue;
      parts.push(moduleShape(style, c, r, r + c, { tl: true, tr: true, br: true, bl: true }));
    }
  }
  return parts.join('');
}

const darkSeed = (m: Matrix): number => {
  let k = 0;
  for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) if (m.get(r, c)) k = (k * 31 + r * m.size + c) | 0;
  return k;
};

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
  const padding = Math.max(o.padding, o.shape === 'circle' ? circlePadding(size, margin) : 0);
  // where the symbol's top-left module sits
  const origin = padding + margin;
  const W = size + 2 * origin;

  const captionSize = size / 14;
  const lines = o.caption ? wrapCaption(o.caption, size, captionSize) : [];
  const lineHeight = captionSize * 1.25;
  // a gap above and below the caption of its own making, so it clears the
  // quiet zone and the edge even at margin 0 and padding 0
  const captionGap = lines.length ? captionSize * 0.5 : 0;
  const H = W + (lines.length ? 2 * captionGap + lines.length * lineHeight : 0);

  const symbolBox: Box = { x: origin, y: origin, w: size, h: size };
  const pageBox: Box = { x: 0, y: 0, w: W, h: H };
  const dots = paintFill(o.dots, `${idPrefix}-dots`, symbolBox);
  const ringPaint = o.cornersSquare ? paintFill(o.cornersSquare, `${idPrefix}-ring`, symbolBox) : dots;
  const corePaint = o.cornersDot ? paintFill(o.cornersDot, `${idPrefix}-core`, symbolBox) : dots;
  const bg = o.background ? paintFill(o.background, `${idPrefix}-bg`, pageBox) : null;

  const imageMargin = o.imageMarginPx / Math.max(o.scale ?? o.pxPerModule, 0.001);
  let plate = plateBox(size, o.plate, o.imageSize, imageMargin);
  let error: string | null = null;
  if (o.plate && !plate) {
    error = `the centre label needs more than ${Math.round(PLATE_SHARE_MAX * 100)}% of the symbol: shorten it, or force a larger version`;
    plate = null;
  }
  const hole = plate && o.plate?.kind !== 'label' && o.hideBackgroundDots ? plate : null;

  const parts: string[] = [];
  const crisp = o.style === 'classic' && o.cornersSquareType === 'square' && o.cornersDotType === 'square' && o.shape === 'square';
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(W)} ${n(H)}"` +
      (o.scale ? ` width="${n(W * o.scale)}" height="${n(H * o.scale)}"` : '') +
      ` shape-rendering="${crisp ? 'crispEdges' : 'geometricPrecision'}">`,
  );
  // one definition per paint: inherited corners reuse the dots' paint, and
  // its definition, under the one id
  const defs = [...new Set([dots.def, ringPaint.def, corePaint.def, bg?.def ?? ''])].filter(Boolean);
  if (plate && o.plate?.kind === 'logo') defs.push(logoSymbol(`${idPrefix}-logo`));
  if (defs.length) parts.push(`<defs>${defs.join('')}</defs>`);
  if (bg) {
    if (o.shape === 'circle') {
      parts.push(`<circle class="background" cx="${n(W / 2)}" cy="${n(W / 2)}" r="${n(W / 2)}" fill="${bg.fill}"/>`);
      if (H > W) parts.push(`<rect class="background" x="0" y="${n(W / 2)}" width="${n(W)}" height="${n(H - W / 2)}" fill="${bg.fill}"/>`);
    } else {
      parts.push(`<rect class="background" width="${n(W)}" height="${n(H)}" rx="${n((o.backgroundRound * W) / 2)}" fill="${bg.fill}"/>`);
    }
  }
  if (o.shape === 'circle') parts.push(`<path class="ring" fill="${dots.fill}" d="${ringPath(m, o.style, origin, margin, W)}"/>`);
  parts.push(`<path class="modules" fill="${dots.fill}" d="${modulesPath(m, o.style, origin, hole)}"/>`);
  const finders = finderPaths(size, o.cornersSquareType, o.cornersDotType, origin);
  parts.push(`<path class="eyes ring" fill="${ringPaint.fill}" fill-rule="evenodd" d="${finders.ring}"/>`);
  if (finders.beads) parts.push(`<path class="eyes beads" fill="${ringPaint.fill}" d="${finders.beads}"/>`);
  parts.push(`<path class="eyes core" fill="${corePaint.fill}" d="${finders.core}"/>`);
  parts.push(`<path class="function" fill="${dots.fill}" fill-rule="evenodd" d="${alignmentPath(size, origin)}"/>`);
  if (plate && o.plate) {
    const px = plate.x + origin;
    const py = plate.y + origin;
    const rx = Math.min(plate.w, plate.h) * 0.22;
    if (o.plate.kind !== 'image' || o.hideBackgroundDots) {
      parts.push(`<rect class="plate" x="${n(px)}" y="${n(py)}" width="${n(plate.w)}" height="${n(plate.h)}" rx="${n(rx)}" fill="${o.plateFill}"/>`);
    }
    if (o.plate.kind === 'logo') {
      const pad = 0.5;
      parts.push(
        `<use href="#${idPrefix}-logo" x="${n(px + pad)}" y="${n(py + pad)}" width="${n(plate.w - 2 * pad)}" height="${n(plate.h - 2 * pad)}"/>`,
      );
    } else if (o.plate.kind === 'image') {
      const pad = imageMargin;
      parts.push(
        `<image href="${escapeXml(o.plate.href)}" x="${n(px + pad)}" y="${n(py + pad)}" width="${n(plate.w - 2 * pad)}" height="${n(plate.h - 2 * pad)}" preserveAspectRatio="xMidYMid meet"/>`,
      );
    } else {
      parts.push(
        `<text class="label" x="${n(px + plate.w / 2)}" y="${n(py + plate.h / 2)}" font-family="${escapeXml(o.font)}" font-size="${n(plate.fontSize)}"` +
          ` font-weight="600" text-anchor="middle" dominant-baseline="central" fill="${o.ink}">${escapeXml(o.plate.text)}</text>`,
      );
    }
  }
  if (lines.length) {
    const x = W / 2;
    let y = origin + size + margin + captionGap + captionSize;
    for (const line of lines) {
      parts.push(
        `<text class="caption" x="${n(x)}" y="${n(y)}" font-family="${escapeXml(o.font)}" font-size="${n(captionSize)}" text-anchor="middle" fill="${o.ink}">${escapeXml(line)}</text>`,
      );
      y += lineHeight;
    }
  }
  parts.push('</svg>');
  return { svg: parts.join(''), width: Number(n(W)), height: Number(n(H)), error };
}
