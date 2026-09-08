// The wordmark's logo: one long URL bar over one short one, in a rounded
// tile. Written as data rather than as markup because it is drawn twice —
// inline in the page header (lib/ui/PageHeader.svelte) and as the standalone
// `dist/favicon.svg` the build emits (vite.config.ts's `favicon` plugin) —
// so a hand-copied `<svg>` per page plus a URL-encoded `data:` URI per entry
// document is ten places for three rectangles to drift apart.
import { COLOR } from './tokens';

export const LOGO_VIEWBOX = '0 0 100 100';

/** One rectangle of the mark. Attribute names are SVG's own, so the same
 *  object spreads into a Svelte `<rect>` and serializes into the favicon. */
export interface LogoRect {
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
  fill: string;
  stroke?: string;
  'stroke-width'?: number;
}

export const LOGO_RECTS: readonly LogoRect[] = [
  { x: 2, y: 2, width: 96, height: 96, rx: 22, fill: COLOR.card, stroke: COLOR.line, 'stroke-width': 3 },
  { x: 18, y: 27, width: 64, height: 15, rx: 7.5, fill: COLOR.dim },
  { x: 18, y: 58, width: 26, height: 15, rx: 7.5, fill: COLOR.acc },
];

/** The mark as a standalone SVG document — what `dist/favicon.svg` contains.
 *  Colours are literals from `tokens.ts` rather than `var(--…)`: a favicon is
 *  fetched on its own, with no stylesheet in scope to resolve a custom
 *  property against. */
export function logoSvg(): string {
  const rects = LOGO_RECTS.map(
    (r) =>
      '<rect ' +
      Object.entries(r)
        .map(([k, v]) => `${k}="${String(v)}"`)
        .join(' ') +
      '/>',
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${LOGO_VIEWBOX}">${rects}</svg>`;
}
