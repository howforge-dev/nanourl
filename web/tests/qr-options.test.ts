import { afterEach, describe, expect, it } from 'vitest';
import {
  CENTRE_LABEL_MAX,
  COVER_SHARE,
  DARK_TINT,
  defaultGradient,
  DEFAULT_SETTINGS,
  EC_LEVELS,
  EC_RECOVERS,
  STOPS_MAX,
  STORAGE_KEY,
  applyCentreLabel,
  applyImageSource,
  applyPreset,
  applyStyle,
  effectiveImageSize,
  exportName,
  hasPlate,
  loadSettings,
  maxImageSize,
  mix,
  presetGradient,
  qrOptions,
  reverseGradient,
  sanitize,
  sanitizeGradient,
  sanitizePaint,
  saveSettings,
  solid,
} from '../src/lib/qr/options';
import { EC_LABEL, HINTS } from '../src/lib/qr/hints';
import { COLOR, FONT } from '../src/lib/ui/tokens';

// The settings object is one thing with one validator, one persistence path
// and one mapping to what the matrix builder and the renderer take. These
// pin each of those: what a stored blob can do to the page (nothing but set
// valid fields), what a preset brings with it, and which colours the screen
// and the export get.

afterEach(() => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // no storage in this environment: nothing to clear
  }
});

