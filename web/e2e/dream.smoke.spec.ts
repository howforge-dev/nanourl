import { test, expect } from 'playwright/test';
import { TESTID, testIdSelector, waitForModelReady, watchErrors } from './helpers';
import { SAMPLE } from './timeouts';

// End-to-end smoke test for the dream page, against a real build (same
// webServer as index.smoke.spec.ts) so it exercises the actual wasm codec +
// the packed dev model, not a mock. Model load is ~125 MiB from localhost,
// hence the generous "model ready" timeout.

test('dream page: sample a batch, determinism across runs', async ({ page }) => {
  const watch = watchErrors(page);

  await page.goto('/dream.html');
  await waitForModelReady(page);

  const rows = page.locator(testIdSelector(TESTID.dreamUrl));

  await page.locator('#count').fill('3');
  await page.getByRole('button', { name: 'Dream' }).click();
  await expect(rows).toHaveCount(3, { timeout: SAMPLE });
  const firstRun = await rows.allTextContents();
  // Real URLs, not three empty rows: `toHaveCount(3)` alone is satisfied by a
  // sampler that emits nothing.
  for (const url of firstRun) expect(url).toMatch(/^https?:\/\/\S+$/);

  // Same seed (default 1, untouched) replays the same batch. The second
  // `toHaveCount(3)` is satisfied by the *stale* DOM, so without waiting for
  // the run to finish, a no-op second click would compare the text to itself
  // and pass — wait for the button to finish its run (it disables while
  // sampling) before reading the rows back.
  await page.getByRole('button', { name: 'Dream' }).click();
  await expect(page.getByRole('button', { name: 'Dream' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Dream' })).toBeEnabled({ timeout: SAMPLE });
  await expect(rows).toHaveCount(3, { timeout: SAMPLE });
  const secondRun = await rows.allTextContents();
  expect(secondRun).toEqual(firstRun);

  watch.expectClean();
});
