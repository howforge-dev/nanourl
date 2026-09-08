// Shared E2E scaffolding: the console/page-error watch, the "this page is
// ready" waits, and the small locator recipes more than one spec needs.
//
// Nine byte-identical copies of `watchForErrors` and six of the "model ready"
// wait is more than noise: every copy is a place the contract can drift
// silently. `#status`/`'model ready'` in particular is a *contract* between
// `Status.svelte` and six specs, and a spec asserting a string the page no
// longer renders fails as a timeout pointing at the spec.
import { parseLink } from '../src/lib/alphabet';
import { expect } from 'playwright/test';
import type { Locator, Page } from 'playwright/test';
import { EXAMPLE_URLS } from '../src/lib/examples';
import { TESTID, testIdSelector } from '../src/lib/testids';
import * as T from './timeouts';
import { DESKTOP, MOBILE } from './viewports';

export { TESTID, testIdSelector };

/** Chromium's own network-stack console line for a request that failed. It is
 *  a browser notice, not an application `console.error`, so a spec that
 *  deliberately breaks a request (offline mode, an aborted route) allows it
 *  by name, rather than by dropping the whole assertion. */
export const NETWORK_FAILURE = /Failed to load resource/;

export interface ErrorWatch {
  /** Everything captured so far, in order, for a bespoke assertion. */
  readonly errors: string[];
  /** Capture from another page into the same sink (a `context.newPage()`). */
  also(page: Page): void;
  /** Assert nothing was logged. `allow` names the lines a test deliberately
   *  provokes; anything else is still a failure. */
  expectClean(allow?: readonly RegExp[]): void;
}

/**
 * Fail the test on any uncaught exception or `console.error`, from this page
 * and any page later added with `also()`.
 *
 * Deliberately not a Playwright fixture: several specs watch a second page
 * they create mid-test, and a fixture cannot see those.
 */
export function watchErrors(page: Page): ErrorWatch {
  const errors: string[] = [];
  const attach = (p: Page): void => {
    p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    p.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });
  };
  attach(page);
  return {
    errors,
    also: attach,
    expectClean(allow: readonly RegExp[] = []) {
      expect(errors.filter((e) => !allow.some((re) => re.test(e)))).toEqual([]);
    },
  };
}

/** The compressor / dream / observatory ready signal: `Status.svelte`'s
 *  `#status` line reaching "model ready". `timeout` is `MODEL_RELOAD` for a
 *  load that is expected to be a warm Cache API restore rather than a cold
 *  download: same steps, none of the bytes. */
export const waitForModelReady = (page: Page, timeout: number = T.MODEL_LOAD): Promise<void> =>
  expect(page.locator('#status')).toContainText('model ready', { timeout });

/**
 * The bench page's ready signal.
 *
 * bench.html never shows "model ready"; its Status line reads
 * "loaded: <kernel>" instead (see bench/App.svelte's `statusText`). Wait for
 * `example-codes`, not `kernel`: `onMount` sets `kernelLabel` (which un-hides
 * the kernel testid) via `benchOnce()`, *before* `codes` (which un-hides
 * `example-codes`, holding the four encoded strings, often the page's widest
 * content) is set by the subsequent `codesFor()` call. `example-codes` is
 * still hidden at the moment `kernel` becomes visible, so measuring overflow
 * right after `kernel` would miss real overflow introduced later in the DOM.
 */
export const waitForBenchReady = (page: Page): Promise<void> =>
  expect(page.locator(testIdSelector(TESTID.exampleCodes))).toBeVisible({ timeout: T.MODEL_LOAD });

/** Open the bench page on a forced tier and wait for it to report a kernel.
 *  `query` appends the page's other dev hooks (`&w=3`, `&mtfail=…`). */
export async function openBench(page: Page, tier: 'simd' | 'relaxed' | 'threads', query = ''): Promise<Locator> {
  await page.goto(`/bench.html?tier=${tier}${query}`);
  const kernel = page.locator(testIdSelector(TESTID.kernel));
  await expect(kernel).toBeVisible({ timeout: T.MODEL_LOAD });
  return kernel;
}

/** The number a `.stat`-style cell leads with: "9.571 ms/token" -> 9.571. */
export async function readNumber(locator: Locator): Promise<number> {
  const text = (await locator.textContent()) ?? '';
  return Number(text.match(/[\d.]+/)?.[0]);
}

/** Click the compressor's first "try:" example and wait for a code plus a
 *  passing round-trip. Returns the URL that was filled in and the code. */
export async function encodeFirstExample(page: Page): Promise<{ url: string; code: string }> {
  const pane = page.locator(testIdSelector(TESTID.paneEncode));
  const linkBox = pane.locator(testIdSelector(TESTID.redirectLink));
  await pane.locator('.examples button').first().click();
  await expect(linkBox).toContainText('#', { timeout: T.CODEC_CALL });
  // The round trip is a SECOND wasm call (a decode of what was just encoded),
  // so it finishes well after the link appears.
  await expect(pane.locator(testIdSelector(TESTID.roundtrip))).toContainText('✓', { timeout: T.CODEC_CALL });
  return {
    url: await pane.locator('textarea').inputValue(),
    code: parseLink((await linkBox.textContent()) ?? '').code,
  };
}

/** Type `url` into the compressor (under the picker's current alphabet),
 *  submit with Enter and wait for a passing round-trip. Returns the shown
 *  link with its scheme restored, the code it carries and the fragment it
 *  is written behind. A link already on screen is waited past by content:
 *  the pane keeps the old link up until the new encode lands. */
export async function encodeUrl(page: Page, url: string): Promise<{ link: string; code: string; fragment: string }> {
  const pane = page.locator(testIdSelector(TESTID.paneEncode));
  const box = pane.locator(testIdSelector(TESTID.redirectLink));
  const before = (await box.count()) ? await box.textContent() : null;
  const field = pane.locator('textarea');
  await field.fill(url);
  await field.press('Enter');
  if (before !== null) await expect(box).not.toHaveText(before, { timeout: T.CODEC_CALL });
  await expect(box).toContainText('#', { timeout: T.CODEC_CALL });
  await expect(pane.locator(testIdSelector(TESTID.roundtrip))).toContainText('✓', { timeout: T.CODEC_CALL });
  const link = new URL(page.url()).protocol + '//' + ((await box.textContent()) ?? '');
  return { link, code: parseLink(link).code, fragment: link.slice(link.indexOf('#') + 1) };
}

/** Run `fn` at the mobile viewport, then restore the desktop one. Specs
 *  toggle explicitly because they run under both projects. */
export async function atMobile(page: Page, fn: () => Promise<void>): Promise<void> {
  await page.setViewportSize({ ...MOBILE });
  try {
    await fn();
  } finally {
    await page.setViewportSize({ ...DESKTOP });
  }
}

/** No page-level horizontal scrollbar: the cheap check every page owes. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

/** The example names, for a spec that walks the bench page's per-example
 *  codes. Reusing the app's own list means renaming an example fails the
 *  spec rather than silently narrowing it. */
export const EXAMPLE_NAMES = EXAMPLE_URLS.map(([name]) => name);