describe('sanitize', () => {
  it('returns the defaults for nothing, garbage, or the wrong types', () => {
    expect(sanitize(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitize('x')).toEqual(DEFAULT_SETTINGS);
    expect(sanitize({ level: 'Z', width: 'wide', dots: 'red', style: 'neon', shape: 'hexagon', format: 'gif' })).toEqual(DEFAULT_SETTINGS);
  });
  it('accepts every valid field and clamps the numbers', () => {
    const s = sanitize({
      level: 'H',
      version: 7,
      mask: 3,
      mode: 'byte',
      scheme: false,
      width: 5000,
      scale: 0,
      margin: -3,
      padding: 99,
      shape: 'circle',
      style: 'classy-rounded',
      roundSize: true,
      dots: { color: '#123ABC', gradient: { type: 'radial', rotation: 400, stops: [{ offset: 2, color: '#ffffff' }] } },
      cornersSquareType: 'dot',
      cornersSquare: { color: '#ff0000' },
      cornersDotType: 'dots',
      background: { color: '#eeeeee' },
      transparent: true,
      backgroundRound: 3,
      onDark: true,
      imageSource: 'logo',
      imageSize: 2,
      imageMargin: -1,
      hideBackgroundDots: false,
      caption: 'hello',
      centreLabel: 'x'.repeat(40),
      format: 'webp',
      quality: 5,
      fileName: 'y'.repeat(100),
    });
    expect(s).toMatchObject({
      level: 'H',
      version: 7,
      mask: 3,
      mode: 'byte',
      scheme: false,
      width: 1024,
      scale: 1,
      margin: 0,
      padding: 16,
      shape: 'circle',
      style: 'classy-rounded',
      roundSize: true,
      cornersSquareType: 'dot',
      cornersDotType: 'dots',
      cornersDot: null,
      transparent: true,
      backgroundRound: 1,
      onDark: true,
      imageSource: 'logo',
      imageSize: 1,
      imageMargin: 0,
      hideBackgroundDots: false,
      caption: 'hello',
      format: 'webp',
      quality: 1,
    });
    expect(s.dots.color).toBe('#123abc');
    expect(s.dots.gradient).toEqual({ type: 'radial', rotation: 359, stops: [{ offset: 0, color: '#123abc' }, { offset: 1, color: '#ffffff' }] });
    expect(s.cornersSquare).toEqual(solid('#ff0000'));
    expect(s.centreLabel).toHaveLength(CENTRE_LABEL_MAX);
    expect(s.fileName).toHaveLength(64);
  });
  it('reads auto for the version and the mask in every spelling', () => {
    for (const v of [null, undefined, '', 'auto']) {
      expect(sanitize({ version: v, mask: v }).version).toBeNull();
      expect(sanitize({ version: v, mask: v }).mask).toBeNull();
    }
    expect(sanitize({ version: '12', mask: '9' })).toMatchObject({ version: 12, mask: 7 });
    expect(sanitize({ version: 0 }).version).toBe(1);
    expect(sanitize({ version: 99 }).version).toBe(40);
  });
  it('keeps an image only as a data: URL under the cap', () => {
    expect(sanitize({ imageData: 'data:image/png;base64,AAAA' }).imageData).toBe('data:image/png;base64,AAAA');
    expect(sanitize({ imageData: 'https://x/y.png' }).imageData).toBeNull();
    expect(sanitize({ imageData: 'data:image/png;base64,' + 'A'.repeat(400 * 1024) }).imageData).toBeNull();
  });
});

describe('gradients and paints', () => {
  it('sorts stops, pads to two, caps at five, and fills bad colours from the paint', () => {
    expect(sanitizeGradient(null, '#000000')).toBeNull();
    const g = sanitizeGradient({ stops: [{ offset: 1, color: 'bad' }, { offset: 0.2, color: '#00ff00' }] }, '#000000')!;
    expect(g.stops.map((s) => s.offset)).toEqual([0.2, 1]);
    expect(g.stops[1].color).toBe('#000000');
    expect(sanitizeGradient({ stops: [] }, '#111111')!.stops).toEqual([{ offset: 0, color: '#111111' }, { offset: 1, color: '#111111' }]);
    const many = sanitizeGradient({ stops: Array.from({ length: 9 }, (_, i) => ({ offset: i / 8, color: '#222222' })) }, '#000000')!;
    expect(many.stops).toHaveLength(STOPS_MAX);
    expect(sanitizePaint({ color: 'nope', gradient: null }, solid('#abcdef'))).toEqual(solid('#abcdef'));
  });
  it('reverses a gradient toward a new end colour, tinting the rest toward it', () => {
    const g = presetGradient('#000000');
    const r = reverseGradient(g, '#ffffff');
    expect(r.stops.map((s) => s.offset)).toEqual([0, 1]);
    expect(r.stops[0].color).toBe(mix('#ffffff', '#000000', DARK_TINT));
    expect(r.stops[1].color).toBe('#ffffff');
    // two stops on the far offset both become the end colour
    const twin = reverseGradient({ ...g, stops: [{ offset: 0, color: '#224488' }, { offset: 1, color: '#000000' }, { offset: 1, color: '#000000' }] }, '#ffffff');
    expect(twin.stops.filter((s) => s.offset === 1).every((s) => s.color === '#ffffff')).toBe(true);
    expect(twin.stops.find((s) => s.offset === 0)!.color).toBe(mix('#ffffff', '#000000', DARK_TINT));
  });
  it('a freshly switched-on gradient runs to the accent, or to the text colour from the accent', () => {
    const g = defaultGradient('#000000');
    expect(g).toMatchObject({ type: 'linear', rotation: 90 });
    expect(g.stops).toEqual([{ offset: 0, color: '#000000' }, { offset: 1, color: COLOR.acc }]);
    expect(defaultGradient(COLOR.acc).stops[1].color).toBe(COLOR.txt);
    expect(g.stops[0].color).not.toBe(g.stops[1].color);
  });
  it('the preset starts from the accent pulled toward the dark end, top to bottom', () => {
    const g = presetGradient('#000000');
    expect(g).toMatchObject({ type: 'linear', rotation: 90 });
    expect(g.stops[0].color).toBe(mix(COLOR.acc, '#000000', 0.4));
    expect(g.stops[1].color).toBe('#000000');
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});

describe('persistence', () => {
  it('loads the defaults when nothing is stored and round-trips what is saved', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    const s = { ...DEFAULT_SETTINGS, level: 'Q' as const, caption: 'scan me', margin: 2, dots: { color: '#112233', gradient: presetGradient('#112233') } };
    saveSettings(s);
    expect(loadSettings()).toEqual(s);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(s));
  });
  it('treats a corrupt blob as nothing stored', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ level: 'H', width: 'x' }));
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, level: 'H' });
  });
});

