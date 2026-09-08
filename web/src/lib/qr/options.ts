// The QR section's settings: one object, its defaults, its validation, its
// persistence, its presets, and `qrOptions`, the one place that turns it into
// what the matrix builder (node-qrcode's `create`) and our renderer
// (`render.ts`) each take — for the screen and for the export, which differ
// only in colour and scale.
//
// The option list follows qr-code-styling's, group for group (main, dots,
// corners square, corners dot, background, image, text, export), so a person
// who knows that tool finds the same knobs; every one of them is drawn by our
// own renderer.
import type { QRCodeOptions, QRCodeSegment } from 'qrcode';
import { COLOR, FONT } from '../ui/tokens';

export const EC_LEVELS = ['L', 'M', 'Q', 'H'] as const;
export type EcLevel = (typeof EC_LEVELS)[number];

/** The share of the symbol each level can recover (ISO/IEC 18004 §7.5.1). */
export const EC_RECOVERS: Readonly<Record<EcLevel, string>> = { L: '7%', M: '15%', Q: '25%', H: '30%' };

/** The most of the symbol a plate or image may cover at each level: about
 *  a quarter of what the level recovers, since the cover also removes the
 *  codewords that would do the recovering. H's figure is the cap the logo
 *  plate is sized to. */
export const COVER_SHARE: Readonly<Record<EcLevel, number>> = { L: 0.02, M: 0.035, Q: 0.06, H: 0.07 };
export const PLATE_SHARE_MAX = COVER_SHARE.H;

/** How the dark modules are drawn: squares; squares softened where a run
 *  ends; full pills across a run; one corner rounded, alternating by
 *  position so runs read as woven; the same with the free corners softened;
 *  dots; and `nanourl`, the site's own — dots under the gradient with the
 *  logo on a plate. */
export const MODULE_STYLES = ['classic', 'rounded', 'extra-rounded', 'classy', 'classy-rounded', 'dots', 'nanourl'] as const;
export type ModuleStyle = (typeof MODULE_STYLES)[number];

/** How a finder's ring (corners square) or centre (corners dot) is drawn. */
export const CORNER_TYPES = ['square', 'rounded', 'extra-rounded', 'dot', 'dots', 'classy', 'classy-rounded'] as const;
export type CornerType = (typeof CORNER_TYPES)[number];

/** Dotted corners on dotted modules: too little contiguous dark for a
 *  decoder's finder search (measured with jsqr on every combination — the
 *  `dots` corner type reads on every other module style, and every other
 *  corner type on these). The page warns, and the scannability gate skips
 *  exactly these. */
export const isUnscannable = (s: { style: ModuleStyle; cornersSquareType: CornerType; cornersDotType: CornerType }): boolean =>
  (s.style === 'dots' || s.style === 'nanourl') && (s.cornersSquareType === 'dots' || s.cornersDotType === 'dots');

export const GRADIENT_TYPES = ['linear', 'radial'] as const;
export type GradientType = (typeof GRADIENT_TYPES)[number];

export const SHAPES = ['square', 'circle'] as const;
export type Shape = (typeof SHAPES)[number];

/** How the text is segmented: the library's optimal mix (the only setting
 *  that gives qr-alpha its alphanumeric segments), or one byte segment. */
export const MODES = ['auto', 'byte'] as const;
export type Mode = (typeof MODES)[number];
/** What forcing byte mode costs, for the hint and the readout. */
export const MODE_NOTE_BYTE = 'packs every character in 8 bits, so qr-alpha gains nothing over the other alphabets';

export const IMAGE_SOURCES = ['none', 'logo', 'upload'] as const;
export type ImageSource = (typeof IMAGE_SOURCES)[number];

