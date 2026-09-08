// `data-testid` values, spelled once for the markup that emits them and the
// E2E specs that look for them.
//
// A testid is a contract between two trees that never compile together: a
// component renames its testid, the spec keeps querying the old one, and
// Playwright's "expected 1, received 0" points at the spec rather than at the
// rename. Worse are the assertions that stay *green*: `toHaveCount(0)` and
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
  /** The Advanced disclosure of either pane. The QR disclosure sits above it
   *  in the Encode pane, so a bare `summary` locator is two elements. */
  advanced: 'advanced',
  decodedUrl: 'decoded-url',
  redirectOverlay: 'redirect-overlay',
  redirectTarget: 'redirect-target',
  redirectCancel: 'redirect-cancel',
  redirectNote: 'redirect-note',
  outlive: 'outlive',
  /** The online short link: its button, the minted link's row, the widget's
   *  box and the inline error. */
  shortLinkButton: 'short-link-button',
  shortLink: 'short-link',
  shortLinkWidget: 'short-link-widget',
  shortLinkError: 'short-link-error',
  /** Which link the QR carries when a short one exists too. */
  qrTarget: 'qr-target',
  /** The QR disclosure, its rendered symbol's box, the text it encodes, its
   *  version/segment line, its inline errors and warning, the label count,
   *  and the two export links. */
  qr: 'qr',
  qrSvg: 'qr-svg',
  qrPreview: 'qr-preview',
  qrText: 'qr-text',
  qrInfo: 'qr-info',
  qrError: 'qr-error',
  qrWarning: 'qr-warning',
  qrLabelCount: 'qr-label-count',
  qrLabelError: 'qr-label-error',
  qrDownload: 'qr-download',
  qrSvgDownload: 'qr-svg-download',
  qrCopy: 'qr-copy',
  qrDarkNote: 'qr-dark-note',
  qrInvert: 'qr-invert',
  qrImageError: 'qr-image-error',
  qrImageWarning: 'qr-image-warning',
  qrModeNote: 'qr-mode-note',
  qrImageFile: 'qr-image-file',
  qrOffer: 'qr-offer',
  qrUnscannable: 'qr-unscannable',
  qrSwitch: 'qr-switch',
  qrReset: 'qr-reset',
  /** One per explained control, on the "?" of `Hint`. */
  hint: 'hint',
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
