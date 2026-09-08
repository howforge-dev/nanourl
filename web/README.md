# web

The nanourl site: Vite + Svelte 5 + TypeScript, built as a static bundle
around a WebAssembly build of `rust/urlcodec`. The model runs in the browser,
offline after one download. Pages: `index.html` (compressor), `dream.html`
(batch sampler), `learn.html` (how it works), `model.html` (observatory),
`bench.html` (kernel benchmark).

## Commands

| command | what it does |
|---|---|
| `task web:assets` | chunk and hash the model, tokenizer, wasm tiers and atlas into `public/`, write `src/lib/assets.json` |
| `pnpm exec tsx scripts/numbers.ts` | regenerate `src/lib/numbers.ts` from the run manifest, the eval and the artifact |
| `task web:build` | `codec:wasm`, then `web:assets`, then `vite build` into `dist/` |
| `pnpm dev` | Vite dev server (run `web:assets` once first) |
| `pnpm test` | svelte-check, eslint, vitest |
| `pnpm exec playwright test` | Playwright against a real build served with `dist/_headers` |

`web:build` runs its steps in order, not as parallel deps: `web:assets`
reads the wasm files `codec:wasm` writes.

## The artifact set

`task web:assets` cuts the `.nurl` model into 8 MiB chunks, content-hashes
every file into `public/*.bin` and records the hashes in `assets.json`. A
hashed name is a new URL, so browsers and CDNs cache `.bin` files forever
and never serve a stale one. The three wasm tiers come from `task
codec:wasm` and must match `rust/urlcodec/wasm.sha256`; on a machine that is
not the pin's architecture, build for development with `UNPINNED=1`.

The atlas (`atlas/atlas.bin`, built by `training.atlas`) feeds the
observatory's atlas panel. `pack-assets` picks it up automatically and
refuses to drop one the previous manifest had.

`src/lib/numbers.ts` is generated, never hand-edited. It records the sha256 of
the artifact it was computed from, and `tests/assets-sync.test.ts` fails when
that is not the artifact `web:assets` packed. Two runs of one config produce
artifacts of identical size with different weights, so this check is the
only thing keeping the learn page's figures and the shipped weights together.
Run both `web:numbers` and `web:assets` whenever a new artifact lands.

## Adding a page

1. Add a row to `PAGES` in `src/lib/pages.ts`: id, href, menu name, page
   name, tagline, and `width: 'wide'` for canvases and tables.
2. Add `src/pages/<id>/` with `main.ts` and `App.svelte`.

The `pages` plugin in `vite.config.ts` writes `<id>.html` from one template
and derives the build inputs from the same list. The root `*.html` files are
generated and gitignored. `PageHeader.svelte` renders the same record, so the
tab title, the meta description and the header cannot disagree. Restart the
dev server after changing `PAGES`.

## Deploy

`dist/` is a plain static site. Any host that serves files over HTTPS and can
set response headers works.

- **Cloudflare Worker (assets only).** `wrangler deploy` with the repo's
  `wrangler.toml`. `_headers` and `_redirects` are copied into `dist/` by the
  build and applied by the platform. Netlify reads the same files.
- **nginx.** `tools/web/nginx-nanourl.conf` mirrors `_headers`; fill in
  `server_name` and the certificate paths. `tests/headers.test.ts` parses both
  files and compares the headers per path, so they cannot drift apart.

Every response needs:

- `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp`. Without them the page is not
  cross-origin isolated, `SharedArrayBuffer` is unavailable, and the threads
  tier silently falls back to a single-thread one.
- `Cache-Control: public, max-age=31536000, immutable` on `.bin` files and
  `no-cache` with an ETag on everything else, so a deploy reaches returning
  visitors on their next load.
- `application/wasm` for `*.wasm.bin` and `application/json` for `*.json.bin`
  where the host sets types from the file name. The loader compiles wasm from
  bytes and never depends on the type.
- Byte ranges, so an interrupted model download resumes.

HTTPS is required, not just recommended. Over plain HTTP `crypto.subtle` is
missing, so the loader cannot verify chunks and refuses to load;
`SharedArrayBuffer` and the Cache API are unavailable too.

## Offline

Two caches make every page work with the network off:

- `src/lib/codec/loader.ts` keeps the model chunks, tokenizer and wasm in the
  Cache API under a cache named for the model's digest, sha256-verified on
  every read.
- `src/sw.ts` (built to `dist/sw.js`) precaches the page shell, every `.html`
  entry, the hashed JS and CSS, and the favicon, under `nanourl-shell-<build>`.
  It never touches `.bin` requests.

A new build gets a new shell cache. When the new worker activates, open tabs
show "a new version is ready, reload" in `BuildInfo.svelte`. Nothing reloads
on its own, since that would interrupt an encode in progress. `/sw.js` is
served `no-cache` so the browser's update check always sees the current file.

## Tiers

`src/lib/codec/tier.ts` picks a wasm build and a worker count at load time.

| tier | needs |
|---|---|
| simd128 | any modern wasm engine; the universal fallback |
| relaxed-simd | Chrome 114+, Firefox 120+; feature-probed |
| threads, `min(cores - 1, 4)` workers | cross-origin isolation |

The order of preference is threads, relaxed, simd. If the threads tier fails
at runtime (memory allocation, worker spawn, the ready handshake, the
self-test), `Codec.load` retries with threads off, and a relaxed failure
retries on simd. The site stores no timings: `/bench.html` measures the
device reading it, and only there do `?tier=simd|relaxed|threads&w=N`
override detection.

## Tests

`web:e2e` needs `web:assets` first, because the smoke specs load the real
codec. Specs run under two Playwright projects, `mobile` (375x667, touch) and
`desktop` (1280x800). The server is `e2e/serve.ts`, which applies
`dist/_headers` verbatim, so the header surface is tested rather than
assumed. It binds port 4173; set `PW_PORT` when a sibling checkout holds it.
