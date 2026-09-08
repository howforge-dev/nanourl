import { test, expect } from 'playwright/test';
import { atMobile, expectNoHorizontalOverflow, waitForModelReady, watchErrors } from './helpers';
import { PANEL } from './timeouts';

// End-to-end smoke test for the model observatory page, against a real build
// (`pnpm build && pnpm preview`, wired up as the config's webServer) so it
// exercises the real wasm codec, the packed dev model/tokenizer/atlas, not a
// mock. Model load is ~125 MiB from localhost, hence the generous "model
// ready" timeout; everything after that is fast (single-digit ms wasm calls
// plus a couple of small cached asset fetches for the atlas panel).

test('model observatory: architecture, every panel opens, attention canvases, coder stepper', async ({ page }) => {
  const watch = watchErrors(page);

  await page.goto('/model.html');
  await waitForModelReady(page);
  // model readiness and the initial encode+trace of the prefilled example
  // are two separate async steps — wait for the chips too, so every panel
  // below has real data by the time it's opened.
  await expect(page.locator('.toks .tok').first()).toBeVisible({ timeout: 30_000 });

  // --- architecture panel (open by default) names this model's real shape ---
  const archLayers = page.locator('.arch .layer-list .stage');
  await expect(archLayers).toHaveCount(12);
  await expect(archLayers.first()).toContainText('20 heads');

  // --- open every panel; nothing should throw or log an error ---
  const allDetails = page.locator('.card details');
  const n = await allDetails.count();
  // `n` comes from this same locator, and toHaveCount(n) below reuses it —
  // if the selector ever stops matching, n would be 0 and that assertion
  // would pass vacuously. Pin the real panel count here instead:
  // architecture, atlas, wpe, attention, residual, readout, coder, bits.
  expect(n).toBe(8);
  for (let i = 0; i < n; i++) {
    const d = allDetails.nth(i);
    const isOpen = await d.evaluate((el) => (el as HTMLDetailsElement).open);
    if (!isOpen) await d.locator('summary').first().click();
    // Every lazy panel's "still working" placeholder (loading/computing/
    // running the readout/select a token above) uses the shared `.note`
    // class; once its first-open work (fetch/compute/rpc) settles, real
    // content (or an `.err` message) replaces it — wait for that instead of
    // guessing a fixed delay. Architecture has no `.note` at all, so this
    // resolves immediately for it.
    await expect(d.locator('.note')).toHaveCount(0, { timeout: PANEL });
    // ...and the `.err` message that also replaces `.note` is a FAILURE, not
    // a pass — without this check, a panel that renders a developer error
    // message to end users would still score green, letting a bad asset
    // (e.g. `atlas: null`) leave the observatory's flagship panel dead while
    // the suite reports success.
    await expect(d.locator('.err'), `panel ${i} rendered an error`).toHaveCount(0);
  }
  await expect(page.locator('.err')).toHaveCount(0);
  await expect(allDetails).toHaveCount(n);
  for (let i = 0; i < n; i++) {
    await expect(allDetails.nth(i)).toHaveJSProperty('open', true);
  }

  // --- click a token chip: attention draws one canvas per layer ---
  const chips = page.locator('.toks .tok');
  await expect(chips.first()).toBeVisible();
  await chips.nth(2).click();
  await page.waitForTimeout(200);
  await expect(page.locator('.attnwrap canvas.attn')).toHaveCount(12);

  // --- coder stepper: never silently wrong — no "diverged" error banner ---
  await expect(page.getByText('stepper unavailable')).toHaveCount(0);
  await expect(page.locator('.bitstream')).toBeVisible();
  await expect(page.locator('.tape .seg').first()).toBeVisible();

  // --- bits→characters shows at least one character cell ---
  await expect(page.locator('.cell').first()).toBeVisible();

  // --- no page-level horizontal scroll at 375px, with every panel open ---
  await atMobile(page, () => expectNoHorizontalOverflow(page));

  watch.expectClean();
});
