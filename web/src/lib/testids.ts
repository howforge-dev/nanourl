// `data-testid` values, spelled once for the markup that emits them and the
// E2E specs that look for them.
//
// A testid is a contract between two trees that never compile together: a
// component renames its testid, the spec keeps querying the old one, and
// Playwright's "expected 1, received 0" points at the spec rather than at the
// rename. Worse are the assertions that stay *green* — `toHaveCount(0)` and
// `not.toBeVisible()` both pass against a selector that matches nothing.
//
// Both sides import from here instead, so a rename is a TypeScript error in
// every consumer.
export const TESTID = {
  // compressor (src/pages/index)
  paneEncode: 'pane-encode',
  paneDecode: 'pane-decode',
  roundtrip: 'roundtrip',
  redirectLink: 'redirect-link',
  decodedUrl: 'decoded-url',
  redirectOverlay: 'redirect-overlay',
  redirectTarget: 'redirect-target',
  redirectCancel: 'redirect-cancel',
  redirectNote: 'redirect-note',
  outlive: 'outlive',
  // dream (src/pages/dream)
  dreamResults: 'dream-results',
  dreamUrl: 'dream-url',
  // bench (src/pages/bench)
  kernel: 'kernel',
  degradedFrom: 'degraded-from',
  msPerToken: 'ms-per-token',
  msPerUrl: 'ms-per-url',
  exampleCodes: 'example-codes',
  /** The tier sweep's button. Addressed by id, not by its label: the label is
   *  "running…" for as long as the sweep takes, so a locator that matches on
   *  it finds nothing exactly when the test is waiting for the sweep to end. */
  runAllTiers: 'run-all-tiers',
  // shell update prompt (src/lib/ui/BuildInfo.svelte)
  swUpdateBanner: 'sw-update-banner',
} as const;

/** The bench page's per-example code cell, one per `EXAMPLE_URLS` entry. Built
 *  in both the markup and the spec that diffs two tiers' codes, so the
 *  template lives here rather than being written `code-${name}` twice. */
export const codeTestId = (name: string): string => `code-${name}`;

/** The bench page's per-tier result row in the "run all tiers" table. */
export const rowTestId = (label: string): string => `row-${label}`;

/** `[data-testid="…"]`, for a Playwright/`querySelector` locator. */
export const testIdSelector = (id: string): string => `[data-testid="${id}"]`;
