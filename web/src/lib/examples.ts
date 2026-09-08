// The four canonical example URLs shown on the compressor page's "try:" row
// (src/lib/ui/Examples.svelte), one source of truth so the bench page's
// cross-tier bit-identity check (web/src/pages/bench/App.svelte) can reuse
// exactly the same URLs, including the "nytimes" one used for the timing
// bench, without the two ever drifting apart.
// `as const`: this is the one shared source of truth (Examples.svelte's
// "try:" buttons, the bench page's timing target and its cross-tier
// bit-identity check), readonly so no consumer can mutate it out from
// under the others.
export const EXAMPLE_URLS = [
  ['wikipedia', 'https://en.wikipedia.org/wiki/Solar_eclipse_of_August_12,_2026'],
  ['HN', 'https://news.ycombinator.com/item?id=44567890'],
  ['github', 'https://github.com/karpathy/nanoGPT/blob/master/train.py'],
  ['nytimes', 'https://www.nytimes.com/2026/08/12/science/solar-eclipse-europe-viewing.html'],
] as const satisfies readonly (readonly [string, string])[];

/** The one whose encode the bench page times, and whose forward pass the
 *  observatory prefills. Named rather than found by index so a reordering of
 *  the list above cannot silently change which URL is benchmarked. */
export const BENCH_URL: string = EXAMPLE_URLS.find(([name]) => name === 'nytimes')![1];

/** The placeholder in every URL input on the site: the compressor's textarea
 *  and the observatory's. */
export const PLACEHOLDER_URL = 'https://example.com/some/long/url?with=params';

/**
 * The learn page's worked example, pinned separately from `EXAMPLE_URLS`.
 *
 * DELIBERATELY a different HN story id from the "HN" entry above: every figure
 * on the learn page (the token walk-through, the per-token bit costs, the
 * zip comparison, the coder trace) is measured against this exact URL by
 * `scripts/numbers.ts` and baked into `src/lib/numbers.ts`, so it cannot
 * follow a change to the compressor's "try:" row.
 */
export const WORKED_EXAMPLE_URL = 'https://news.ycombinator.com/item?id=38000000';

/** A trivial, fixed URL the codec encodes once right after `codec_init`, to
 *  confirm an instance that compiled and initialized can do work. */
export const SELF_TEST_URL = 'https://example.com/';
