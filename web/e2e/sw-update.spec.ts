import { randomBytes } from 'node:crypto';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from './fixtures';
import type { Page } from 'playwright/test';
import { DIST_DIR, SW_JS } from '../scripts/paths';
import { SHELL_CACHE_PREFIX } from '../src/lib/codec/cacheNames';
import { TESTID, testIdSelector, waitForModelReady, watchErrors } from './helpers';
import { CODEC_CALL, MODEL_RELOAD, SW_ACTIVE, SW_UPDATE_BANNER, SW_WAITING } from './timeouts';

// A newly installed service worker must never take over on its own; it
// parks itself as `registration.waiting` until BuildInfo.svelte's "reload"
// button posts SKIP_WAITING_MESSAGE to it, and only *that* activates it
// (clients.claim() + old-cache cleanup) and reloads the page, via
// `controllerchange`.
//
// Simulates a "new deploy" without a second real `pnpm build`: a fixture
// file (a byte-patched copy of the real dist/sw.js, build id swapped to a
// fresh random one) is written to dist/ under a different, per-run-unique
// name and registered at the same scope ('/'). Per spec a
// ServiceWorkerRegistration is keyed by (origin, scope), not scriptURL, so
// the browser treats this exactly like a same-URL update that found
// different bytes: it installs a new worker version alongside the still-active
// original, without ever overwriting the real dist/sw.js that other spec files
// running against the same shared preview server rely on.
// A page.route intercept of the SW's own script fetch cannot substitute for
// this: Chromium does not route a service worker's internal script fetch
// through the same interception layer page.route hooks into. The fixture's
// own filename must be unique per test invocation too: mobile and desktop
// run concurrently against that same shared server/filesystem
// (playwright.config.ts's `workers: 2`), or a fixed name would race the
// write/unlink between them.
//
// Runs under both mobile/desktop projects like every other spec.

const swPath = SW_JS;
// 8 hex chars, same shape as a real build id (scripts/sw-manifest-lib.ts's
// buildId, sha256.slice(0,8)), so isShellCache (web/src/lib/codec/
// cacheNames.ts) recognises this fixture's shell cache exactly like a real
// one, and unique per test invocation so mobile/desktop's concurrent runs
// against the same shared preview server never collide on this filename.
const runId = randomBytes(4).toString('hex');
const fixtureName = `sw-fixture-${runId}.js`;
const fixturePath = resolve(DIST_DIR, fixtureName);
const fixtureBuild = runId;

async function shellCacheNames(page: Page): Promise<string[]> {
  return page.evaluate(
    async (prefix: string) => (await caches.keys()).filter((k) => k.startsWith(prefix)),
    SHELL_CACHE_PREFIX,
  );
}

test('a waiting service worker only activates after the user clicks reload', async ({ page }) => {
  const watch = watchErrors(page);

  const original = readFileSync(swPath, 'utf8');
  const patched = original.replace(/self\.__BUILD__ = "[0-9a-f]+"/, `self.__BUILD__ = "${fixtureBuild}"`);
  expect(patched).not.toBe(original); // the replace actually matched something
  writeFileSync(fixturePath, patched);

  try {
    // --- online: load, let the first build's shell precache land ---
    await page.goto('/');
    await waitForModelReady(page);
    await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active != null, undefined, {
      timeout: SW_ACTIVE,
    });
    const before = await shellCacheNames(page);
    expect(before).toHaveLength(1);
    const originalCache = before[0];

    // BuildInfo.svelte only mounts inside Encode.svelte's "advanced"
    // disclosure once there's a real encode result (`{#if hasOutput &&
    // result}`), and that <details> starts closed, so the update banner it
    // will render can't be visible without both a completed encode and
    // opening the disclosure first (same as index.smoke.spec.ts's own
    // "advanced" interactions).
    const encodePane = page.locator(testIdSelector(TESTID.paneEncode));
    await encodePane.locator('.examples button').first().click();
    await expect(encodePane.locator(testIdSelector(TESTID.roundtrip))).toContainText('✓', { timeout: CODEC_CALL });
    await encodePane.locator(testIdSelector(TESTID.advanced)).locator('summary').click();

    // --- simulate a new deploy: register the fixture at the same scope ---
    await page.evaluate((url: string) => navigator.serviceWorker.register(url), `/${fixtureName}`);

    // the new worker installs (precaching its own nanourl-shell-<fixtureBuild>)
    // and parks itself as `registration.waiting`. It must NOT take over on
    // its own; both shell caches coexist and the original worker is still
    // the one `active` throughout.
    await page.waitForFunction(
      async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state === 'installed',
      undefined,
      { timeout: SW_WAITING },
    );
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state)).toBe('activated');
    const whileWaiting = await shellCacheNames(page);
    expect(whileWaiting.slice().sort()).toEqual([originalCache, `${SHELL_CACHE_PREFIX}${fixtureBuild}`].sort());

    // BuildInfo's updatefound/statechange listener offers the reload
    const banner = page.locator(testIdSelector(TESTID.swUpdateBanner));
    await expect(banner).toBeVisible({ timeout: SW_UPDATE_BANNER });

    // --- click reload: posts SKIP_WAITING to the waiting worker, which is
    // the only thing that calls skipWaiting(); activate claims every client,
    // then deletes the old shell cache; controllerchange reloads the page.
    //
    // Not asserted here: that the old shell cache is already gone by the
    // time the page reloads. `clients.claim()` fires `controllerchange` on
    // affected clients as soon as *it* resolves, independent of whether the
    // rest of the `activate` handler (the cache cleanup, which runs after
    // it in the same `waitUntil`) has finished, so a fast reload can race
    // ahead of the delete. That's harmless in practice (the reloaded page
    // is controlled by the new worker regardless, whose fetch handler never
    // references the old cache name at all; the old entry is disk space
    // reclaimed a little later) and, in this specific synthetic test, doubly
    // unprovable: the reloaded page's own registerSw.ts also
    // fires on `load` and re-registers the real, unmodified `/sw.js` (a
    // different scriptURL from this fixture; a real deploy overwrites
    // /sw.js in place instead, so this second registration cycle is itself
    // an artifact of this test's fixture-file methodology), which can
    // independently reinstall a worker generation carrying the old build's
    // shell list and recreate its cache. What matters and *is* asserted:
    // the click causes the new build to take over.
    // Register the load listener before the click: the reload the click
    // triggers destroys the old execution context, and a "model ready" wait
    // alone can be satisfied by the OLD page a moment before it goes away.
    await Promise.all([page.waitForEvent('load'), banner.getByRole('button', { name: 'reload' }).click()]);
    await waitForModelReady(page, MODEL_RELOAD);
    const controllerUrl = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL);
    expect(controllerUrl).toContain(fixtureName);
    const after = await shellCacheNames(page);
    expect(after).toContain(`${SHELL_CACHE_PREFIX}${fixtureBuild}`);
    watch.expectClean();
  } finally {
    unlinkSync(fixturePath);
  }
});
