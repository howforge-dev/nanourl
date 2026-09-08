import { test, expect } from './fixtures';
import type { Page } from 'playwright/test';
import { SHELL_CACHE_PREFIX } from '../src/lib/codec/cacheNames';
import { encodeFirstExample, NETWORK_FAILURE, waitForModelReady, watchErrors } from './helpers';
import { MODEL_RELOAD, SW_ACTIVE } from './timeouts';

// End-to-end: with the browser network fully off, every page still
// opens and the compressor still works, against a real build+preview
// (`pnpm build && vite preview`, this suite's webServer), so it exercises
// the real src/sw.ts precache (not a mock), the real wasm codec, and the
// real cross-origin-isolation headers vite preview injects (see
// vite.config.ts's `preview.headers`). Runs under both `mobile` and
// `desktop` projects like every other spec (playwright.config.ts).
//
// The isolation itself is asserted below, so the suite's default of hiding
// it (fixtures.ts) is lifted here.
test.use({ threads: true });

/** src/sw.ts's registration (registerSw.ts) resolving only means *install
 * started*; this waits for the worker to be `active` and for its precache
 * (`nanourl-shell-<build>`) to hold every file self.__SHELL__ lists, by
 * fetching dist/sw.js's own injected list (scripts/sw-manifest.ts) and
 * polling `caches.keys()` + that cache's own `.keys().length` against it. */
async function waitForShellPrecache(page: Page): Promise<number> {
  const shellCount = await page.evaluate(async () => {
    const text = await (await fetch('/sw.js')).text();
    const m = /self\.__SHELL__ = (\[[^\]]*\]);/.exec(text);
    if (!m) throw new Error('dist/sw.js missing injected self.__SHELL__');
    return (JSON.parse(m[1]) as string[]).length;
  });
  expect(shellCount).toBeGreaterThan(0);
  await page.waitForFunction(
    async ({ expected, prefix }: { expected: number; prefix: string }) => {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg?.active) return false;
      const keys = await caches.keys();
      const shellKey = keys.find((k) => k.startsWith(prefix));
      if (!shellKey) return false;
      const cached = await (await caches.open(shellKey)).keys();
      return cached.length >= expected;
    },
    { expected: shellCount, prefix: SHELL_CACHE_PREFIX },
    { timeout: SW_ACTIVE },
  );
  return shellCount;
}

test('compressor page works fully offline after one visit', async ({ page, context }) => {
  const watch = watchErrors(page);
  const failedRequests: string[] = [];
  page.on('requestfailed', (r) => failedRequests.push(r.url()));

  // --- online: load, let the model + the shell precache both land ---
  await page.goto('/');
  await waitForModelReady(page);
  await waitForShellPrecache(page);
  await encodeFirstExample(page);

  // --- go offline, reload: no cached response is a cache-through-SW
  // artifact here: the network is off, at the browser/CDP level ---
  await context.setOffline(true);
  try {
    await page.reload();

    // the shell (HTML/JS/CSS) came from the precache, not the network
    await expect(page.locator('.tabrow')).toBeVisible();
    expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);

    // the model itself loads from loader.ts's own cache: no network needed
    await waitForModelReady(page, MODEL_RELOAD);

    // the codec still round-trips a real encode with the network off
    await encodeFirstExample(page);

    // --- other pages open offline too (learn: no codec/model load; model:
    // needs the model; proves loader.ts's cache is shared across pages) ---
    await page.goto('/learn.html');
    await expect(page.locator('#idea')).toBeVisible();

    await page.goto('/model.html');
    await waitForModelReady(page, MODEL_RELOAD);
  } finally {
    await context.setOffline(false);
  }

  // The only requests allowed to fail offline are the model chunk's own
  // <link rel="preload" as="fetch"> resource hint(s). Every shell asset
  // (HTML/JS/CSS) must have been served from src/sw.ts's precache instead of
  // hitting the network at all.
  expect(failedRequests.every((u) => u.endsWith('.bin'))).toBe(true);
  // Chromium's own "Failed to load resource: net::ERR_…" console line is a
  // browser network notice, not an application console.error call, allowed
  // because going offline below deliberately causes exactly one such failure
  // (the `<link rel="preload" as="fetch">` resource hint for the first model
  // chunk, from vite.config.ts's preloadFirstChunk plugin: a plain browser
  // fetch with no cache fallback of its own; the model itself still loads
  // fine, straight from loader.ts's own Cache API cache). Verified precisely
  // (not just by this text match) via the requestfailed assertion above.
  watch.expectClean([NETWORK_FAILURE]);
});