describe('presets and plates', () => {
  it('the signature style brings the gradient, rounded corners, the logo and level H, each still a setting', () => {
    const s = applyStyle(DEFAULT_SETTINGS, 'nanourl');
    expect(s).toMatchObject({ style: 'nanourl', cornersSquareType: 'extra-rounded', cornersDotType: 'rounded', imageSource: 'logo', level: 'H' });
    expect(s.dots.gradient).toEqual(presetGradient('#000000'));
    expect(applyStyle(s, 'dots')).toMatchObject({ style: 'dots', imageSource: 'logo', level: 'H' });
    expect(hasPlate(s)).toBe(true);
    expect(hasPlate(DEFAULT_SETTINGS)).toBe(false);
  });
  it('presets set the looks and leave the code settings; reset restores everything', () => {
    const custom = { ...applyStyle(DEFAULT_SETTINGS, 'nanourl'), version: 5, caption: 'hi', onDark: true, shape: 'circle' as const };
    const classic = applyPreset(custom, 'classic');
    expect(classic).toMatchObject({ style: 'classic', imageSource: 'none', onDark: false, shape: 'square', version: 5, caption: 'hi', level: 'H' });
    expect(classic.dots).toEqual(DEFAULT_SETTINGS.dots);
    expect(applyPreset(custom, 'nanourl')).toMatchObject({ style: 'nanourl', imageSource: 'logo', version: 5 });
    expect(sanitize(null)).toEqual(DEFAULT_SETTINGS);
  });
  it('a centre label or a picture raises the level to H once, when it first appears', () => {
    const s = applyCentreLabel(DEFAULT_SETTINGS, 'HELLO');
    expect(s).toMatchObject({ centreLabel: 'HELLO', level: 'H' });
    const lowered = { ...s, level: 'L' as const };
    expect(applyCentreLabel(lowered, 'HELLO!').level).toBe('L');
    expect(applyCentreLabel(applyCentreLabel(lowered, ''), 'X').level).toBe('H');
    expect(applyCentreLabel(DEFAULT_SETTINGS, 'y'.repeat(30)).centreLabel).toHaveLength(CENTRE_LABEL_MAX);
    expect(applyImageSource(DEFAULT_SETTINGS, 'logo').level).toBe('H');
    expect(applyImageSource({ ...DEFAULT_SETTINGS, imageSource: 'logo', level: 'L' }, 'upload').level).toBe('L');
  });
  it('caps the image by what the level can lose', () => {
    for (const l of EC_LEVELS) expect(maxImageSize(l)).toBeCloseTo(Math.sqrt(COVER_SHARE[l]));
    expect(effectiveImageSize({ ...DEFAULT_SETTINGS, imageSize: 0.4, level: 'H' })).toBeCloseTo(Math.sqrt(0.07));
    expect(effectiveImageSize({ ...DEFAULT_SETTINGS, imageSize: 0.1, level: 'L' })).toBe(0.1);
  });
});