export const EXPORT_FORMATS = ['png', 'jpeg', 'webp', 'svg'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const MIME: Readonly<Record<ExportFormat, string>> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' };

export const VERSION_MIN = 1;
export const VERSION_MAX = 40;
export const MASK_MAX = 7;
export const MARGIN_MAX = 16;
export const PADDING_MAX = 16;
/** Quick picks for the quiet zone: none, the least a reader copes with,
 *  and the symbology's own four. */
export const MARGIN_PICKS = [0, 1, 2, 4] as const;
export const WIDTH_MIN = 96;
export const WIDTH_MAX = 1024;
export const SCALE_MIN = 1;
export const SCALE_MAX = 64;
export const STOPS_MIN = 2;
export const STOPS_MAX = 5;
export const IMAGE_MARGIN_MAX = 64;
/** An uploaded image is kept in the settings, so it is capped at what
 *  localStorage comfortably holds beside them. */
export const IMAGE_MAX_BYTES = 200 * 1024;
/** The centre label's length cap, enforced in the field with a count. */
export const CENTRE_LABEL_MAX = 12;
export const FILE_NAME_MAX = 64;

export interface Stop {
  /** 0..1 along the gradient. */
  offset: number;
  color: string;
}

export interface Gradient {
  type: GradientType;
  /** Degrees, clockwise from left-to-right. Radial ignores it. */
  rotation: number;
  stops: Stop[];
}

/** A solid colour, or a gradient over it. */
export interface Paint {
  color: string;
  gradient: Gradient | null;
}

export interface QrSettings {
  // main
  level: EcLevel;
  /** `null` lets the library pick the smallest version that fits. */
  version: number | null;
  /** `null` lets the library pick the best-scoring mask. */
  mask: number | null;
  mode: Mode;
  /** Keep the `https://` in the text; off starts it at the host. */
  scheme: boolean;
  /** CSS pixel width of the on-screen symbol. */
  width: number;
  /** Pixels per module in the exported raster. */
  scale: number;
  /** The quiet zone, in modules. 4 is the symbology's own. */
  margin: number;
  /** Room between the quiet zone and the image edge, in modules. */
  padding: number;
  shape: Shape;
  // dots
  style: ModuleStyle;
  /** On screen, snap the width so a module is a whole number of pixels. */
  roundSize: boolean;
  dots: Paint;
  // corners
  cornersSquareType: CornerType;
  /** `null` inherits the dots' paint. */
  cornersSquare: Paint | null;
  cornersDotType: CornerType;
  cornersDot: Paint | null;
  // background
  background: Paint;
  transparent: boolean;
  /** 0..1: the image's corner radius as a share of half its width. */
  backgroundRound: number;
  // image
  imageSource: ImageSource;
  /** The upload as a data: URL, or `null`. */
  imageData: string | null;
  /** Image side as a share of the symbol's side, clamped by the level. */
  imageSize: number;
  /** Space around the image, in pixels of the exported raster. */
  imageMargin: number;
  hideBackgroundDots: boolean;
  // text
  caption: string;
  centreLabel: string;
  // export
  format: ExportFormat;
  /** JPEG/WebP quality, 0..1. */
  quality: number;
  /** The file name stem; empty means "from the code". */
  fileName: string;
}

/** `a` blended `t` of the way to `b`, both `#rrggbb`. */
export function mix(a: string, b: string, t: number): string {
  const ch = (i: number): string =>
    Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t)
      .toString(16)
      .padStart(2, '0');
  return `#${ch(1)}${ch(3)}${ch(5)}`;
}

/** How far the preset gradient's accent end is pulled toward the dark end.
 *  The accent is a colour tuned for text on the dark page; as the top rows
 *  of a symbol on light paper it is too light for a decoder's binarizer,
 *  and the two upper finders sit in exactly those rows. 0.4 keeps the hue
 *  and scans without inversion; 0.25 is the least that does. */
export const GRADIENT_MIX = 0.4;

/** The preset gradient: the accent, pulled toward `dark`, down to `dark`,
 *  top to bottom. */
export const presetGradient = (dark: string): Gradient => ({
  type: 'linear',
  rotation: 90,
  stops: [
    { offset: 0, color: mix(COLOR.acc, dark, GRADIENT_MIX) },
    { offset: 1, color: dark },
  ],
});

export const solid = (color: string): Paint => ({ color, gradient: null });

/** The gradient a paint gets when its switch is first turned on: from its
 *  colour to the accent, top to bottom — two different colours, so the
 *  change shows at once. A paint already in the accent runs to the text
 *  colour instead. */
export const defaultGradient = (color: string): Gradient => ({
  type: 'linear',
  rotation: 90,
  stops: [
    { offset: 0, color },
    { offset: 1, color: color === COLOR.acc ? COLOR.txt : COLOR.acc },
  ],
});

export const DEFAULT_SETTINGS: QrSettings = {
  level: 'M',
  version: null,
  mask: null,
  mode: 'auto',
  scheme: true,
  width: 240,
  scale: 8,
  margin: 4,
  padding: 0,
  shape: 'square',
  style: 'classic',
  roundSize: false,
  dots: solid('#000000'),
  cornersSquareType: 'square',
  cornersSquare: null,
  cornersDotType: 'square',
  cornersDot: null,
  background: solid('#ffffff'),
  transparent: false,
  backgroundRound: 0,
  imageSource: 'none',
  imageData: null,
  imageSize: 0.4,
  imageMargin: 0,
  hideBackgroundDots: true,
  caption: '',
  centreLabel: '',
  format: 'png',
  quality: 0.92,
  fileName: '',
};

