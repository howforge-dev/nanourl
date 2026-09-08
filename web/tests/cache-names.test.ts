import { describe, it, expect } from 'vitest';
import { isModelCache, isShellCache, MODEL_CACHE_PREFIX, SHELL_CACHE_PREFIX } from '../src/lib/codec/cacheNames';

// The single source of truth for cache-name prefixes: sw.ts (shell cache)
// and loader.ts (model cache) both import from here, so each predicate must
// never match the other's cache shape.
describe('cache name prefixes', () => {
  it('SHELL_CACHE_PREFIX extends MODEL_CACHE_PREFIX — documents exactly the collision this module exists to prevent', () => {
    expect(SHELL_CACHE_PREFIX.startsWith(MODEL_CACHE_PREFIX)).toBe(true);
  });
});

describe('isModelCache', () => {
  it('matches nanourl-<8 hex chars>', () => {
    expect(isModelCache('nanourl-5e37aad1')).toBe(true);
  });
  it('never matches a shell cache, even though both share the nanourl- root', () => {
    expect(isModelCache('nanourl-shell-f14b849b')).toBe(false);
  });
  it('rejects the legacy unversioned name and malformed suffixes', () => {
    expect(isModelCache('nanourl')).toBe(false);
    expect(isModelCache('nanourl-abc')).toBe(false); // too short
    expect(isModelCache('nanourl-abcdef123')).toBe(false); // too long
    expect(isModelCache('nanourl-zzzzzzzz')).toBe(false); // not hex
  });
});

describe('isShellCache', () => {
  it('matches nanourl-shell-<8 hex chars>', () => {
    expect(isShellCache('nanourl-shell-f14b849b')).toBe(true);
  });
  it('never matches a model cache', () => {
    expect(isShellCache('nanourl-5e37aad1')).toBe(false);
  });
  it('rejects malformed suffixes', () => {
    expect(isShellCache('nanourl-shell-')).toBe(false);
    expect(isShellCache('nanourl-shell-abc')).toBe(false);
  });
});
