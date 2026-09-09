// Pure fetch-routing predicates for src/sw.ts's fetch handler, split out
// (same pattern as codec/loader.ts's pickWasm) so vitest can exercise every
// case without a real ServiceWorkerGlobalScope: see tests/sw-routes.test.ts.

/** A model/tokenizer/wasm asset owned by src/lib/codec/loader.ts's own Cache
 * API cache ("nanourl"). Every one of them is content-hashed with a `.bin`
 * suffix (scripts/pack-assets.ts), on purpose (see web/README.md's "why
 * `.bin`" note), which doubles as an easy, exact test for "the loader owns
 * this, the shell worker must never touch it". */
export function isModelAsset(url: URL): boolean {
  return url.pathname.endsWith('.bin');
}

/** A precached page-shell asset the service worker should serve cache-first:
 * same-origin HTML, and the hashed JS/CSS and the favicon under `/assets/`.
 * Deliberately excludes:
 *  - `/sw.js` itself, because precaching the worker's own script would hide
 *    its own updates from the browser's update check, which depends on always
 *    refetching `/sw.js` off the network (web/_headers pins it
 *    `Cache-Control: no-cache` for exactly this reason);
 *  - any `.bin` model asset (isModelAsset above), belt-and-suspenders, since
 *    no current filename collides with the patterns below anyway;
 *  - cross-origin requests, because this worker's scope is same-origin only,
 *    but a request built by hand (as the unit tests do) can still carry a
 *    foreign origin, so this checks explicitly rather than assuming the
 *    caller already filtered it.
 */
export function isShell(url: URL, origin: string): boolean {
  if (url.origin !== origin) return false;
  if (url.pathname === '/sw.js') return false;
  if (isModelAsset(url)) return false;
  return /\.html$/.test(url.pathname) || /^\/assets\/[^/]+\.(js|css|svg)$/.test(url.pathname);
}
