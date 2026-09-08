// Shared Cache API naming/predicates for both caches this project uses: the
// loader's own model/tokenizer/wasm cache (owned by loader.ts, named
// `nanourl-<8-hex artifact sha>` once the sibling web-app worktree's
// cache versioning changes) and
// the offline shell precache (owned by src/sw.ts, named
// `nanourl-shell-<8-hex build id>`, scripts/sw-manifest.ts). Centralized
// here — rather than the `'nanourl-shell-'` prefix being duplicated as a
// literal string in sw.ts, loader.ts and the E2E — specifically so a
// cleanup sweep in either cache's own code can use its own predicate rather
// than a naive `startsWith('nanourl-')` check, which would delete the
// *other* cache too (both share that root prefix).
export const MODEL_CACHE_PREFIX = 'nanourl-';
export const SHELL_CACHE_PREFIX = 'nanourl-shell-';

/** A loader.ts model/tokenizer/wasm cache: `nanourl-<8-hex artifact sha>`.
 * The regex requires the suffix to be exactly 8 hex characters, which a
 * shell cache's `shell-<build>` suffix never is (`s`/`h`/`l` aren't hex
 * digits) — so this and isShellCache below are mutually exclusive without
 * needing an explicit carve-out for either. */
export function isModelCache(name: string): boolean {
  return /^nanourl-[0-9a-f]{8}$/.test(name);
}

/** An sw.ts shell precache: `nanourl-shell-<8-hex build id>`. */
export function isShellCache(name: string): boolean {
  return /^nanourl-shell-[0-9a-f]{8}$/.test(name);
}
