import { describe, it, expect } from 'vitest';
import { DEFAULT_PREVIEW_PORT } from '../e2e/ports';
import { isModelAsset, isShell } from '../src/lib/sw-routes';

const ORIGIN = `http://localhost:${DEFAULT_PREVIEW_PORT}`;
const u = (path: string, origin = ORIGIN) => new URL(path, origin);

describe('isModelAsset', () => {
  it('matches every .bin model/tokenizer/wasm chunk', () => {
    expect(isModelAsset(u('/model.5e37aad1.00.bin'))).toBe(true);
    expect(isModelAsset(u('/tokenizer.6e4f2b4f.json.bin'))).toBe(true);
    expect(isModelAsset(u('/urlcodec.7867d47b.wasm.bin'))).toBe(true);
  });
  it('does not match a shell asset', () => {
    expect(isModelAsset(u('/index.html'))).toBe(false);
    expect(isModelAsset(u('/assets/index-abc123.js'))).toBe(false);
  });
});

describe('isShell', () => {
  it('matches every page and hashed asset', () => {
    expect(isShell(u('/index.html'), ORIGIN)).toBe(true);
    expect(isShell(u('/model.html'), ORIGIN)).toBe(true);
    expect(isShell(u('/assets/index-abc123.js'), ORIGIN)).toBe(true);
    expect(isShell(u('/assets/index-abc123.css'), ORIGIN)).toBe(true);
    expect(isShell(u('/assets/favicon.svg'), ORIGIN)).toBe(true);
    // nothing at the root is the site's any more, the two files that cannot move aside
    expect(isShell(u('/favicon.svg'), ORIGIN)).toBe(false);
  });
  it('never matches a .bin model/tokenizer/wasm asset — the loader owns those', () => {
    expect(isShell(u('/model.5e37aad1.00.bin'), ORIGIN)).toBe(false);
    expect(isShell(u('/urlcodec-mt.be6068c4.wasm.bin'), ORIGIN)).toBe(false);
  });
  it('never matches sw.js itself, even though it is a same-origin .js under /', () => {
    expect(isShell(u('/sw.js'), ORIGIN)).toBe(false);
  });
  it('rejects a cross-origin request for an otherwise shell-shaped URL', () => {
    expect(isShell(u('https://evil.example/index.html'), ORIGIN)).toBe(false);
    expect(isShell(u('https://evil.example/assets/index-abc123.js'), ORIGIN)).toBe(false);
  });
  it('rejects an unrecognised same-origin path (no reason to precache it)', () => {
    expect(isShell(u('/robots.txt'), ORIGIN)).toBe(false);
    expect(isShell(u('/assets/nested/index-abc123.js'), ORIGIN)).toBe(false);
  });
});
