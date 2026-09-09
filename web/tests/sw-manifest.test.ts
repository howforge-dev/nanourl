import { describe, it, expect } from 'vitest';
import { buildId, shellFiles } from '../scripts/sw-manifest-lib';

// A fixture dist/ file listing (flat, dist-relative: what scripts/sw-
// manifest.ts's walk() would hand shellFiles after a real `vite build` +
// build-sw.ts), covering every case that matters: pages, hashed JS/CSS, a
// favicon, model/tokenizer/wasm .bin chunks (must be excluded), sw.js itself
// (must be excluded), and a nested assets path (must be excluded: Vite
// never nests, but the predicate shouldn't assume that blindly).
const FIXTURE_DIST = [
  'index.html',
  'model.html',
  'learn.html',
  'dream.html',
  'bench.html',
  'assets/favicon.svg',
  'sw.js',
  'assets/index-abc123.js',
  'assets/index-abc123.css',
  'assets/model-def456.js',
  'assets/nested/should-not-match.js',
  'model.5e37aad1.00.bin',
  'tokenizer.6e4f2b4f.json.bin',
  'urlcodec.7867d47b.wasm.bin',
];

describe('shellFiles', () => {
  it('keeps every html page and everything hashed under assets/, favicon included', () => {
    const shell = shellFiles(FIXTURE_DIST);
    expect(shell).toEqual([
      '/assets/favicon.svg',
      '/assets/index-abc123.css',
      '/assets/index-abc123.js',
      '/assets/model-def456.js',
      '/bench.html',
      '/dream.html',
      '/index.html',
      '/learn.html',
      '/model.html',
    ]);
  });
  it('excludes sw.js, .bin assets, and a nested assets path', () => {
    const shell = shellFiles(FIXTURE_DIST);
    expect(shell).not.toContain('/sw.js');
    expect(shell.some((p) => p.endsWith('.bin'))).toBe(false);
    expect(shell).not.toContain('/assets/nested/should-not-match.js');
  });
  it('includes assets.json only when the build actually wrote one', () => {
    expect(shellFiles(FIXTURE_DIST)).not.toContain('/assets.json');
    expect(shellFiles([...FIXTURE_DIST, 'assets.json'])).toContain('/assets.json');
  });
  it('is order-independent — readdir order in, sorted list out', () => {
    const shuffled = [...FIXTURE_DIST].reverse();
    expect(shellFiles(shuffled)).toEqual(shellFiles(FIXTURE_DIST));
  });
});

describe('buildId', () => {
  it('is deterministic for the same file list', () => {
    const shell = shellFiles(FIXTURE_DIST);
    expect(buildId(shell)).toBe(buildId(shell.slice()));
  });
  it('changes when the shell file list changes', () => {
    const before = buildId(shellFiles(FIXTURE_DIST));
    const after = buildId(shellFiles([...FIXTURE_DIST, 'assets/new-ghi789.js']));
    expect(after).not.toBe(before);
  });
  it('is an 8-character lowercase hex string, matching pack-lib.ts hashName convention', () => {
    expect(buildId(shellFiles(FIXTURE_DIST))).toMatch(/^[0-9a-f]{8}$/);
  });
});
