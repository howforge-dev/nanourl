// Where things are, for the node-side code (build scripts, unit tests, the
// E2E static server and the specs that read a file off disk).
//
// Each path below is spelled once, here. A path re-derived in every file that
// needs it breaks in as many places as it is spelled, each with its own
// relative prefix to get wrong.
//
// Deliberately in `scripts/`, which `tsconfig.json`, `package.json`'s lint
// glob and `vite.config.ts` already cover: a new top-level file would have to
// be added to three separate directory lists.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSET_DIR } from '../src/lib/assetPath';

/** `web/`: the package root, one level above this file's directory. */
export const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** `web/scripts/`: where the build scripts' own fixtures live. */
export const SCRIPTS_DIR = resolve(WEB_ROOT, 'scripts');

/** The packed asset manifest `task web:assets` writes and `loader.ts` imports.
 *  Gitignored, so every consumer must tolerate it being absent. */
export const ASSETS_JSON = resolve(WEB_ROOT, 'src/lib/assets.json');

/** Vite's static root: copied into `dist/` as it stands. */
export const PUBLIC_DIR = resolve(WEB_ROOT, 'public');

/** Where `pack-assets.ts` writes the chunked model, tokenizer and wasm: the
 *  one folder the site serves everything from (src/lib/assetPath.ts). */
export const PACKED_DIR = resolve(PUBLIC_DIR, ASSET_DIR);

/** `pnpm build`'s output: what `e2e/serve.ts` serves and `sw-update.spec.ts`
 *  patches a fixture into. */
export const DIST_DIR = resolve(WEB_ROOT, 'dist');

/** The built service worker: `build-sw.ts` writes it, `sw-manifest.ts` injects
 *  into it, `sw-update.spec.ts` copies a patched fixture beside it. */
export const SW_JS = resolve(DIST_DIR, 'sw.js');

/** The deploy header policy, in the Cloudflare/Netlify `_headers` format.
 *  `pnpm build` copies it into `dist/`, and `e2e/serve.ts` applies the copy,
 *  so the E2E exercises the file the build actually shipped. */
export const HEADERS_FILE = resolve(WEB_ROOT, '_headers');

/** The nginx translation of the same policy, pinned against `_headers` by
 *  `tests/headers.test.ts`. Outside `web/`, in the repo's tools tree. */
export const NGINX_CONF = resolve(WEB_ROOT, '../tools/web/nginx-nanourl.conf');

/** The generated figures module (`scripts/numbers.ts`'s output). */
export const NUMBERS_TS = resolve(WEB_ROOT, 'src/lib/numbers.ts');


/** The CLI crate's golden directory. `scripts/cli-goldens.ts` writes the two
 *  files there that pin the Rust CLI's link handling to `src/lib/alphabet.ts`;
 *  the Rust side reads them from its own crate root. */
export const CLI_GOLDENS_DIR = resolve(WEB_ROOT, '../rust/nanourl/tests/goldens');

/** `parseLink`/`fragmentFor`/`sniff` over a fixed case list. */
export const CLI_LINK_GOLDEN = resolve(CLI_GOLDENS_DIR, 'link.jsonl');

/** The off-site URLs and example URLs the CLI must agree with. */
export const CLI_CONSTANTS_GOLDEN = resolve(CLI_GOLDENS_DIR, 'cli.json');
