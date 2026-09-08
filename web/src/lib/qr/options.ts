// The QR section's settings: one object, its defaults, its validation, its
// persistence, and `qrOptions`, the one place that turns it into what the
// matrix builder (node-qrcode's `create`) and our renderer (`render.ts`) each
// take — for the screen and for the export, which differ only in colour.
import type { QRCodeOptions } from 'qrcode';
import { COLOR, FONT } from '../ui/tokens';

export const EC_LEVELS = ['L', 'M', 'Q', 'H'] as const;
export type EcLevel = (typeof EC_LEVELS)[number];

/** The share of the symbol each level can recover (ISO/IEC 18004 §7.5.1). */
export const EC_RECOVERS: Readonly<Record<EcLevel, string>> = { L: '7%', M: '15%', Q: '25%', H: '30%' };

/** How the dark modules are drawn. `nanourl` is the site's own: dots under a
 *  vertical gradient, with the logo on a plate in the centre. */
export const MODULE_STYLES = ['classic', 'rounded', 'dots', 'nanourl'] as const;
export type ModuleStyle = (typeof MODULE_STYLES)[number];

/** How the three finder patterns are drawn, independently of the modules. */
export const EYE_STYLES = ['classic', 'rounded', 'circle'] as const;
export type EyeStyle = (typeof EYE_STYLES)[number];

export const VERSION_MIN = 1;
export const VERSION_MAX = 40;
export const MASK_MAX = 7;
export const MARGIN_MAX = 16;
export const WIDTH_MIN = 96;
export const WIDTH_MAX = 1024;
export const SCALE_MIN = 1;
export const SCALE_MAX = 64;
/** The centre label's length cap, enforced in the field with a count. */
export const CENTRE_LABEL_MAX = 12;
/** The most of the symbol a plate may cover: past this the code stops being
 *  recoverable even at level H, which corrects 30% of codewords, since the
 *  plate also sits on the data the codewords protect. */
export const PLATE_SHARE_MAX = 0.07;

export interface QrSettings {
  level: EcLevel;
  /** `null` lets the library pick the smallest version that fits. */
  version: number | null;
  /** `null` lets the library pick the best-scoring mask. */
  mask: number | null;
  /** CSS pixel width of the on-screen symbol. */
  width: number;
  /** Pixels per module in the exported PNG. */
  scale: number;
  /** The quiet zone, in modules. 4 is the symbology's own. */
  margin: number;
  /** Explicit colours, as `#rrggbb`. */
  dark: string;
  light: string;
  /** Leave the light modules and the background unpainted. */
  transparentLight: boolean;
  style: ModuleStyle;
  eyes: EyeStyle;
  /** Paint the dark modules with a vertical gradient from the accent. */
  gradient: boolean;
  /** Free text drawn under the code, inside the image. */
  caption: string;
  /** Short text drawn on the centre plate in place of the logo. */
  centreLabel: string;
}

export const DEFAULT_SETTINGS: QrSettings = {
  level: 'M',
  version: null,
  mask: null,
  width: 240,
  scale: 8,
  margin: 4,
  dark: '#000000',
  light: '#ffffff',
  transparentLight: false,
  style: 'classic',
  eyes: 'classic',
  gradient: false,
  caption: '',
  centreLabel: '',
};

/** `localStorage` key for the persisted settings. One key, one object. */
export const STORAGE_KEY = 'nanourl.qr';

const HEX = /^#[0-9a-f]{6}$/i;

const clampInt = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
};

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

/**
 * A full, valid settings object from anything: every field checked for type
 * and range, defaults where a value is missing or wrong. `null`/`'auto'` and
 * an empty string all mean "auto" for the version and the mask.
 */
export function sanitize(raw: unknown): QrSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const auto = (v: unknown, lo: number, hi: number): number | null =>
    v === null || v === undefined || v === '' || v === 'auto' ? null : Number.isFinite(Number(v)) ? clampInt(v, lo, hi, lo) : null;
  const hex = (v: unknown, fallback: string): string => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback);
  return {
    level: oneOf(r.level, EC_LEVELS, d.level),
    version: auto(r.version, VERSION_MIN, VERSION_MAX),
    mask: auto(r.mask, 0, MASK_MAX),
    width: clampInt(r.width, WIDTH_MIN, WIDTH_MAX, d.width),
    scale: clampInt(r.scale, SCALE_MIN, SCALE_MAX, d.scale),
    margin: clampInt(r.margin, 0, MARGIN_MAX, d.margin),
    dark: hex(r.dark, d.dark),
    light: hex(r.light, d.light),
    transparentLight: r.transparentLight === true,
    style: oneOf(r.style, MODULE_STYLES, d.style),
    eyes: oneOf(r.eyes, EYE_STYLES, d.eyes),
    gradient: r.gradient === true,
    caption: typeof r.caption === 'string' ? r.caption : d.caption,
    centreLabel: typeof r.centreLabel === 'string' ? r.centreLabel.slice(0, CENTRE_LABEL_MAX) : d.centreLabel,
  };
}

/** The persisted settings, or the defaults: storage that is absent, blocked
 *  or holding something else is the same as never having saved. */
