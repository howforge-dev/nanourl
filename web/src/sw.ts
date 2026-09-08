/// <reference lib="webworker" />
// The offline shell. Precaches the page shell (HTML, hashed JS/CSS,
// favicon) into its own cache so every page opens with the network off after
// one visit — the model/tokenizer/wasm chunks are NOT this worker's concern,
// they already persist via src/lib/codec/loader.ts's own Cache API cache
// (see ./lib/codec/cacheNames.ts for the shared naming convention that keeps
// the two caches' cleanup sweeps from colliding), sha256-verified on every
// read, which this worker must never shadow or race: every `.bin` request
// (isModelAsset) passes straight through untouched (`return` without
// `respondWith`, i.e. the browser's normal fetch — which the page's own
// `fetch()` calls in loader.ts drive).
//
// Built to dist/sw.js by scripts/build-sw.ts (a plain Vite lib-mode bundle,
// iife format — no `{ type: 'module' }`, so `register('/sw.js')` from every
// page's registerSw.ts works with no extra options). scripts/sw-manifest.ts
// then injects `self.__SHELL__` (every dist/ shell file, site-absolute) and
// `self.__BUILD__` (a short sha of that list) as two plain assignments
// prepended ahead of this bundle's own code — see that script for how the
// list and id are derived (unit tested against a fixture, not a real dist/).
//
// Update flow: install never
// calls self.skipWaiting() — a newly installed worker parks itself as
// `registration.waiting` and the standard lifecycle applies: it only
// activates once every client of the *previous* worker has naturally
// dropped off, so a background deploy can never yank an open tab out from
// under whatever the visitor is doing mid-encode. The only other path to
// activation is explicit: BuildInfo.svelte's "reload" button posts
// SKIP_WAITING_MESSAGE (./lib/sw-messages.ts) to the waiting worker, whose
// `message` handler below is the only thing that ever calls skipWaiting();
// activate then runs, claims every open client (`clients.claim()`), and
// only *after* that — once this worker genuinely controls every client that
// could have been reading an old cache entry — deletes every other shell
// cache. BuildInfo's `controllerchange` listener reloads the page once that
// handoff has actually completed, never before.
import { isModelAsset, isShell } from './lib/sw-routes';
import { isSkipWaitingMessage } from './lib/sw-messages';
import { SHELL_CACHE_PREFIX, isShellCache } from './lib/codec/cacheNames';

declare const self: ServiceWorkerGlobalScope & { __SHELL__: string[]; __BUILD__: string };

const CACHE = `${SHELL_CACHE_PREFIX}${self.__BUILD__}`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(self.__SHELL__)));
});

self.addEventListener('message', (event) => {
  if (isSkipWaitingMessage(event.data)) self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Claim first: only once this worker genuinely controls every open
      // client is it safe to delete another shell cache — otherwise some
      // other still-controlling worker instance could be mid-fetch against
      // the entry this is about to remove.
      await self.clients.claim();
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => isShellCache(k) && k !== CACHE).map((k) => caches.delete(k)));
    })(),
  );
});

// Every match below passes { ignoreVary: true }: vite preview (this
// project's own e2e webServer, and possibly a real CDN/host too) answers
// with `Vary: Origin` on same-origin requests, and Cache API's match keys on
// that header by default (ignoreVary defaults to false, i.e. Vary IS
// honoured) — so a precached entry (stored from a plain same-origin fetch()
// during install, no Origin header) would silently miss against a real
// browser subresource request that does carry one (e.g. a
// `<script crossorigin>` tag's module fetch), falling through to the
// network and failing outright once actually offline. This project owns
// every entry in this cache outright (install populated it from this exact
// build's own file list) and never wants content negotiation on it, so
// ignoring Vary here is correct, not just a workaround.
const MATCH_OPTS: CacheQueryOptions = { ignoreVary: true };

/** Cache-first, network-fallback with write-back — the "shell asset" fetch
 * strategy (hashed JS/CSS, favicon): a cache hit is served as-is (Cache API
 * preserves the original response's headers, so a precached response still
 * carries COOP/COEP — see e2e/offline.spec.ts's crossOriginIsolated
 * assertion), and a miss is fetched, cached for next time, and returned. */
async function shellResponse(req: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, MATCH_OPTS);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await cache.put(req, res.clone());
  return res;
}

/** Network-first, cache fallback — the navigation strategy. A page served
 * from the precache would keep showing the previous deploy's shell (with its
 * previous hashed asset names) until the waiting worker was activated, so
 * online navigations go to the network and refresh the cached copy; the
 * precached copy serves only when the network fails or stalls (offline, or
 * a flaky link — hence the timeout). `/` is a real navigation URL whose
 * served file is `index.html`, so it maps onto that precache key. */
const NAVIGATE_TIMEOUT_MS = 4000;

async function navigateResponse(req: Request): Promise<Response> {
  const cache = await caches.open(CACHE);
  const url = new URL(req.url);
  const key = url.pathname === '/' ? '/index.html' : url.pathname;
  const cached = async () => (await cache.match(key, MATCH_OPTS)) ?? (await cache.match(req, MATCH_OPTS));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NAVIGATE_TIMEOUT_MS);
  try {
    const res = await fetch(req, { signal: ctrl.signal });
    if (res.ok) await cache.put(key, res.clone());
    return res;
  } catch {
    const hit = await cached();
    if (hit) return hit;
    return fetch(req); // no cached copy: let the browser show its own error
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.mode === 'navigate') {
    event.respondWith(navigateResponse(req));
    return;
  }
  const url = new URL(req.url);
  if (isModelAsset(url)) return; // loader.ts's own cache owns these
  if (!isShell(url, self.location.origin)) return; // cross-origin, sw.js, or anything unrecognised — leave to the browser
  event.respondWith(shellResponse(req));
});
