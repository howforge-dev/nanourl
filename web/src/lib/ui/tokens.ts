// The theme's colours, for the code that cannot read a CSS custom property:
// a canvas 2D context (`fillStyle` takes a colour string, not `var(--acc)`)
// and the standalone favicon document, which is served as its own file with
// no stylesheet behind it.
//
// `src/app.css` decides these values; this is a second spelling of them, so it
// is pinned: `tests/tokens.test.ts` parses that file's `:root` block and fails
// if any entry here stops matching its custom property. Without the test the
// observatory's scatter plots drift off the theme one repaint at a time,
// silently, and a drifted colour looks deliberate.
export const COLOR = {
  bg: '#0d1117',
  card: '#161b22',
  raised: '#1c2128',
  sunken: '#21262d',
  line: '#30363d',
  line2: '#484f58',
  txt: '#e6edf3',
  dim: '#8b949e',
  acc: '#58a6ff',
  ok: '#3fb950',
  warn: '#d29922',
  bad: '#f85149',
  prose: '#c9d1d9',
  ink: '#04121f',
} as const;

/**
 * A canvas is drawn at twice its CSS size so its pixels stay sharp on a 2x
 * display. Anything measured in the backing store is therefore `CANVAS_SCALE`
 * times its CSS length, and text drawn into it is that multiple of a `--fs-*`
 * step; `CANVAS_FONT` is `--fs-micro` doubled. Neither can be a custom
 * property: a 2D context takes numbers and a font string, not `var()`.
 */
export const CANVAS_SCALE = 2;
export const CANVAS_FONT = '20px ui-monospace, monospace';

/**
 * The two font stacks, for text that is drawn rather than styled: the QR
 * renderer's caption and centre label go into an SVG document that is also
 * rasterised on its own, with no stylesheet in scope. Pinned to `app.css`'s
 * `--font-sans` / `--font-mono` by `tests/tokens.test.ts`, like `COLOR`.
 */
export const FONT = {
  sans: 'system-ui, sans-serif',
  mono: 'ui-monospace, monospace',
} as const;

/** `FONT` key -> the custom property in `app.css` that owns the value. */
export const FONT_VAR: Readonly<Record<keyof typeof FONT, string>> = {
  sans: '--font-sans',
  mono: '--font-mono',
};

/**
 * Lengths TypeScript passes into CSS as a value rather than writing as a
 * declaration (a component prop, a `style:` directive) where a stylesheet's
 * `var()` has nowhere to live. Multiples of the 8px step, like app.css's
 * `--m-*` measures.
 */
export const SIZE = {
  /** minimum column for one per-token cost chip */
  chip: '88px',
  /** the same chip in a figure that prints 2dp and needs the room */
  chipWide: '96px',
} as const;

/**
 * Hues that exist only in a figure, and have no meaning in the interface.
 *
 * A categorical palette is a different job from the theme: these have to stay
 * distinguishable from EACH OTHER at two pixels, not carry a meaning like "ok"
 * or "warning", so they are not custom properties and `tests/tokens.test.ts`
 * does not pin them to `app.css`. Named here rather than typed into a canvas
 * so a figure cannot invent a ninth one.
 */
export const FIGURE = {
  /** the atlas's token classes, beyond the ones the theme already names */
  violet: '#bc8cff',
  cyan: '#39c5cf',
  slate: '#6e7681',
  /** a filled highlight over `--bg`: the attention schematic's target box */
  accentFill: '#0d2439',
} as const;

/** `COLOR` key -> the custom property in `app.css` that owns the value. */
export const COLOR_VAR: Readonly<Record<keyof typeof COLOR, string>> = {
  bg: '--bg',
  card: '--card',
  raised: '--raised',
  sunken: '--sunken',
  line: '--line',
  line2: '--line-2',
  txt: '--txt',
  dim: '--dim',
  acc: '--acc',
  ok: '--ok',
  warn: '--warn',
  bad: '--bad',
  prose: '--prose',
  ink: '--ink',
};
