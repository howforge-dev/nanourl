import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SECTIONS, sectionNumber, sectionTitle } from '../src/pages/learn/sections';

const dir = join(__dirname, '../src/pages/learn/sections');
const svelte = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? svelte(join(d, e.name)) : e.name.endsWith('.svelte') ? [join(d, e.name)] : [],
  );

describe('learn sections registry', () => {
  it('numbers sections by their position and knows every title', () => {
    SECTIONS.forEach(([id, title], i) => {
      expect(sectionNumber(id)).toBe(i + 1);
      expect(sectionTitle(id)).toBe(title);
    });
    expect(new Set(SECTIONS.map(([id]) => id)).size).toBe(SECTIONS.length);
  });

  it('every <Section> in the markup is registered, and every registered section is rendered once', () => {
    const rendered = svelte(dir).flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/<Section id="([a-z]+)"/g)].map((m) => m[1]));
    expect([...rendered].sort()).toEqual(SECTIONS.map(([id]) => id).sort());
  });

  it('cross-references go through <Ref>, never a typed number', () => {
    for (const f of svelte(dir)) {
      const text = readFileSync(f, 'utf8');
      expect(text, f).not.toMatch(/section \d/);
      for (const m of text.matchAll(/<Ref to="([a-z]+)"/g)) {
        expect(SECTIONS.map(([id]) => id), `${f}: ${m[1]}`).toContain(m[1]);
      }
    }
  });
});
