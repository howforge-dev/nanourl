import { test, expect } from 'playwright/test';
import { rowTestId } from '../src/lib/testids';
import { openBench, readNumber, TESTID, testIdSelector, watchErrors } from './helpers';
import { MODEL_LOAD } from './timeouts';

// End-to-end smoke test for the kernel bench page, against a real
// build+preview (same webServer as index.smoke.spec.ts). Not linked from any
// other page, so this is the only thing that ever loads it in CI.

test('bench page: /bench.html?tier=simd loads, runs, and prints a number', async ({ page }) => {
  const watch = watchErrors(page);

  await expect(await openBench(page, 'simd')).toHaveText('simd');

  const value = await readNumber(page.locator(testIdSelector(TESTID.msPerToken)));
  expect(Number.isFinite(value)).toBe(true);
  expect(value).toBeGreaterThan(0);

  expect(await readNumber(page.locator(testIdSelector(TESTID.msPerUrl)))).toBeGreaterThan(0);

  watch.expectClean();
});

test('bench page: run all tiers fills a 3-row table and terminates each codec', async ({ page }) => {
  const watch = watchErrors(page);

  await expect(await openBench(page, 'simd')).toHaveText('simd');

  // By testid, not by label: the button reads "running…" for the whole sweep,
  // so a name locator finds nothing exactly while the test waits for it.
  const button = page.locator(testIdSelector(TESTID.runAllTiers));
  await expect(button).toBeEnabled();
  await button.click();
  // model/tokenizer chunks are already Cache-API-hit from the load above —
  // only each tier's own (small) wasm binary is a real fetch — but this
  // still sequentially loads and benches 3 full codecs, hence the long
  // timeout.
  await expect(page.locator(`[data-testid^="${rowTestId('')}"]`)).toHaveCount(3, { timeout: MODEL_LOAD });
  // The sweep also walks every worker count this device supports, so three
  // rows is a milestone, not the end: wait for the button itself to come back.
  await expect(button).toBeEnabled({ timeout: MODEL_LOAD });

  watch.expectClean();
});
