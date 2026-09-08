import { describe, expect, it } from 'vitest';
import QRCode from 'qrcode';
import { alignmentCentres, alignmentCoords, escapeXml, eyesPath, matrixFrom, modulesPath, plateBox, renderSvg, timingPath, wrapCaption } from '../src/lib/qr/render';
import { DEFAULT_SETTINGS, EYE_STYLES, MODULE_STYLES, PLATE_SHARE_MAX, applyStyle, gradientTo, qrOptions } from '../src/lib/qr/options';

// The renderer draws from the matrix alone, so these pin what a scanner
// relies on — every dark module drawn, the three finders where the matrix
// has them — and what an export relies on: a valid document, the same bytes
// for the same input.

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

describe('modulesPath', () => {
  it('draws exactly the dark modules outside the function patterns, one shape each', () => {
    const m = real();
    // each finder has 33 dark modules, each alignment pattern 17, and the
    // two timing patterns one per even index between the finders
    const timing = 2 * (timingPath(m.size, 0).match(/h1v1h-1z/g) ?? []).length / 2;
    const outside = darkCount(m) - 3 * 33 - alignmentCentres(m.size).length * 17 - timing;
    expect(alignmentCentres(m.size).length).toBeGreaterThan(0);
    expect((modulesPath(m, 'classic', 4).match(/h1v1h-1z/g) ?? []).length).toBe(outside);
    expect((modulesPath(m, 'dots', 4).match(/a0\.4 0\.4 0 1 0 0\.8 0/g) ?? []).length).toBe(outside);
    expect((modulesPath(m, 'rounded', 4).match(/Z/g) ?? []).length).toBe(outside);
  });
  it('rounds only the corners that face no dark neighbour', () => {
    // A 21-module matrix (the smallest symbol) with a horizontal run of
    // three in the middle, clear of the finders: the ends get two rounded
    // corners, the middle none.
    const blank = '.'.repeat(21);
    const rows = Array.from({ length: 21 }, () => blank);
    rows[10] = '.........###.........';
    const d = modulesPath(matrixFrom(rows), 'rounded', 0);
    const cells = d.split('Z').filter(Boolean);
    expect(cells).toHaveLength(3);
    const arcs = (s: string): number => (s.match(/A/g) ?? []).length;
    expect(arcs(cells[0])).toBe(2);
    expect(arcs(cells[1])).toBe(0);
    expect(arcs(cells[2])).toBe(2);
    // a lone module is a full pill
    rows[10] = '..........#..........';
    expect(arcs(modulesPath(matrixFrom(rows), 'rounded', 0))).toBe(4);
  });
});

