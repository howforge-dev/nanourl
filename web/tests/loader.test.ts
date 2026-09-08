import { describe, it, expect } from 'vitest';
import { assemble, weightsFor, pickWasm, isStaleModelCache, MODEL_CACHE_NAME } from '../src/lib/codec/loader';
import type { AssetEntry, Manifest } from '../src/lib/codec/loader';
import { CHUNK } from '../scripts/pack-lib';

describe('loader', () => {
  it('assembles chunks in order', () => {
    const out = assemble([new Uint8Array([1, 2]), new Uint8Array([3])], 3);
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });
  it('progress weights sum to 1 and follow bytes', () => {
    const w = weightsFor([100, 300], 50, 50);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(w[1]).toBeCloseTo(0.6);
  });
});

// pickWasm takes the manifest as an explicit (defaulted) parameter
// specifically so its fallback branches can be tested against synthetic
// fixtures for all three packing configurations, independent of whatever
// `task web:assets` happens to have packed on this checkout — a checkout
// with only the plain simd128 build (no mt/relaxed targets built yet) is a
// documented, supported configuration (see web/README.md), and its tests
// must be able to pass without ever running `task codec:wasm --mt`.
const entry = (name: string): AssetEntry => ({ name, bytes: 1, sha256: '0'.repeat(64) });

function fakeManifest(opts: { mt?: boolean; relaxed?: boolean }): Manifest {
  return {
    model: { chunks: [], bytes: 0, sha256: '0'.repeat(64), chunkBytes: CHUNK },
    tokenizer: entry('tokenizer.fake.json.bin'),
    wasm: entry('urlcodec.fake.wasm.bin'),
    wasmMt: opts.mt ? entry('urlcodec-mt.fake.wasm.bin') : null,
    wasmRelaxed: opts.relaxed ? entry('urlcodec-relaxed.fake.wasm.bin') : null,
    atlas: null,
    builtAt: 'fake',
    source: { nurl: 'fake', tokenizer: 'fake', git: 'fake' },
  };
}

// The versioned model cache reclaims previous deploys' ~125 MiB, and runs on
// every load — so what it matches has to be exactly what it mints, not a
// `nanourl-` prefix. A prefix match would delete `nanourl-shell-*`, the
// offline shell a sibling branch's service worker owns: the app would still
// work, so the only symptom would be offline support quietly never
// persisting.
describe('isStaleModelCache', () => {
  const current = 'nanourl-5e37aad1';

  it('deletes another deploy\'s model cache', () => {
    expect(isStaleModelCache('nanourl-76d483b3', current)).toBe(true);
  });

  it('keeps this deploy\'s own model cache', () => {
    expect(isStaleModelCache(current, current)).toBe(false);
  });

  it('KEEPS a sibling\'s nanourl-shell-* cache, with both names present', () => {
    // the realistic post-merge state: our bucket, a stale one of ours, and
    // the service worker's shell — only the stale one may go
    const keys = ['nanourl-shell-v1', current, 'nanourl-76d483b3', 'nanourl-shell-2026-09-07'];
    expect(keys.filter((k) => isStaleModelCache(k, current))).toEqual(['nanourl-76d483b3']);
  });

  it('keeps anything that is not exactly nanourl-<8 lowercase hex>', () => {
    for (const key of [
      'nanourl-offline-v2',
      'nanourl-', // the bare prefix
      'nanourl-5e37aad', // 7 chars
      'nanourl-5e37aad12', // 9 chars
      'nanourl-5E37AAD1', // we only ever mint lowercase
      'nanourl-5e37aad1-old', // suffixed
      'xnanourl-5e37aad1', // prefixed
      'workbox-precache',
    ]) {
      expect(isStaleModelCache(key, current), key).toBe(false);
    }
  });

  it('defaults `current` to the name the loader actually uses', () => {
    expect(MODEL_CACHE_NAME).toMatch(/^nanourl-[0-9a-f]{8}$/);
    expect(isStaleModelCache(MODEL_CACHE_NAME)).toBe(false);
  });
});

describe('pickWasm', () => {
  describe('full manifest (mt + relaxed + simd all present)', () => {
    const full = fakeManifest({ mt: true, relaxed: true });
    it('threads > 0 wins outright', () => {
      const r = pickWasm({ relaxed: true, threads: 4 }, full);
      expect(r).toEqual({ entry: full.wasmMt, threads: 4, kind: 'threads' });
    });
    it('relaxed wins when threads is 0', () => {
      const r = pickWasm({ relaxed: true, threads: 0 }, full);
      expect(r).toEqual({ entry: full.wasmRelaxed, threads: 0, kind: 'relaxed' });
    });
    it('simd when neither threads nor relaxed is requested', () => {
      const r = pickWasm({ relaxed: false, threads: 0 }, full);
      expect(r).toEqual({ entry: full.wasm, threads: 0, kind: 'simd' });
    });
  });

  describe('relaxed + simd only (no mt build packed)', () => {
    const noMt = fakeManifest({ mt: false, relaxed: true });
    it('a threads request falls back to relaxed, not simd, and threads is clamped to 0', () => {
      const r = pickWasm({ relaxed: true, threads: 8 }, noMt);
      expect(r).toEqual({ entry: noMt.wasmRelaxed, threads: 0, kind: 'relaxed' });
    });
    it('a threads request with relaxed unavailable falls all the way to simd', () => {
      const r = pickWasm({ relaxed: false, threads: 8 }, noMt);
      expect(r).toEqual({ entry: noMt.wasm, threads: 0, kind: 'simd' });
    });
  });

  describe('simd only (a fresh checkout before task codec:wasm --mt/--relaxed)', () => {
    const simdOnly = fakeManifest({ mt: false, relaxed: false });
    it('a threads request falls all the way to simd', () => {
      const r = pickWasm({ relaxed: true, threads: 8 }, simdOnly);
      expect(r).toEqual({ entry: simdOnly.wasm, threads: 0, kind: 'simd' });
    });
    it('a relaxed request falls all the way to simd', () => {
      const r = pickWasm({ relaxed: true, threads: 0 }, simdOnly);
      expect(r).toEqual({ entry: simdOnly.wasm, threads: 0, kind: 'simd' });
    });
  });

  it('defaults to the real packed manifest when none is given', () => {
    // Smoke check only: whatever this checkout has packed, pickWasm must not
    // throw and must always resolve to *some* entry — the branch-by-branch
    // behavior above is what's actually being tested against fixtures.
    const r = pickWasm({ relaxed: false, threads: 0 });
    expect(r.entry.name).toBeTruthy();
    expect(r.kind).toBe('simd');
  });
});
