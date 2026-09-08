import { afterEach, describe, expect, it } from 'vitest';
import {
  CENTRE_LABEL_MAX,
  DEFAULT_SETTINGS,
  STORAGE_KEY,
  applyCentreLabel,
  applyStyle,
  exportName,
  hasPlate,
  loadSettings,
  gradientTo,
  mix,
  qrOptions,
  sanitize,
  saveSettings,
} from '../src/lib/qr/options';
import { COLOR, FONT } from '../src/lib/ui/tokens';

// The settings object is one thing with one validator, one persistence path
// and one mapping to what the matrix builder and the renderer take. These
// pin each of those: what a stored blob can do to the page (nothing but set
// valid fields), what a style choice brings with it, and which colours the
// screen and the export get.

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
    expect(sanitize({ level: 'Z', width: 'wide', dark: 'red', style: 'neon', gradient: 'yes' })).toEqual(DEFAULT_SETTINGS);
  });
  it('accepts every valid field and clamps the numbers', () => {
    const s = sanitize({
      level: 'H',
      version: 7,
      mask: 3,
      width: 5000,
      scale: 0,
      margin: -3,
      dark: '#123ABC',
      light: '#ffffff',
      transparentLight: true,
      style: 'dots',
      eyes: 'circle',
      gradient: true,
      caption: 'hello',
      centreLabel: 'x'.repeat(40),
    });
    expect(s.level).toBe('H');
    expect(s.version).toBe(7);
    expect(s.mask).toBe(3);
    expect(s.width).toBe(1024);
    expect(s.scale).toBe(1);
    expect(s.margin).toBe(0);
    expect(s.dark).toBe('#123abc');
    expect(s.transparentLight).toBe(true);
    expect(s.style).toBe('dots');
    expect(s.eyes).toBe('circle');
    expect(s.gradient).toBe(true);
    expect(s.caption).toBe('hello');
    expect(s.centreLabel).toHaveLength(CENTRE_LABEL_MAX);
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
});

describe('persistence', () => {
  it('loads the defaults when nothing is stored and round-trips what is saved', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    const s = { ...DEFAULT_SETTINGS, level: 'Q' as const, caption: 'scan me', margin: 2 };
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

describe('style and label presets', () => {
  it('the signature style brings the gradient, rounded eyes and level H, each still a setting', () => {
    const s = applyStyle(DEFAULT_SETTINGS, 'nanourl');
    expect(s).toMatchObject({ style: 'nanourl', gradient: true, eyes: 'rounded', level: 'H' });
    expect(applyStyle(s, 'dots')).toMatchObject({ style: 'dots', gradient: true, eyes: 'rounded', level: 'H' });
    expect(hasPlate(s)).toBe(true);
    expect(hasPlate(DEFAULT_SETTINGS)).toBe(false);
  });
  it('a centre label raises the level to H once, when it first appears', () => {
    const s = applyCentreLabel(DEFAULT_SETTINGS, 'HELLO');
    expect(s).toMatchObject({ centreLabel: 'HELLO', level: 'H' });
    expect(hasPlate(s)).toBe(true);
    // lowered on purpose, and edited again: stays lowered
    const lowered = { ...s, level: 'L' as const };
    expect(applyCentreLabel(lowered, 'HELLO!').level).toBe('L');
    // cleared and re-entered: raised again
    expect(applyCentreLabel(applyCentreLabel(lowered, ''), 'X').level).toBe('H');
    expect(applyCentreLabel(DEFAULT_SETTINGS, 'y'.repeat(30)).centreLabel).toHaveLength(CENTRE_LABEL_MAX);
  });
});

describe('qrOptions', () => {
  it('passes only what is set to the matrix builder', () => {
    expect(qrOptions(DEFAULT_SETTINGS).create).toEqual({ errorCorrectionLevel: 'M' });
    expect(qrOptions({ ...DEFAULT_SETTINGS, version: 5, mask: 2, level: 'L' }).create).toEqual({
      errorCorrectionLevel: 'L',
      version: 5,
      maskPattern: 2,
    });
  });
  it('gives the export the chosen colours and the scale, and the screen no scale', () => {
    const o = qrOptions({ ...DEFAULT_SETTINGS, dark: '#112233', light: '#eeeeee', scale: 12, gradient: true });
    expect(o.export).toMatchObject({ dark: '#112233', light: '#eeeeee', scale: 12, gradient: gradientTo('#112233'), font: FONT.sans });
    expect(o.screen).toMatchObject({ dark: '#112233', light: '#eeeeee', gradient: gradientTo('#112233') });
    expect(o.screen.scale).toBeUndefined();
  });
  it('draws the signature style in the theme on screen and in the chosen colours on export', () => {
    const s = applyStyle({ ...DEFAULT_SETTINGS, dark: '#000000', light: '#ffffff' }, 'nanourl');
    const o = qrOptions(s);
    expect(o.screen).toMatchObject({ dark: COLOR.ink, light: COLOR.txt, plateFill: COLOR.txt, gradient: gradientTo(COLOR.ink), plate: { kind: 'logo' } });
    expect(o.export).toMatchObject({ dark: '#000000', light: '#ffffff', plateFill: '#ffffff', gradient: gradientTo('#000000'), plate: { kind: 'logo' } });
  });
  it('a transparent light leaves the background unpainted but keeps the plate opaque', () => {
    const o = qrOptions({ ...DEFAULT_SETTINGS, transparentLight: true, light: '#abcdef', centreLabel: 'HI' });
    expect(o.export.light).toBeNull();
    expect(o.export.plateFill).toBe(DEFAULT_SETTINGS.light);
    expect(o.export.plate).toEqual({ kind: 'label', text: 'HI' });
  });
  it('a centre label replaces the logo in every style', () => {
    const s = applyStyle({ ...DEFAULT_SETTINGS, centreLabel: ' QV ' }, 'nanourl');
    expect(qrOptions(s).screen.plate).toEqual({ kind: 'label', text: 'QV' });
  });
});

describe('mix and gradientTo', () => {
  it('blends channel by channel and starts the gradient from the accent pulled toward the dark end', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#58a6ff', '#000000', 0)).toBe(COLOR.acc);
    expect(mix('#58a6ff', '#000000', 1)).toBe('#000000');
    const [from, to] = gradientTo('#000000');
    expect(to).toBe('#000000');
    expect(from).toBe(mix(COLOR.acc, '#000000', 0.4));
    expect(from).not.toBe(COLOR.acc);
  });
});

describe('exportName', () => {
  it('keeps a safe code and replaces everything else', () => {
    expect(exportName('BAddTS_zj', 'png')).toBe('nanourl-BAddTS_zj.png');
    expect(exportName('/TBUDT:AWZ', 'svg')).toBe('nanourl-TBUDT_AWZ.svg');
    expect(exportName('🏢🥉🐠', 'png')).toBe('nanourl-qr.png');
  });
});
