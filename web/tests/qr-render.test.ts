import { describe, expect, it } from 'vitest';
import QRCode from 'qrcode';
import {
  alignmentCentres,
  alignmentCoords,
  circlePadding,
  cornerShape,
  escapeXml,
  eyesPath,
  finderPaths,
  gradientLine,
  matrixFrom,
  moduleShape,
  modulesPath,
  paintFill,
  plateBox,
  renderSvg,
  ringPath,
  roundedRect,
  timingPath,
  wrapCaption,
} from '../src/lib/qr/render';
import {
  CORNER_TYPES,
  DEFAULT_SETTINGS,
  MODULE_STYLES,
  PLATE_SHARE_MAX,
  applyStyle,
  presetGradient,
  GRADIENT_END,
  qrOptions,
  solid,
  type QrSettings,
} from '../src/lib/qr/options';

// The renderer draws from the matrix alone, so these pin what a scanner
// relies on (every dark module drawn, the function patterns where the matrix
// has them and as runs) and what an export relies on: a valid document, the
// same bytes for the same input.

/** A real matrix for a real link, from the library the page uses. */
const real = (text = 'HTTPS://QV.LC/#/TBUDT', level: 'L' | 'M' | 'Q' | 'H' = 'M') => QRCode.create(text, { errorCorrectionLevel: level }).modules;

const darkCount = (m: { size: number; get(r: number, c: number): number | boolean }): number => {
  let k = 0;
  for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) if (m.get(r, c)) k++;
  return k;
};

/** Parse with the browser's own parser: a `parsererror` element is how it
 *  reports an invalid document. */
const parse = (svg: string): Document => {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(doc.getElementsByTagName('parsererror').length, svg.slice(0, 200)).toBe(0);
  return doc;
};

const o = (over: Partial<QrSettings> = {}) => qrOptions({ ...DEFAULT_SETTINGS, ...over });
/** The default quiet zone, in modules: where the symbol starts and what the
 *  document grows by on each side. */
const Q = DEFAULT_SETTINGS.margin;
const free = { tl: true, tr: true, br: true, bl: true };
const arcs = (s: string): number => (s.match(/A/g) ?? []).length;

describe('moduleShape', () => {
  it('draws each style as one closed shape with the corners its rule says', () => {
    expect(moduleShape('classic', 2, 3, 0, free)).toBe('M2 3h1v1h-1z');
    expect(arcs(moduleShape('rounded', 0, 0, 0, free))).toBe(4);
    expect(arcs(moduleShape('rounded', 0, 0, 0, { tl: true, tr: false, br: false, bl: true }))).toBe(2);
    expect(moduleShape('rounded', 0, 0, 0, free)).toContain('A0.3 0.3');
    expect(moduleShape('extra-rounded', 0, 0, 0, free)).toContain('A0.5 0.5');
    expect(arcs(moduleShape('extra-rounded', 0, 0, 0, { tl: false, tr: false, br: false, bl: false }))).toBe(0);
    // classy: one full corner by parity, nothing else
    expect(arcs(moduleShape('classy', 0, 0, 0, free))).toBe(1);
    expect(moduleShape('classy', 0, 0, 0, free)).toMatch(/^M0\.5 0/); // top-left rounded on even parity
    expect(moduleShape('classy', 0, 0, 1, free)).toMatch(/^M0 0H1/); // bottom-right on odd
    expect(arcs(moduleShape('classy', 0, 0, 1, free))).toBe(1);
    // classy-rounded: the parity corner full, the free others softened
    expect(arcs(moduleShape('classy-rounded', 0, 0, 0, free))).toBe(3);
    expect(arcs(moduleShape('classy-rounded', 0, 0, 0, { tl: false, tr: false, br: false, bl: false }))).toBe(1);
    for (const s of ['dots', 'nanourl'] as const) expect(moduleShape(s, 0, 0, 0, free)).toBe('M0.1 0.5a0.4 0.4 0 1 0 0.8 0a0.4 0.4 0 1 0 -0.8 0Z');
  });
  it('rounds only the corners that face no dark neighbour in the run-aware styles', () => {
    const blank = '.'.repeat(21);
    const rows = Array.from({ length: 21 }, () => blank);
    rows[10] = '.........###.........';
    for (const style of ['rounded', 'extra-rounded'] as const) {
      const cells = modulesPath(matrixFrom(rows), style, 0).split('Z').filter(Boolean);
      expect(cells).toHaveLength(3);
      expect(cells.map(arcs)).toEqual([2, 0, 2]);
    }
    rows[10] = '..........#..........';
    expect(arcs(modulesPath(matrixFrom(rows), 'extra-rounded', 0))).toBe(4);
  });
});

