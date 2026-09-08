// `src/lib/ui/tokens.ts` spells the theme's colours a second time, for the
// code that cannot read a CSS custom property (a canvas 2D context, and the
// standalone favicon document). A second spelling drifts unless something
// pins it, and a drifted colour looks deliberate rather than broken.
//
// This parses app.css's own `:root` block — the file that decides the value —
// and fails if any entry stops matching. Same shape as tests/headers.test.ts,
// which parses `_headers` and the nginx conf and compares them per path.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COLOR, COLOR_VAR, FONT, FONT_VAR } from '../src/lib/ui/tokens';
import { LOGO_RECTS, logoSvg } from '../src/lib/ui/logo';
import { WEB_ROOT } from '../scripts/paths';

/** Every `--name: value;` declaration in app.css's first `:root { … }` block. */
function rootCustomProperties(): Map<string, string> {
  const css = readFileSync(resolve(WEB_ROOT, 'src/app.css'), 'utf8');
  const start = css.indexOf(':root {');
  const end = css.indexOf('\n}', start);
  expect(start, 'app.css must declare a :root token block').toBeGreaterThan(-1);
  const out = new Map<string, string>();
  for (const line of css.slice(start, end).split('\n')) {
    const m = /^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/i.exec(line);
    if (m) out.set(m[1], m[2].trim());
  }
  return out;
}

describe('theme tokens', () => {
  const props = rootCustomProperties();

  it('app.css declares every colour tokens.ts restates', () => {
    for (const name of Object.values(COLOR_VAR)) {
      expect(props.has(name), `app.css is missing ${name}`).toBe(true);
    }
  });

  it('every tokens.ts colour equals its custom property in app.css', () => {
    for (const [key, value] of Object.entries(COLOR)) {
      const name = COLOR_VAR[key as keyof typeof COLOR];
      expect(props.get(name), `${key} (${name})`).toBe(value);
    }
  });

  it('every tokens.ts font stack equals its custom property in app.css', () => {
    for (const [key, value] of Object.entries(FONT)) {
      const name = FONT_VAR[key as keyof typeof FONT];
      expect(props.get(name), `${key} (${name})`).toBe(value);
    }
  });

  it('declares the radius, spacing and type ramps the primitives are built from', () => {
    for (const n of ['--r-1', '--r-2', '--r-3', '--r-4', '--r-5']) expect(props.has(n), n).toBe(true);
    for (const n of ['--s-1', '--s-2', '--s-3', '--s-4', '--s-5', '--s-6', '--s-7']) expect(props.has(n), n).toBe(true);
    for (const n of ['--fs-micro', '--fs-2xs', '--fs-xs', '--fs-sm', '--fs-md', '--fs-base', '--fs-lg', '--fs-xl', '--fs-2xl', '--fs-3xl']) {
      expect(props.has(n), n).toBe(true);
    }
    for (const n of ['--border', '--ring', '--ring-offset', '--font-sans', '--font-mono', '--col', '--gutter', '--logo']) {
      expect(props.has(n), n).toBe(true);
    }
  });

  it('spaces the spacing ramp on 4px steps', () => {
    const px = (n: string): number => Number(/^(\d+)px$/.exec(props.get(n) ?? '')?.[1]);
    for (const n of ['--s-1', '--s-2', '--s-3', '--s-4', '--s-5', '--s-6', '--s-7']) {
      const v = px(n);
      expect(Number.isFinite(v), `${n} must be a px literal`).toBe(true);
      expect(v % 4, `${n} = ${v}px is off the 4px scale`).toBe(0);
    }
  });
});

describe('logo', () => {
  it('paints the mark in theme colours, not in literals of its own', () => {
    const used = LOGO_RECTS.flatMap((r) => [r.fill, r.stroke].filter((c): c is string => c !== undefined));
    const known = new Set<string>(Object.values(COLOR));
    for (const c of used) expect(known.has(c), `${c} is not a theme colour`).toBe(true);
  });

  it('serializes to a standalone SVG document with every rectangle in it', () => {
    const svg = logoSvg();
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    // Standalone: no `var(--…)`, which has no stylesheet to resolve against
    // when the favicon is fetched on its own.
    expect(svg).not.toContain('var(');
    expect(svg.match(/<rect /g)?.length).toBe(LOGO_RECTS.length);
    expect(svg).toContain(`fill="${COLOR.acc}"`);
  });
});
