// Wall-clock budgets the specs share.
//
// `180_000` covers "download ~125 MiB from a local static server, compile and
// instantiate the wasm, spawn and barrier up to 8 compute workers, then run a
// first encode", under this suite's own parallelism (see
// `playwright.config.ts`'s `workers`). Changing it is one edit.
export const MODEL_LOAD = 180_000;

/** A model-load that is expected to be a warm Cache API restore rather than a
 *  cold download: same steps, none of the bytes. */
export const MODEL_RELOAD = 60_000;

/** One encode or decode on an already-loaded codec. Not the default 5 s: this
 *  is real wasm work (a full forward pass per token), and under this suite's
 *  own parallelism it is the assertion that starves first. */
export const CODEC_CALL = 30_000;

/** A sampling / batch run on an already-loaded codec. */
export const SAMPLE = 60_000;

/** A model panel's own first-open work (a slice fetch, a UMAP draw, a trace
 *  RPC) once the model itself is ready. */
export const PANEL = 20_000;

/** A service worker reaching `active` after a first load. */
export const SW_ACTIVE = 60_000;

/** A second build's worker reaching `waiting` (installed, not activated). */
export const SW_WAITING = 30_000;

/** The "a new version is ready" banner appearing once a worker is waiting:
 *  a render, not a network round trip. */
export const SW_UPDATE_BANNER = 10_000;