describe('modulesPath', () => {
  it('draws exactly the dark modules outside the function patterns, one shape each, in every style', () => {
    const m = real();
    const timing = (timingPath(m.size, 0).match(/h1v1h-1z/g) ?? []).length;
    const outside = darkCount(m) - 3 * 33 - alignmentCentres(m.size).length * 17 - timing;
    expect(alignmentCentres(m.size).length).toBeGreaterThan(0);
    for (const style of MODULE_STYLES) {
      const d = modulesPath(m, style, 4);
      expect((d.match(/[Zz]/g) ?? []).length, style).toBe(outside);
    }
  });
  it('leaves a hole where the image sits when asked', () => {
    const m = real();
    const all = modulesPath(m, 'classic', 0);
    const holed = modulesPath(m, 'classic', 0, { x: 10, y: 10, w: 5, h: 5 });
    expect(holed.length).toBeLessThan(all.length);
    expect(holed).not.toMatch(/M1[0-4] 1[0-4]h/);
  });
});

describe('function patterns', () => {
  it('derives the alignment coordinates the standard tabulates', () => {
    expect(alignmentCoords(21)).toEqual([]);
    expect(alignmentCoords(25)).toEqual([6, 18]);
    expect(alignmentCoords(45)).toEqual([6, 22, 38]);
    expect(alignmentCoords(145)).toEqual([6, 34, 60, 86, 112, 138]);
    expect(alignmentCoords(177)).toEqual([6, 30, 58, 86, 114, 142, 170]);
    expect(alignmentCentres(25)).toEqual([[18, 18]]);
    expect(alignmentCentres(45)).toHaveLength(6);
  });
  it('alignment patterns sit on rings in every real matrix up to version 10', () => {
    for (let v = 2; v <= 10; v++) {
      const m = QRCode.create('HTTPS://QV.LC/#/TBUDT', { version: v, errorCorrectionLevel: 'L' }).modules;
      for (const [ar, ac] of alignmentCentres(m.size)) {
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const onRing = Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
            expect(!!m.get(ar + dr, ac + dc), `v${v} alignment ${ar},${ac} at ${dr},${dc}`).toBe(onRing);
          }
        }
      }
    }
  });
  it('timing patterns are the dark modules of row 6 and column 6 between the finders, as squares', () => {
    const m = real();
    const d = timingPath(m.size, 4);
    const cells = [...d.matchAll(/M([\d.]+) ([\d.]+)h1v1h-1z/g)].map((x) => [Number(x[1]) - 4, Number(x[2]) - 4]);
    for (let i = 8; i <= m.size - 9; i++) {
      const dark = i % 2 === 0;
      expect(!!m.get(6, i), `row 6, ${i}`).toBe(dark);
      expect(cells.some(([x, y]) => x === i && y === 6)).toBe(dark);
    }
    expect(cells).toHaveLength(m.size - 15);
    for (const style of MODULE_STYLES) expect(modulesPath(m, style, 4)).not.toMatch(/M12 10[ah]/);
  });
  it('classic finders cover exactly the finder modules of a real matrix', () => {
    const m = real();
    const ring = (r: number, c: number): boolean => {
      const lr = r < 7 ? r : r - (m.size - 7);
      const lc = c < 7 ? c : c - (m.size - 7);
      return lr === 0 || lr === 6 || lc === 0 || lc === 6 || (lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4);
    };
    for (let r = 0; r < m.size; r++) {
      for (let c = 0; c < m.size; c++) {
        const inEyes = (r < 7 && c < 7) || (r < 7 && c >= m.size - 7) || (r >= m.size - 7 && c < 7);
        if (inEyes) expect(!!m.get(r, c), `finder module ${r},${c}`).toBe(ring(r, c));
      }
    }
    expect(eyesPath(m.size, 4)).toContain('M4 4h7v7h-7z');
  });
});