/** `localStorage` key for the persisted settings. One key, one object. */
export const STORAGE_KEY = 'nanourl.qr';

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v: unknown, fallback: string): string => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback);

const num = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);

const clampInt = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = num(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
};

const clampFloat = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = num(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n * 1000) / 1000));
};

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {});

/** A valid gradient from anything, or `null`: two to five stops in the
 *  order given (the renderer sorts a copy when it emits), each offset
 *  clamped to 0..1, every colour a colour. */
export function sanitizeGradient(raw: unknown, fallbackColor: string): Gradient | null {
  if (raw === null || raw === undefined) return null;
  const g = obj(raw);
  const stopsRaw = Array.isArray(g.stops) ? g.stops : [];
  const stops: Stop[] = stopsRaw.slice(0, STOPS_MAX).map((st, i) => {
    const o = obj(st);
    return { offset: clampFloat(o.offset, 0, 1, i === 0 ? 0 : 1), color: hex(o.color, fallbackColor) };
  });
  // fewer than two: add the missing end, so a lone stop becomes a run to
  // (or from) the paint's colour rather than two stops on one spot
  if (stops.length === 0) stops.push({ offset: 0, color: fallbackColor });
  if (stops.length === 1) stops.push({ offset: stops[0].offset > 0.5 ? 0 : 1, color: fallbackColor });
  return {
    type: oneOf(g.type, GRADIENT_TYPES, 'linear'),
    rotation: clampInt(g.rotation, 0, 359, 0),
    stops,
  };
}

/** A valid paint from anything, defaults where a value is missing or wrong. */
export function sanitizePaint(raw: unknown, fallback: Paint): Paint {
  const p = obj(raw);
  const color = hex(p.color, fallback.color);
  return { color, gradient: sanitizeGradient(p.gradient, color) };
}

/**
 * A full, valid settings object from anything: every field checked for type
 * and range, defaults where a value is missing or wrong, out-of-range
 * numbers clamped. It validates and nothing else — no sorting, swapping,
 * tinting or replacing: the settings are exactly what was chosen, and every
 * colour in them is the one drawn (or, on dark, its exact swap).
 * `null`/`'auto'` and an empty string all mean "auto" for the version and
 * the mask.
 */
export function sanitize(raw: unknown): QrSettings {
  const r = obj(raw);
  const d = DEFAULT_SETTINGS;
  const auto = (v: unknown, lo: number, hi: number): number | null =>
    v === null || v === undefined || v === '' || v === 'auto' ? null : Number.isFinite(Number(v)) ? clampInt(v, lo, hi, lo) : null;
  const paintOrNull = (v: unknown, fallback: Paint): Paint | null => (v === null || v === undefined ? null : sanitizePaint(v, fallback));
  const dots = sanitizePaint(r.dots, d.dots);
  const image = typeof r.imageData === 'string' && r.imageData.startsWith('data:image/') && r.imageData.length <= IMAGE_MAX_BYTES * 1.4 ? r.imageData : null;
  return {
    level: oneOf(r.level, EC_LEVELS, d.level),
    version: auto(r.version, VERSION_MIN, VERSION_MAX),
    mask: auto(r.mask, 0, MASK_MAX),
    mode: oneOf(r.mode, MODES, d.mode),
    scheme: r.scheme !== false,
    width: clampInt(r.width, WIDTH_MIN, WIDTH_MAX, d.width),
    scale: clampInt(r.scale, SCALE_MIN, SCALE_MAX, d.scale),
    margin: clampInt(r.margin, 0, MARGIN_MAX, d.margin),
    padding: clampInt(r.padding, 0, PADDING_MAX, d.padding),
    shape: oneOf(r.shape, SHAPES, d.shape),
    style: oneOf(r.style, MODULE_STYLES, d.style),
    roundSize: r.roundSize === true,
    dots,
    cornersSquareType: oneOf(r.cornersSquareType, CORNER_TYPES, d.cornersSquareType),
    cornersSquare: paintOrNull(r.cornersSquare, dots),
    cornersDotType: oneOf(r.cornersDotType, CORNER_TYPES, d.cornersDotType),
    cornersDot: paintOrNull(r.cornersDot, dots),
    background: sanitizePaint(r.background, d.background),
    transparent: r.transparent === true,
    backgroundRound: clampFloat(r.backgroundRound, 0, 1, d.backgroundRound),
    imageSource: oneOf(r.imageSource, IMAGE_SOURCES, d.imageSource),
    imageData: image,
    imageSize: clampFloat(r.imageSize, 0, 1, d.imageSize),
    imageMargin: clampInt(r.imageMargin, 0, IMAGE_MARGIN_MAX, d.imageMargin),
    hideBackgroundDots: r.hideBackgroundDots !== false,
    caption: typeof r.caption === 'string' ? r.caption : d.caption,
    centreLabel: typeof r.centreLabel === 'string' ? r.centreLabel.slice(0, CENTRE_LABEL_MAX) : d.centreLabel,
    format: oneOf(r.format, EXPORT_FORMATS, d.format),
    quality: clampFloat(r.quality, 0.05, 1, d.quality),
    fileName: typeof r.fileName === 'string' ? r.fileName.slice(0, FILE_NAME_MAX) : d.fileName,
  };
}

