// Pure logic for scripts/sw-manifest.ts, split out so vitest can exercise it
// against a fixture file listing without touching a real dist/ (same split
// as pack-lib.ts/numbers-lib.ts); see tests/sw-manifest.test.ts.
import { createHash } from 'node:crypto';

/** Which dist/-relative paths belong in the service worker's shell precache:
 * every `.html` page, every hashed JS/CSS Vite emits under `assets/`, the
 * favicon if this build has one, and `assets.json` if a future build ever
 * writes one to dist as a real file (today it does not: Vite's JSON import
 * inlines src/lib/assets.json straight into the JS bundles, so there is no
 * dist/assets.json to precache, and this checks for it conditionally rather
 * than assuming that never changes).
 *
 * `sw.js` is always excluded: precaching the worker's own script would hide
 * its own updates from the browser's update check, which relies on always
 * refetching `/sw.js` off the network; see web/_headers' `Cache-Control:
 * no-cache` rule for it. Every `.bin` model/tokenizer/wasm asset is likewise
 * excluded (src/lib/codec/loader.ts owns those in its own cache), even
 * though no filename below would ever collide with the patterns matched
 * here.
 *
 * Takes a flat list (e.g. from a recursive readdir) rather than reading the
 * filesystem itself, and returns paths sorted and prefixed with `/`. The sort
 * keeps the build id derived from this list (buildId, below) independent of
 * readdir's own unspecified order. */
export function shellFiles(distRelativePaths: string[]): string[] {
  const keep = distRelativePaths.filter((p) => {
    if (p === 'sw.js' || p.endsWith('.bin')) return false;
    if (p.endsWith('.html')) return true;
    if (/^assets\/[^/]+\.(js|css|svg)$/.test(p)) return true;
    if (p === 'assets.json') return true;
    return false;
  });
  return Array.from(new Set(keep))
    .sort()
    .map((p) => `/${p}`);
}

/** A short, deterministic build id: sha256 of the sorted shell file list
 * (already content-hashed filenames from Vite, so this changes whenever any
 * shell file's content or presence does), truncated to 8 hex chars, the
 * same convention scripts/pack-lib.ts's hashName uses for asset names. Used
 * both as the shell cache's name suffix (`nanourl-shell-<build>`) and as
 * `self.__BUILD__`. */
export function buildId(shell: string[]): string {
  return createHash('sha256').update(shell.join('\n')).digest('hex').slice(0, 8);
}
