// Where everything the site ships lives: one folder under the site root.
//
// Vite already emits its hashed JS and CSS here, and the packed model,
// tokenizer, wasm, atlas and favicon join them, so the zone needs one route
// for the lot instead of one per file family. Nothing else at the root is the
// site's, which is what lets a slug fall through to the shortener.
//
// The packer writes here, the loader fetches from here, the service worker
// decides what to precache from here, and `_headers` makes exactly this
// folder immutable. One spelling, so those five cannot drift apart.
export const ASSET_DIR = 'assets';

/** The path a packed asset is served at, from its name in `assets.json`. */
export const assetUrl = (name: string): string => `/${ASSET_DIR}/${name}`;

/** The favicon, which is not content-hashed, so the name in the HTML is
 *  stable and it is served under the site-wide `no-cache` rule. */
export const FAVICON_NAME = 'favicon.svg';
export const FAVICON_PATH = `${ASSET_DIR}/${FAVICON_NAME}`;
export const FAVICON_URL = `/${FAVICON_PATH}`;