/** The persisted settings, or the defaults: storage that is absent, blocked
 *  or holding something else is the same as never having saved. */
export function loadSettings(): QrSettings {
  try {
    return sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return sanitize(null);
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

/** Whether the symbol carries something on its centre — an image or a
 *  label — and so needs the error correction to carry the loss. */
export const hasPlate = (s: QrSettings): boolean => s.imageSource !== 'none' || s.centreLabel.trim() !== '';

/** The largest image side, as a share of the symbol's, the level allows:
 *  the covered area must stay under `COVER_SHARE`. */
export const maxImageSize = (level: EcLevel): number => Math.sqrt(COVER_SHARE[level]);

/** The image side actually drawn: the setting, clamped by the level. */
export const effectiveImageSize = (s: QrSettings): number => Math.min(s.imageSize, maxImageSize(s.level));

/**
 * The settings a style choice brings with it. The signature style is a
 * preset — dots under the preset gradient, rounded finders, the logo,
 * level H — each part of which stays a setting of its own afterwards;
 * picking the style sets them, it does not lock them.
 */
export function applyStyle(s: QrSettings, style: ModuleStyle): QrSettings {
  if (style === 'nanourl') {
    return {
      ...s,
      style,
      dots: { ...s.dots, gradient: presetGradient(s.dots.color) },
      cornersSquareType: 'extra-rounded',
      cornersDotType: 'rounded',
      imageSource: 'logo',
      level: 'H',
    };
  }
  return { ...s, style };
}

/** The presets: each a named look, as its own overrides on the defaults —
 *  applying one resets everything it does not set. Looks only: no preset
 *  sets a caption or a label, which are the person's. Colours are tokens
 *  where a token fits; the fixed ones live in this table and nowhere else.
 *  Every preset scans (the e2e applies each and reads it back). */
export const PRESET_TABLE: Readonly<Record<string, { hint: string; settings: Partial<QrSettings> }>> = {
  classic: { hint: 'The plain code: black squares on white, nothing else.', settings: {} },
  nanourl: {
    hint: 'The site’s own look: dots under the blue gradient, rounded corners, the logo in the middle.',
    settings: {
      style: 'nanourl',
      dots: { color: DEFAULT_SETTINGS.dots.color, gradient: presetGradient(DEFAULT_SETTINGS.dots.color) },
      cornersSquareType: 'extra-rounded',
      cornersDotType: 'rounded',
      imageSource: 'logo',
      level: 'H',
    },
  },
  rounded: { hint: 'Softened squares and rounded corners, dark on light.', settings: { style: 'rounded', cornersSquareType: 'rounded', cornersDotType: 'rounded' } },
  dots: {
    hint: 'Every module a dot, round corners, ink on light.',
    settings: { style: 'dots', cornersSquareType: 'dot', cornersDotType: 'dot', dots: solid(COLOR.ink) },
  },
  classy: { hint: 'One corner of each module rounded so runs look woven, with matching corners.', settings: { style: 'classy', cornersSquareType: 'classy', cornersDotType: 'classy' } },
  ocean: {
    hint: 'Pills across the runs, fading from the site’s blue down to its ink, on white.',
    settings: {
      style: 'extra-rounded',
      cornersSquareType: 'extra-rounded',
      cornersDotType: 'extra-rounded',
      dots: { color: COLOR.ink, gradient: { type: 'linear', rotation: 90, stops: [{ offset: 0, color: mix(COLOR.acc, COLOR.ink, 0.35) }, { offset: 1, color: COLOR.ink }] } },
    },
  },
  sunset: {
    hint: 'Dots in a warm diagonal fade, with rounded corners.',
    settings: {
      style: 'dots',
      cornersSquareType: 'rounded',
      cornersDotType: 'rounded',
      dots: { color: '#7a1f2b', gradient: { type: 'linear', rotation: 45, stops: [{ offset: 0, color: '#7a1f2b' }, { offset: 1, color: '#b3410f' }] } },
    },
  },
  'mono-dark': { hint: 'Light on dark: the paper as ink and the ink as paper. Phone cameras read it; some scanners do not.', settings: { dots: solid(COLOR.txt), background: solid(COLOR.ink) } },
  poster: {
    hint: 'Large, with a tight quiet zone and the strongest error correction, for a label or a picture of your own in the middle.',
    settings: { style: 'classy-rounded', cornersSquareType: 'classy-rounded', cornersDotType: 'rounded', width: 320, margin: 2, level: 'H' },
  },
  minimal: { hint: 'The smallest text and the tightest frame: no scheme, a one-module quiet zone, no padding.', settings: { margin: 1, padding: 0, scheme: false } },
};
export const PRESETS = Object.keys(PRESET_TABLE) as Preset[];
export type Preset = keyof typeof PRESET_TABLE;

/** A preset applied: the defaults, then its own overrides — so it resets
 *  everything it does not set — validated like any other settings. */
export function applyPreset(preset: Preset): QrSettings {
  return sanitize({ ...DEFAULT_SETTINGS, ...PRESET_TABLE[preset].settings });
}

/** The preset the settings currently are, exactly, or `null` once any
 *  control has changed them. */
export function presetOf(s: QrSettings): Preset | null {
  const now = JSON.stringify(s);
  return PRESETS.find((name) => JSON.stringify(applyPreset(name)) === now) ?? null;
}

/** An image is a plate, and a plate needs level H — applied when a picture
 *  first appears, once, so the person can lower it again on purpose. */
export function applyImageSource(s: QrSettings, source: ImageSource): QrSettings {
  const raise = !hasPlate(s) && source !== 'none';
  return { ...s, imageSource: source, level: raise ? 'H' : s.level };
}

/** A centre label is a plate, and a plate needs level H — applied when the
 *  label goes from empty to something, once, so the person can lower it
 *  again on purpose. */
export function applyCentreLabel(s: QrSettings, label: string): QrSettings {
  const next = label.slice(0, CENTRE_LABEL_MAX);
  const raise = s.centreLabel.trim() === '' && next.trim() !== '' && !hasPlate(s);
  return { ...s, centreLabel: next, level: raise ? 'H' : s.level };
}

/** What the renderer draws on the centre. */
export type Plate = { kind: 'logo' } | { kind: 'image'; href: string } | { kind: 'label'; text: string };

/** Everything `render.ts` needs, with every colour a literal: the SVG is also
 *  rasterised on its own, where no custom property resolves. */
export interface RenderOptions {
  style: ModuleStyle;
  cornersSquareType: CornerType;
  cornersDotType: CornerType;
  dots: Paint;
  /** `null` inherits `dots`. */
  cornersSquare: Paint | null;
  cornersDot: Paint | null;
  /** The background, or `null` for none. */
  background: Paint | null;
  backgroundRound: number;
  shape: Shape;
  /** Quiet zone, in modules. */
  margin: number;
  /** Room between the quiet zone and the image edge, in modules. */
  padding: number;
  plate: Plate | null;
  /** The plate's colour, and the colour of text on it and of the caption. */
  plateFill: string;
  ink: string;
  /** Image side as a share of the symbol's side. */
  imageSize: number;
  /** Space around the image, in pixels of this document. */
  imageMarginPx: number;
  hideBackgroundDots: boolean;
  caption: string;
  font: string;
  /** Pixels per module: sets `width`/`height` on the document, which an
   *  `<img>` needs to have an intrinsic size. Omitted for the inline symbol,
   *  which the page sizes; `pxPerModule` then says how large it is drawn. */
  scale?: number;
  pxPerModule: number;
}

export interface QrOptions {
  /** For `QRCode.create`: the options, and the text or a single byte segment. */
  create: QRCodeOptions;
  segments: (text: string) => string | QRCodeSegment[];
  /** The inline symbol, sized by the page. */
  screen: RenderOptions;
  /** The exported files, at the export scale. */
  export: RenderOptions;
}

/** A gradient run the other way: the same colours, the offsets mirrored,
 *  the order reversed. Nothing a person chose is replaced. */
export function reverseGradient(g: Gradient): Gradient {
  return { ...g, stops: g.stops.map((st) => ({ ...st, offset: Math.round((1 - st.offset) * 1000) / 1000 })).reverse() };
}

const reversePaint = (p: Paint): Paint => ({ color: p.color, gradient: p.gradient ? reverseGradient(p.gradient) : null });

/**
 * The colours inverted, in the config itself: the modules take the
 * background's paint and the background the modules', each gradient's
 * stops run the other way (so it still lies the same way across the
 * symbol); the corners' own paints are reversed in place; the plate and
 * the label follow, since they take the two base colours. An involution:
 * pressed twice, the config is what it was. Inverted codes need a scanner
 * that reads light on dark, which the page says under the button.
 */
export function invertColours(s: QrSettings): QrSettings {
  return {
    ...s,
    dots: reversePaint(s.background),
    background: reversePaint(s.dots),
    cornersSquare: s.cornersSquare ? reversePaint(s.cornersSquare) : null,
    cornersDot: s.cornersDot ? reversePaint(s.cornersDot) : null,
  };
}

/** A gradient with one more stop: its offset the midpoint of the last two
 *  (0.5 for a two-stop gradient), so it never lands on another stop and
 *  can never trade places with one; its colour the last stop's. */
export function addStop(g: Gradient): Gradient {
  if (g.stops.length >= STOPS_MAX) return g;
  const [a, b] = g.stops.slice(-2);
  const offset = Math.round(((a.offset + b.offset) / 2) * 1000) / 1000;
  const stops = [...g.stops.slice(0, -1), { offset, color: b.color }, b];
  return { ...g, stops };
}

/**
 * The one mapping from settings to what each consumer takes. The renderer
 * draws the config verbatim — the same paints on screen and in the export;
 * the two differ only in scale — so every colour in the settings is the
 * colour drawn. The one thing the renderer does to a value is sort a copy
 * of a gradient's stops by offset when it emits the definition.
 */
export function qrOptions(s: QrSettings, pxPerModuleOnScreen = 1): QrOptions {
  const create: QRCodeOptions = { errorCorrectionLevel: s.level };
  if (s.version !== null) create.version = s.version;
  if (s.mask !== null) create.maskPattern = s.mask as NonNullable<QRCodeOptions['maskPattern']>;
  const segments = (text: string): string | QRCodeSegment[] =>
    s.mode === 'byte' ? [{ mode: 'byte', data: new TextEncoder().encode(text) }] : text;

  const plate: Plate | null =
    s.centreLabel.trim() !== ''
      ? { kind: 'label', text: s.centreLabel.trim() }
      : s.imageSource === 'logo'
        ? { kind: 'logo' }
        : s.imageSource === 'upload' && s.imageData
          ? { kind: 'image', href: s.imageData }
          : null;
  const render: RenderOptions = {
    style: s.style,
    cornersSquareType: s.cornersSquareType,
    cornersDotType: s.cornersDotType,
    dots: s.dots,
    cornersSquare: s.cornersSquare,
    cornersDot: s.cornersDot,
    background: s.transparent ? null : s.background,
    backgroundRound: s.backgroundRound,
    shape: s.shape,
    margin: s.margin,
    padding: s.padding,
    plate,
    plateFill: s.background.color,
    ink: s.dots.color,
    imageSize: effectiveImageSize(s),
    imageMarginPx: s.imageMargin,
    hideBackgroundDots: s.hideBackgroundDots,
    caption: s.caption.trim(),
    font: FONT.sans,
    pxPerModule: s.scale,
  };
  return {
    create,
    segments,
    screen: { ...render, pxPerModule: pxPerModuleOnScreen },
    export: { ...render, scale: s.scale },
  };
}

/** A file name for an export: the chosen stem, or the code, with anything a
 *  file system or a shell would trip on replaced. */
export function exportName(stem: string, code: string, ext: ExportFormat): string {
  const safe = (stem || code).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, FILE_NAME_MAX);
  return `${stem ? '' : 'nanourl-'}${safe || 'qr'}.${ext}`;
}