describe('alignment patterns', () => {
  it('derives the coordinates the standard tabulates', () => {
    expect(alignmentCoords(21)).toEqual([]);
    expect(alignmentCoords(25)).toEqual([6, 18]);
    expect(alignmentCoords(45)).toEqual([6, 22, 38]);
    expect(alignmentCoords(145)).toEqual([6, 34, 60, 86, 112, 138]);
    expect(alignmentCoords(177)).toEqual([6, 30, 58, 86, 114, 142, 170]);
    expect(alignmentCentres(25)).toEqual([[18, 18]]);
    expect(alignmentCentres(45)).toHaveLength(6);
  });
  it('sit on rings in every real matrix up to version 10', () => {
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
});

describe('timingPath', () => {
  it('is the dark modules of row 6 and column 6 between the finders, as squares', () => {
    const m = real();
    const d = timingPath(m.size, 4);
    const cells = [...d.matchAll(/M([\d.]+) ([\d.]+)h1v1h-1z/g)].map((x) => [Number(x[1]) - 4, Number(x[2]) - 4]);
    for (let i = 8; i <= m.size - 9; i++) {
      const dark = i % 2 === 0;
      expect(!!m.get(6, i), `row 6, ${i}`).toBe(dark);
      expect(!!m.get(i, 6), `col 6, ${i}`).toBe(dark);
      expect(cells.some(([x, y]) => x === i && y === 6)).toBe(dark);
      expect(cells.some(([x, y]) => x === 6 && y === i)).toBe(dark);
    }
    expect(cells).toHaveLength(m.size - 15);
    // and the module path never draws them, in any style
    for (const style of MODULE_STYLES) expect(modulesPath(m, style, 4)).not.toMatch(/M12 10[ah]/);
  });
});

describe('eyesPath', () => {
  it('places the three finders at the matrix corners for every eye style', () => {
    for (const eyes of EYE_STYLES) {
      const d = eyesPath(25, eyes, 4);
      // the top-left finder starts at the margin, the others 18 modules over
      const starts = [...d.matchAll(/M([\d.]+) ([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
      const origins = [
        [4, 4],
        [22, 4],
        [4, 22],
      ];
      for (const [ox, oy] of origins) {
        expect(starts.some(([x, y]) => x >= ox && x <= ox + 3.5 && y >= oy && y <= oy + 3.5), `${eyes} finder at ${ox},${oy}`).toBe(true);
      }
    }
  });
  it('classic eyes cover exactly the finder modules of a real matrix', () => {
    const m = real();
    const inEyes = (r: number, c: number): boolean => (r < 7 && c < 7) || (r < 7 && c >= m.size - 7) || (r >= m.size - 7 && c < 7);
    // every module inside the finders that the library set dark is one the
    // ring-and-centre shape paints, and vice versa
    const ring = (r: number, c: number): boolean => {
      const lr = r < 7 ? r : r - (m.size - 7);
      const lc = c < 7 ? c : c - (m.size - 7);
      const onRing = lr === 0 || lr === 6 || lc === 0 || lc === 6;
      const centre = lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4;
      return onRing || centre;
    };
    for (let r = 0; r < m.size; r++) {
      for (let c = 0; c < m.size; c++) {
        if (inEyes(r, c)) expect(!!m.get(r, c), `finder module ${r},${c}`).toBe(ring(r, c));
      }
    }
  });
});

describe('plateBox', () => {
  it('keeps the logo plate square, odd and under the share cap', () => {
    for (const size of [21, 25, 29, 33, 45, 57, 177]) {
      const p = plateBox(size, { kind: 'logo' });
      expect(p).not.toBeNull();
      expect(p!.w).toBe(p!.h);
      expect(p!.w % 2).toBe(1);
      expect((p!.w * p!.h) / (size * size)).toBeLessThanOrEqual(PLATE_SHARE_MAX);
      expect(p!.x + p!.w / 2).toBe(size / 2);
    }
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
  const o = (over: Partial<Parameters<typeof qrOptions>[0]> = {}) => qrOptions({ ...DEFAULT_SETTINGS, ...over });

  it('is a valid SVG document for every module style and eye style', () => {
    const m = real();
    for (const style of MODULE_STYLES) {
      for (const eyes of EYE_STYLES) {
        const r = renderSvg(m, o({ style, eyes, gradient: style === 'nanourl' }).screen);
        const doc = parse(r.svg);
        expect(doc.documentElement.getAttribute('viewBox')).toBe(`0 0 ${m.size + 8} ${m.size + 8}`);
        expect(doc.querySelectorAll('path.modules')).toHaveLength(1);
        expect(doc.querySelectorAll('path.eyes')).toHaveLength(1);
        expect(r.error).toBeNull();
      }
    }
  });

  it('is deterministic: the same matrix and options give the same bytes', () => {
    const m = real();
    const opts = qrOptions(applyStyle({ ...DEFAULT_SETTINGS, caption: 'qv.lc', eyes: 'circle' }, 'nanourl'));
    expect(renderSvg(m, opts.export).svg).toBe(renderSvg(m, opts.export).svg);
    expect(renderSvg(m, opts.screen).svg).toBe(renderSvg(m, opts.screen).svg);
    expect(renderSvg(m, opts.screen).svg).not.toBe(renderSvg(m, opts.export).svg);
    // and a different matrix gives different bytes
    expect(renderSvg(real('HTTPS://QV.LC/#/OTHER'), opts.screen).svg).not.toBe(renderSvg(m, opts.screen).svg);
  });

  it('leaves the finders where the matrix has them, whatever the style', () => {
    const m = real();
    const classic = renderSvg(m, o().screen).svg;
    const styled = renderSvg(m, o({ style: 'dots', eyes: 'circle' }).screen).svg;
    // the eye path of the styled render is the plain eyes path at the same
    // origins — the module style cannot move a finder
    const eyes = (svg: string): string => parse(svg).querySelector('path.eyes')!.getAttribute('d')!;
    expect(eyes(classic)).toBe(eyesPath(m.size, 'classic', 4));
    expect(eyes(styled)).toBe(eyesPath(m.size, 'circle', 4));
    // and the data modules of both cover the same set of cells: every
    // circle's centre is a classic square's centre
    const squares = new Set([...modulesPath(m, 'classic', 4).matchAll(/M([\d.]+) ([\d.]+)h1/g)].map((x) => `${Number(x[1]) + 0.5},${Number(x[2]) + 0.5}`));
    for (const c of modulesPath(m, 'dots', 4).matchAll(/M([\d.]+) ([\d.]+)a/g)) {
      expect(squares.has(`${Number(c[1]) + 0.4},${c[2]}`)).toBe(true);
    }
  });

  it('paints the background only when a light colour is given, and sizes the export', () => {
    const m = real();
    const painted = parse(renderSvg(m, o({ light: '#abcdef' }).export).svg);
    expect(painted.querySelector('rect')?.getAttribute('fill')).toBe('#abcdef');
    expect(painted.documentElement.getAttribute('width')).toBe(String((m.size + 8) * 8));
    const clear = parse(renderSvg(m, o({ transparentLight: true }).screen).svg);
    expect(clear.querySelector('rect')).toBeNull();
    expect(clear.documentElement.getAttribute('width')).toBeNull();
  });

  it('draws the gradient once in user space over the symbol, and the modules with it', () => {
    const m = real();
    const doc = parse(renderSvg(m, o({ gradient: true, dark: '#101010' }).export).svg);
    const g = doc.querySelector('linearGradient')!;
    expect(g.getAttribute('gradientUnits')).toBe('userSpaceOnUse');
    expect(g.getAttribute('y1')).toBe('4');
    expect(g.getAttribute('y2')).toBe(String(4 + m.size));
    expect(g.querySelectorAll('stop')[0].getAttribute('stop-color')).toBe(gradientTo('#101010')[0]);
    expect(g.querySelectorAll('stop')[1].getAttribute('stop-color')).toBe('#101010');
    expect(doc.querySelector('path.modules')!.getAttribute('fill')).toBe(`url(#${'qr'}-grad)`);
    expect(doc.querySelector('path.eyes')!.getAttribute('fill')).toBe('url(#qr-grad)');
  });

  it('puts the logo on a plate for the signature style, from the favicon rects', () => {
    const m = real();
    const doc = parse(renderSvg(m, qrOptions(applyStyle(DEFAULT_SETTINGS, 'nanourl')).export).svg);
    expect(doc.querySelector('symbol#qr-logo rect')).not.toBeNull();
    expect(doc.querySelector('symbol#qr-logo')!.querySelectorAll('rect')).toHaveLength(3);
    const plate = doc.querySelector('rect.plate')!;
    expect(plate.getAttribute('fill')).toBe('#ffffff');
    expect(doc.querySelector('use')!.getAttribute('href')).toBe('#qr-logo');
  });

  it('draws a centre label escaped, and reports a label that cannot fit', () => {
    const m = real('A', 'H'); // version 1: 21 modules
    expect(m.size).toBe(21);
    const ok = renderSvg(m, o({ centreLabel: 'A<B' }).export);
    expect(ok.error).toBeNull();
    const doc = parse(ok.svg);
    expect(doc.querySelector('text.label')!.textContent).toBe('A<B');
    expect(ok.svg).toContain('A&lt;B');
    expect(doc.querySelector('use')).toBeNull();
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
    for (const l of lines) expect(Number(l.getAttribute('y'))).toBeGreaterThan(m.size + 8);
  });

  it('escapes every XML special character', () => {
    expect(escapeXml(`<a href="x">&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  });
});