describe('qrOptions', () => {
  it('passes only what is set to the matrix builder, and one byte segment in byte mode', () => {
    expect(qrOptions(DEFAULT_SETTINGS).create).toEqual({ errorCorrectionLevel: 'M' });
    expect(qrOptions({ ...DEFAULT_SETTINGS, version: 5, mask: 2, level: 'L' }).create).toEqual({ errorCorrectionLevel: 'L', version: 5, maskPattern: 2 });
    expect(qrOptions(DEFAULT_SETTINGS).segments('ABC')).toBe('ABC');
    const seg = qrOptions({ ...DEFAULT_SETTINGS, mode: 'byte' }).segments('ABC');
    expect(seg).toEqual([{ mode: 'byte', data: new TextEncoder().encode('ABC') }]);
  });
  it('gives the export the chosen colours and the scale, and the screen its pixels per module', () => {
    const s = { ...DEFAULT_SETTINGS, dots: solid('#112233'), background: solid('#eeeeee'), scale: 12 };
    const o = qrOptions(s, 7.5);
    expect(o.export).toMatchObject({ dots: solid('#112233'), background: solid('#eeeeee'), scale: 12, plateFill: '#eeeeee', ink: '#112233', font: FONT.sans });
    expect(o.screen).toMatchObject({ dots: solid('#112233'), background: solid('#eeeeee'), pxPerModule: 7.5 });
    expect(o.screen.scale).toBeUndefined();
  });
  it('draws the signature style in the theme on screen and in the chosen colours on export', () => {
    const s = applyStyle(DEFAULT_SETTINGS, 'nanourl');
    const o = qrOptions(s);
    expect(o.screen.dots.color).toBe(COLOR.ink);
    expect(o.screen.dots.gradient!.stops[1].color).toBe(COLOR.ink);
    expect(o.screen.dots.gradient!.stops[0].color).toBe(s.dots.gradient!.stops[0].color);
    expect(o.screen).toMatchObject({ background: solid(COLOR.txt), plateFill: COLOR.txt, ink: COLOR.ink, plate: { kind: 'logo' } });
    expect(o.export).toMatchObject({ dots: s.dots, background: solid('#ffffff'), plateFill: '#ffffff', plate: { kind: 'logo' } });
  });
  it('a transparent background leaves it unpainted but keeps the plate opaque', () => {
    const o = qrOptions({ ...DEFAULT_SETTINGS, transparent: true, background: solid('#abcdef'), centreLabel: 'HI' });
    expect(o.export.background).toBeNull();
    expect(o.export.plateFill).toBe('#abcdef');
    expect(o.export.plate).toEqual({ kind: 'label', text: 'HI' });
  });
  it('on dark swaps the colours and reverses every gradient toward the light end', () => {
    const s = { ...applyStyle(DEFAULT_SETTINGS, 'nanourl'), onDark: true, cornersSquare: { color: '#ff0000', gradient: presetGradient('#ff0000') }, background: solid('#ffffff') };
    const o = qrOptions(s);
    expect(o.export.dots.color).toBe('#ffffff');
    expect(o.export.dots.gradient!.stops[1].color).toBe('#ffffff');
    expect(o.export.dots.gradient!.stops[0].color).toBe(mix('#ffffff', s.dots.gradient!.stops[1].color, DARK_TINT));
    expect(o.export.background).toEqual(solid('#000000'));
    expect(o.export.plateFill).toBe('#000000');
    expect(o.export.ink).toBe('#ffffff');
    expect(o.export.cornersSquare!.color).toBe('#ffffff');
    expect(o.screen.dots.color).toBe(COLOR.txt);
    expect(o.screen.background).toEqual(solid(COLOR.ink));
    expect(qrOptions({ ...s, transparent: true }).export.background).toBeNull();
  });
  it('a centre label replaces the picture, and an upload is drawn from its data', () => {
    expect(qrOptions(applyStyle({ ...DEFAULT_SETTINGS, centreLabel: ' QV ' }, 'nanourl')).screen.plate).toEqual({ kind: 'label', text: 'QV' });
    expect(qrOptions({ ...DEFAULT_SETTINGS, imageSource: 'upload', imageData: 'data:image/png;base64,AA' }).screen.plate).toEqual({ kind: 'image', href: 'data:image/png;base64,AA' });
    expect(qrOptions({ ...DEFAULT_SETTINGS, imageSource: 'upload', imageData: null }).screen.plate).toBeNull();
  });
});

describe('labels and hints share the error-correction figures', () => {
  it('each level label carries its share, and the hint names all four', () => {
    for (const l of EC_LEVELS) {
      expect(EC_LABEL(l)).toBe(`${l} ${EC_RECOVERS[l]}`);
      expect(HINTS.level).toContain(EC_LABEL(l));
    }
  });
});

describe('exportName', () => {
  it('keeps a safe code, uses a chosen stem, and replaces everything else', () => {
    expect(exportName('', 'BAddTS_zj', 'png')).toBe('nanourl-BAddTS_zj.png');
    expect(exportName('', '/TBUDT:AWZ', 'svg')).toBe('nanourl-TBUDT_AWZ.svg');
    expect(exportName('', '🏢🥉🐠', 'webp')).toBe('nanourl-qr.webp');
    expect(exportName('my poster', 'ABC', 'jpeg')).toBe('my_poster.jpeg');
  });
});
