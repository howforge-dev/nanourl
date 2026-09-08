// Golden fixture generated straight from the wasm codec (rust/urlcodec's
// codec_encode, alphabet=base64url). If this ever fails, the JS replica has
// drifted from rust/urlcodec/src/coder.rs; do not "fix" the test by
// loosening the comparison.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { replay, headerBits } from '../src/lib/coderReplay';
import type { Tok } from '../src/lib/codec/types';

const here = dirname(fileURLToPath(import.meta.url));
interface Golden {
  url: string;
  version: number;
  coded: string;
  bitstr: string;
  tokens: Tok[];
}
const fixtures: Record<string, Golden> = JSON.parse(readFileSync(resolve(here, 'fixtures/coder.json'), 'utf-8'));

describe('coderReplay', () => {
  it('reproduces the wasm bitstr EXACTLY (including the finish() flush) for a real encoded URL', () => {
    const g = fixtures['https://news.ycombinator.com/item?id=1'];
    const r = replay(g.tokens, g.version);
    // per-token emitted-bit counts must match the wasm's own reported state
    g.tokens.forEach((t, i) => {
      expect(r.steps[i].emitted).toBe(t.emit);
      expect(r.steps[i].pend).toBe(t.pend);
    });
    // coder.rs's finish(): pending += 1; emit(low < QUARTER ? 0 : 1) — always
    // writes exactly 2 + (last token's pend) bits (the settle bit plus
    // pend+1 flipped deferred bits)
    const lastPend = g.tokens[g.tokens.length - 1].pend ?? 0;
    expect(r.finish.flush).toBe(lastPend + 1);
    expect(r.bitstr.length - (r.steps[r.steps.length - 1].emitted)).toBe(2 + lastPend);
    // the full stream, bit for bit — not just a prefix
    expect(r.bitstr).toBe(g.bitstr);
  });

  it('reproduces the wasm bitstr EXACTLY on a second, longer URL', () => {
    const g = fixtures['https://en.wikipedia.org/wiki/Solar_eclipse_of_August_12,_2026'];
    const r = replay(g.tokens, g.version);
    g.tokens.forEach((t, i) => {
      expect(r.steps[i].emitted).toBe(t.emit);
    });
    expect(r.bitstr).toBe(g.bitstr);
  });

  it('rejects a stream version it has no replica for', () => {
    expect(() => replay([], 1)).toThrow();
  });

  it('headerBits matches coder.rs version_header for every tier', () => {
    expect(headerBits(0)).toBe('00');
    expect(headerBits(1)).toBe('01');
    expect(headerBits(2)).toBe('10');
    expect(headerBits(3)).toBe('11000000'); // e = 0
    expect(headerBits(65)).toBe('11' + (62).toString(2).padStart(6, '0'));
    expect(headerBits(66)).toBe('11111111' + '00000000'); // f = 0
    expect(headerBits(320)).toBe('11111111' + (254).toString(2).padStart(8, '0'));
  });
});