describe('cornerShape and finderPaths', () => {
  it('draws every corner type, with dots as the block\'s modules', () => {
    expect(cornerShape('square', 0, 0, 7)).toBe('M0 0h7v7h-7z');
    expect(cornerShape('dot', 0, 0, 7)).toBe(`M0 3.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0Z`);
    expect(arcs(cornerShape('rounded', 0, 0, 7))).toBe(4);
    expect(cornerShape('rounded', 0, 0, 7)).toContain('A1.4 1.4');
    expect(cornerShape('extra-rounded', 0, 0, 7)).toContain('A2.45 2.45');
    expect(arcs(cornerShape('classy', 0, 0, 7))).toBe(2);
    expect(arcs(cornerShape('classy-rounded', 0, 0, 7))).toBe(4);
    expect((cornerShape('dots', 0, 0, 7, true).match(/Z/g) ?? []).length).toBe(24);
    expect((cornerShape('dots', 0, 0, 3).match(/Z/g) ?? []).length).toBe(9);
    // a dots ring is beads over a bar, in a path of its own
    const f = finderPaths(25, 'dots', 'dots', 0);
    expect(f.ring).toContain('h6.5v6.5h-6.5z');
    expect((f.beads.match(/Z/g) ?? []).length).toBe(72);
    expect(finderPaths(25, 'square', 'dots', 0).beads).toBe('');
  });
  it('places the three finders at the matrix corners for every type, rings and centres apart', () => {
    for (const t of CORNER_TYPES) {
      const f = finderPaths(25, t, t, 4);
      const starts = [...(f.ring + f.core).matchAll(/M([\d.]+) ([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
      for (const [ox, oy] of [
        [4, 4],
        [22, 4],
        [4, 22],
      ]) {
        expect(starts.some(([x, y]) => x >= ox && x <= ox + 3.5 && y >= oy && y <= oy + 3.5), `${t} finder at ${ox},${oy}`).toBe(true);
      }
      expect(f.core.length).toBeGreaterThan(0);
    }
  });
});

describe('paints', () => {
  it('runs a linear gradient through the box centre at the rotation, long enough to span it', () => {
    const box = { x: 4, y: 4, w: 25, h: 25 };
    expect(gradientLine(0, box).map(Math.round)).toEqual([4, 17, 29, 17]);
    expect(gradientLine(90, box).map(Math.round)).toEqual([17, 4, 17, 29]);
    const [x1, y1, x2, y2] = gradientLine(45, box);
    expect(x2 - x1).toBeCloseTo(y2 - y1);
    expect(x1).toBeLessThan(x2);
    expect(y1).toBeLessThan(y2);
    expect(Math.hypot(x2 - x1, y2 - y1)).toBeCloseTo(25 * Math.SQRT2, 5);
  });
  it('emits a linear or radial definition in user space, or a plain colour', () => {
    const box = { x: 0, y: 0, w: 10, h: 10 };
    expect(paintFill(solid('#123456'), 'p', box)).toEqual({ def: '', fill: '#123456' });
    const lin = paintFill({ color: '#000000', gradient: presetGradient('#000000') }, 'p', box);
    expect(lin.fill).toBe('url(#p)');
    expect(lin.def).toMatch(/^<linearGradient id="p" gradientUnits="userSpaceOnUse" x1="5" y1="0" x2="5" y2="10">/);
    expect(lin.def).toContain(`stop-color="${GRADIENT_END}"`);
    // stops are emitted in offset order, stably, whatever order they were kept in
    const unsorted = paintFill({ color: '#000000', gradient: { type: 'linear', rotation: 0, stops: [{ offset: 1, color: '#111111' }, { offset: 0, color: '#222222' }, { offset: 1, color: '#333333' }] } }, 'p', box);
    expect(unsorted.def.match(/stop-color="(#\w+)"/g)).toEqual(['stop-color="#222222"', 'stop-color="#111111"', 'stop-color="#333333"']);
    const rad = paintFill({ color: '#000000', gradient: { ...presetGradient('#000000'), type: 'radial' } }, 'p', box);
    expect(rad.def).toMatch(/^<radialGradient id="p" gradientUnits="userSpaceOnUse" cx="5" cy="5" r="7.071">/);
  });
});

describe('plateBox', () => {
  it('keeps the logo plate square, odd and under the share cap', () => {
    for (const size of [21, 25, 29, 33, 45, 57, 177]) {
      const p = plateBox(size, { kind: 'logo' })!;
      expect(p.w).toBe(p.h);
      expect(p.w % 2).toBe(1);
      expect((p.w * p.h) / (size * size)).toBeLessThanOrEqual(PLATE_SHARE_MAX);
      expect(p.x + p.w / 2).toBe(size / 2);
    }
  });
  it('sizes an image plate by the coefficient and its margin', () => {
    const p = plateBox(25, { kind: 'image', href: 'data:image/png;base64,AA' }, 0.2, 1)!;
    expect(p.w).toBe(7);
    expect(p.x).toBe(9);
  });
  it('grows a label plate with the text and refuses one past the cap', () => {
    const short = plateBox(25, { kind: 'label', text: 'QV' })!;
    const longer = plateBox(25, { kind: 'label', text: 'QV.LC' })!;
    expect(longer.w).toBeGreaterThan(short.w);
    expect(plateBox(21, { kind: 'label', text: 'TWELVE CHARS' })).toBeNull();
    expect(plateBox(57, { kind: 'label', text: 'TWELVE CHARS' })).not.toBeNull();
    expect(plateBox(25, null)).toBeNull();
  });
});

describe('wrapCaption', () => {
  it('wraps by word to the width and breaks a word longer than a line', () => {
    expect(wrapCaption('qv.lc/#BAddTS_zj', 25, 25 / 14)).toEqual(['qv.lc/#BAddTS_zj']);
    const lines = wrapCaption('scan this code to open the long article', 21, 1.5);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(Math.floor(21 / (1.5 * 0.55)));
    expect(wrapCaption('a'.repeat(60), 21, 1.5).every((l) => l.length <= 25)).toBe(true);
    expect(wrapCaption('', 21, 1.5)).toEqual([]);
  });
});

describe('renderSvg', () => {
  it('is a valid SVG document for every module style and corner type', () => {
    const m = real();
    for (const style of MODULE_STYLES) {
      for (const t of CORNER_TYPES) {
        const r = renderSvg(m, o({ style, cornersSquareType: t, cornersDotType: t }).screen);
        const doc = parse(r.svg);
        expect(doc.documentElement.getAttribute('viewBox')).toBe(`0 0 ${m.size + 2 * Q} ${m.size + 2 * Q}`);
        expect(doc.querySelectorAll('path.modules')).toHaveLength(1);
        expect(doc.querySelectorAll('path.ring')).toHaveLength(1);
        expect(doc.querySelectorAll('path.core')).toHaveLength(1);
        expect(r.error).toBeNull();
      }
    }
  });

  it('is deterministic: the same matrix and options give the same bytes', () => {
    const m = real();
    const opts = qrOptions(applyStyle({ ...DEFAULT_SETTINGS, caption: 'qv.lc', cornersDotType: 'dot', shape: 'circle' }, 'nanourl'));
    expect(renderSvg(m, opts.export).svg).toBe(renderSvg(m, opts.export).svg);
    expect(renderSvg(m, opts.screen).svg).toBe(renderSvg(m, opts.screen).svg);
    expect(renderSvg(m, opts.screen).svg).not.toBe(renderSvg(m, opts.export).svg);
    expect(renderSvg(real('HTTPS://QV.LC/#/OTHER'), opts.screen).svg).not.toBe(renderSvg(m, opts.screen).svg);
  });

  it('does the viewBox arithmetic: quiet zone, padding, caption, circle', () => {
    const m = real();
    const s = m.size;
    expect(renderSvg(m, o({ margin: 0, padding: 0 }).export)).toMatchObject({ width: s, height: s });
    expect(parse(renderSvg(m, o({ margin: 0, padding: 0 }).export).svg).documentElement.getAttribute('viewBox')).toBe(`0 0 ${s} ${s}`);
    expect(renderSvg(m, o({ margin: 0, padding: 3 }).export)).toMatchObject({ width: s + 6, height: s + 6 });
    expect(renderSvg(m, o({ margin: 2, padding: 0 }).export)).toMatchObject({ width: s + 4, height: s + 4 });
    // the modules start where the quiet zone and the padding put them
    expect(renderSvg(m, o({ margin: 1, padding: 2 }).export).svg).toContain('d="M3 3h7v7h-7z');
    const withCaption = renderSvg(m, o({ margin: 0, padding: 0, caption: 'hi' }).export);
    expect(withCaption.width).toBe(s);
    expect(withCaption.height).toBeGreaterThan(s);
    // a circle needs the disc to contain the square: padding rises to the half-diagonal
    const c = renderSvg(m, o({ shape: 'circle', margin: 4, padding: 0 }).export);
    expect(c.width).toBe(s + 8 + 2 * circlePadding(s, 4));
    expect(circlePadding(21, 0)).toBe(Math.ceil((21 * Math.SQRT2 - 21) / 2));
  });

  it('leaves the finders where the matrix has them, whatever the style', () => {
    const m = real();
    const classic = renderSvg(m, o().screen).svg;
    const styled = renderSvg(m, o({ style: 'dots', cornersSquareType: 'dot', cornersDotType: 'dot' }).screen).svg;
    const ring = (svg: string): string => parse(svg).querySelector('path.ring')!.getAttribute('d')!;
    expect(ring(classic)).toBe(finderPaths(m.size, 'square', 'square', Q).ring);
    expect(ring(styled)).toBe(finderPaths(m.size, 'dot', 'dot', Q).ring);
    const squares = new Set([...modulesPath(m, 'classic', 4).matchAll(/M([\d.]+) ([\d.]+)h1/g)].map((x) => `${Number(x[1]) + 0.5},${Number(x[2]) + 0.5}`));
    for (const c of modulesPath(m, 'dots', 4).matchAll(/M([\d.]+) ([\d.]+)a/g)) {
      expect(squares.has(`${Number(c[1]) + 0.4},${c[2]}`)).toBe(true);
    }
  });

  it('paints the background as asked: colour, rounded, gradient, none, or a disc', () => {
    const m = real();
    const painted = parse(renderSvg(m, o({ background: solid('#abcdef') }).export).svg);
    expect(painted.querySelector('rect.background')?.getAttribute('fill')).toBe('#abcdef');
    expect(painted.documentElement.getAttribute('width')).toBe(String((m.size + 2 * Q) * 8));
    const round = parse(renderSvg(m, o({ backgroundRound: 0.5 }).export).svg);
    expect(round.querySelector('rect.background')?.getAttribute('rx')).toBe(String((m.size + 2 * Q) / 4));
    const grad = parse(renderSvg(m, o({ background: { color: '#ffffff', gradient: { type: 'radial', rotation: 0, stops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#dddddd' }] } } }).export).svg);
    expect(grad.querySelector('radialGradient#qr-bg')).not.toBeNull();
    expect(grad.querySelector('rect.background')?.getAttribute('fill')).toBe('url(#qr-bg)');
    const clear = parse(renderSvg(m, o({ transparent: true }).screen).svg);
    expect(clear.querySelector('.background')).toBeNull();
    expect(clear.documentElement.getAttribute('width')).toBeNull();
    const disc = parse(renderSvg(m, o({ shape: 'circle' }).export).svg);
    expect(disc.querySelector('circle.background')).not.toBeNull();
    expect(disc.querySelector('path.ring')).not.toBeNull();
    expect(disc.querySelector('path.ring')!.getAttribute('d')!.length).toBeGreaterThan(0);
  });

  it('the circle ring dots stay outside the quiet zone and inside the disc', () => {
    const m = real();
    const origin = 4 + circlePadding(m.size, 4);
    const W = m.size + 2 * origin;
    const d = ringPath(m, 'classic', origin, 4, W);
    const cells = [...d.matchAll(/M([\d.]+) ([\d.]+)h1v1h-1z/g)].map((x) => [Number(x[1]), Number(x[2])]);
    expect(cells.length).toBeGreaterThan(0);
    for (const [x, y] of cells) {
      const inSquare = x >= origin - 4 && x < origin + m.size + 4 && y >= origin - 4 && y < origin + m.size + 4;
      expect(inSquare).toBe(false);
      expect(Math.hypot(x + 0.5 - W / 2, y + 0.5 - W / 2)).toBeLessThanOrEqual(W / 2 - 0.5);
    }
    expect(ringPath(m, 'classic', origin, 4, W)).toBe(d);
  });

  it('paints the dots, each corner part and the background with their own paint', () => {
    const m = real();
    const s: Partial<QrSettings> = {
      dots: { color: '#101010', gradient: { ...presetGradient('#101010'), rotation: 45 } },
      cornersSquare: solid('#ff0000'),
      cornersDot: { color: '#00ff00', gradient: { type: 'radial', rotation: 0, stops: [{ offset: 0, color: '#00ff00' }, { offset: 1, color: '#008800' }] } },
    };
    const doc = parse(renderSvg(m, o(s).export).svg);
    const g = doc.querySelector('linearGradient#qr-dots')!;
    expect(g.getAttribute('gradientUnits')).toBe('userSpaceOnUse');
    const [x1, y1, x2, y2] = gradientLine(45, { x: Q, y: Q, w: m.size, h: m.size });
    expect(Number(g.getAttribute('x1'))).toBeCloseTo(x1, 2);
    expect(Number(g.getAttribute('y1'))).toBeCloseTo(y1, 2);
    expect(Number(g.getAttribute('x2'))).toBeCloseTo(x2, 2);
    expect(Number(g.getAttribute('y2'))).toBeCloseTo(y2, 2);
    expect(doc.querySelector('path.modules')!.getAttribute('fill')).toBe('url(#qr-dots)');
    expect(doc.querySelector('path.function')!.getAttribute('fill')).toBe('url(#qr-dots)');
    expect(doc.querySelector('path.ring')!.getAttribute('fill')).toBe('#ff0000');
    expect(doc.querySelector('path.core')!.getAttribute('fill')).toBe('url(#qr-core)');
    expect(doc.querySelector('radialGradient#qr-core')).not.toBeNull();
    // inherited corners take the dots' paint, defined once
    const inherit = parse(renderSvg(m, o({ dots: s.dots }).export).svg);
    expect(inherit.querySelector('path.ring')!.getAttribute('fill')).toBe('url(#qr-dots)');
    expect(inherit.querySelectorAll('linearGradient')).toHaveLength(1);
  });

  it('puts the logo on a plate for the signature style, from the favicon rects', () => {
    const m = real();
    const doc = parse(renderSvg(m, qrOptions(applyStyle(DEFAULT_SETTINGS, 'nanourl')).export).svg);
    expect(doc.querySelector('symbol#qr-logo')!.querySelectorAll('rect')).toHaveLength(3);
    expect(doc.querySelector('rect.plate')!.getAttribute('fill')).toBe('#ffffff');
    expect(doc.querySelector('use')!.getAttribute('href')).toBe('#qr-logo');
  });

  it('draws an uploaded image at its size and margin, hiding the dots behind it or not', () => {
    const m = real();
    const href = 'data:image/png;base64,iVBORw0KGgo=';
    const base: Partial<QrSettings> = { imageSource: 'upload', imageData: href, imageSize: 0.2, imageMargin: 8, level: 'H', scale: 8 };
    const hidden = parse(renderSvg(m, o(base).export).svg);
    const img = hidden.querySelector('image')!;
    expect(img.getAttribute('href')).toBe(href);
    // the plate is imageSize of the symbol plus a margin of 8 px at 8 px per module, one module each side
    expect(Number(hidden.querySelector('rect.plate')!.getAttribute('width'))).toBeCloseTo(0.2 * m.size + 2, 3);
    expect(Number(img.getAttribute('width'))).toBeCloseTo(0.2 * m.size, 3);
    const shown = parse(renderSvg(m, o({ ...base, hideBackgroundDots: false }).export).svg);
    expect(shown.querySelector('rect.plate')).toBeNull();
    expect(shown.querySelector('path.modules')!.getAttribute('d')!.length).toBeGreaterThan(hidden.querySelector('path.modules')!.getAttribute('d')!.length);
  });

  it('draws a centre label escaped, and reports a label that cannot fit', () => {
    const m = real('A', 'H');
    expect(m.size).toBe(21);
    const ok = renderSvg(m, o({ centreLabel: 'A<B' }).export);
    expect(ok.error).toBeNull();
    const doc = parse(ok.svg);
    expect(doc.querySelector('text.label')!.textContent).toBe('A<B');
    expect(ok.svg).toContain('A&lt;B');
    const bad = renderSvg(m, o({ centreLabel: 'TWELVE CHARS' }).export);
    expect(bad.error).toMatch(/centre label/);
    expect(parse(bad.svg).querySelector('rect.plate')).toBeNull();
  });

  it('adds the caption under the code, wrapped and escaped, and grows the document for it', () => {
    const m = real();
    const plain = renderSvg(m, o().export);
    const r = renderSvg(m, o({ caption: 'scan & open "the" article on qv.lc today please' }).export);
    expect(r.height).toBeGreaterThan(plain.height);
    expect(r.width).toBe(plain.width);
    const doc = parse(r.svg);
    const lines = [...doc.querySelectorAll('text.caption')];
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.map((l) => l.textContent).join(' ')).toBe('scan & open "the" article on qv.lc today please');
    expect(r.svg).toContain('&amp;');
    expect(doc.documentElement.getAttribute('viewBox')).toBe(`0 0 ${r.width} ${r.height}`);
    for (const l of lines) expect(Number(l.getAttribute('y'))).toBeGreaterThan(m.size + 2 * Q);
  });

  it('escapes every XML special character and rounds rectangles per corner', () => {
    expect(escapeXml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
    expect(roundedRect(0, 0, 2, 2, [0, 0, 0, 0])).toBe('M0 0H2V2H0V0Z');
    expect(arcs(roundedRect(0, 0, 2, 2, [1, 0, 1, 0]))).toBe(2);
  });
});