export function loadSettings(): QrSettings {
  try {
    return sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Persist, if the browser lets us; a refusal is not an error the page can
 *  do anything about. */
export function saveSettings(s: QrSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // storage blocked or full: the settings simply do not persist
  }
}

/** Whether the symbol carries something on its centre plate — the logo
 *  (the nanourl style) or a label — and so needs level H to stay readable. */
export const hasPlate = (s: QrSettings): boolean => s.style === 'nanourl' || s.centreLabel.trim() !== '';

/**
 * The settings a style choice brings with it. The signature style is a
 * preset — dots under the gradient, rounded eyes, the logo, level H — each
 * part of which stays a setting of its own afterwards; picking the style
 * sets them, it does not lock them.
 */
export function applyStyle(s: QrSettings, style: ModuleStyle): QrSettings {
  if (style === 'nanourl') return { ...s, style, gradient: true, eyes: 'rounded', level: 'H' };
  return { ...s, style };
}

/** A centre label is a plate, and a plate needs level H — applied when the
 *  label goes from empty to something, once, so the person can lower it
 *  again on purpose. */
export function applyCentreLabel(s: QrSettings, label: string): QrSettings {
  const next = label.slice(0, CENTRE_LABEL_MAX);
  const raise = s.centreLabel.trim() === '' && next.trim() !== '' && s.style !== 'nanourl';
  return { ...s, centreLabel: next, level: raise ? 'H' : s.level };
}

/** `a` blended `t` of the way to `b`, both `#rrggbb`. */
export function mix(a: string, b: string, t: number): string {
  const ch = (i: number): string =>
    Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t)
      .toString(16)
      .padStart(2, '0');
  return `#${ch(1)}${ch(3)}${ch(5)}`;
}

/** How far the gradient's accent end is pulled toward the dark end. The
 *  accent is a colour tuned for text on the dark page; as the top rows of a
 *  symbol on light paper it is too light for a decoder's binarizer, and the
 *  two upper finders sit in exactly those rows. 0.4 keeps the hue and scans
 *  without inversion; 0.25 is the least that does. */
export const GRADIENT_MIX = 0.4;

/** The gradient over the dark modules: the accent, pulled toward `dark`,
 *  down to `dark`. */
export const gradientTo = (dark: string): readonly [string, string] => [mix(COLOR.acc, dark, GRADIENT_MIX), dark];

/** What the renderer draws on the centre plate. */
export type Plate = { kind: 'logo' } | { kind: 'label'; text: string };

/** Everything `render.ts` needs, with every colour a literal: the SVG is also
 *  rasterised on its own, where no custom property resolves. */
export interface RenderOptions {
  style: ModuleStyle;
  eyes: EyeStyle;
  /** The dark modules' colour. */
  dark: string;
  /** The light modules' and background's colour, or `null` for none. */
  light: string | null;
  /** A vertical gradient over the dark modules, top to bottom, or `null`. */
  gradient: readonly [string, string] | null;
  /** Quiet zone, in modules. */
  margin: number;
  plate: Plate | null;
  /** The plate's colour. */
  plateFill: string;
  caption: string;
  font: string;
  /** Pixels per module: sets `width`/`height` on the document, which an
   *  `<img>` needs to have an intrinsic size. Omitted for the inline symbol,
   *  which the page sizes. */
  scale?: number;
}

export interface QrOptions {
  /** For `QRCode.create`. */
  create: QRCodeOptions;
  /** The inline symbol: the site's own colours behind the signature style,
   *  the chosen colours behind every other. */
  screen: RenderOptions;
  /** The exported files: always the chosen colours, never the theme. */
  export: RenderOptions;
}

/**
 * The one mapping from settings to what each consumer takes.
 *
 * On screen the signature style is drawn in the theme's own ink and paper
 * — modules from the accent down to the ink, light modules and the plate in
 * the text colour — so it reads as part of the page while staying dark on
 * light, the polarity every scanner reads without inverting. Every other
 * style, and every export, uses the explicit colours: a file leaves the
 * page and has to stand on its own. The gradient starts from the accent in
 * both (see `gradientTo`), since it is the site's mark rather than a theme
 * value.
 */
export function qrOptions(s: QrSettings): QrOptions {
  const create: QRCodeOptions = { errorCorrectionLevel: s.level };
  if (s.version !== null) create.version = s.version;
  if (s.mask !== null) create.maskPattern = s.mask as NonNullable<QRCodeOptions['maskPattern']>;

  const plate: Plate | null =
    s.centreLabel.trim() !== '' ? { kind: 'label', text: s.centreLabel.trim() } : s.style === 'nanourl' ? { kind: 'logo' } : null;
  const light = s.transparentLight ? null : s.light;
  const explicit: RenderOptions = {
    style: s.style,
    eyes: s.eyes,
    dark: s.dark,
    light,
    gradient: s.gradient ? gradientTo(s.dark) : null,
    margin: s.margin,
    plate,
    plateFill: light ?? DEFAULT_SETTINGS.light,
    caption: s.caption.trim(),
    font: FONT.sans,
  };
  const screen: RenderOptions =
    s.style === 'nanourl'
      ? {
          ...explicit,
          dark: COLOR.ink,
          light: s.transparentLight ? null : COLOR.txt,
          gradient: s.gradient ? gradientTo(COLOR.ink) : null,
          plateFill: COLOR.txt,
        }
      : explicit;
  return { create, screen, export: { ...explicit, scale: s.scale } };
}

/** A file name for an export: the code, with anything a file system or a
 *  shell would trip on replaced. */
export function exportName(code: string, ext: 'svg' | 'png'): string {
  const safe = code.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64);
  return `nanourl-${safe || 'qr'}.${ext}`;
}
