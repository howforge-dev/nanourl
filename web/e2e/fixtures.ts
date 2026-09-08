// The suite's `test` and `expect`: Playwright's, with the codec's tier under
// the suite's control.
//
// The static server sends COOP/COEP, so every page is cross-origin isolated
// and `detectTier()` (src/lib/codec/tier.ts) picks the threads tier: up to
// MAX_WORKERS compute threads per page on top of the coordinator, and N
// Playwright workers then oversubscribe the host N × 5 ways — under that
// contention a single codec call can starve past its assertion timeout.
// Nothing in a flow spec is about the tier, so by default a page reports no
// isolation and the codec runs the relaxed tier on one thread. A spec that
// is about the threads tier, or about the isolation itself, opts back in
// with `test.use({ threads: true })`; a bench page forced to a tier with
// `?tier=` is that spec's own choice and is left alone.
import { test as base, expect } from 'playwright/test';
import type { BrowserContext } from 'playwright/test';

export interface TierOptions {
  /** Let a page take the threads tier: real cross-origin isolation and
   *  several compute workers, instead of the single-thread default. */
  threads: boolean;
}

/** The name the page-side observer reports a threads-tier status line to. */
const REPORT = '__nanourlTierSeen';

/** Hide the isolation from every page of `context`, and collect the status
 *  lines that report the threads tier anyway. `detectTier()` reads the flag
 *  once at load, so the override is an init script — it runs before any
 *  page script — and the check is a page-side observer of `#status`, so a
 *  page that is closed or navigated away mid-test is still covered. */
async function forceRelaxedTier(context: BrowserContext): Promise<string[]> {
  const seen: string[] = [];
  await context.exposeBinding(REPORT, ({ page }, text: string) => {
    seen.push(`${page.url()}: ${text}`);
  });
  await context.addInitScript((report: string) => {
    Object.defineProperty(window, 'crossOriginIsolated', { value: false, configurable: true });
    if (new URLSearchParams(location.search).has('tier')) return;
    const check = (): void => {
      const text = document.querySelector('#status')?.textContent ?? '';
      if (text.includes('threads:')) (window as unknown as Record<string, (t: string) => void>)[report](text);
    };
    const observe = (): void => {
      new MutationObserver(check).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
      check();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe);
    else observe();
  }, REPORT);
  return seen;
}

export const test = base.extend<TierOptions & { relaxedTier: void }>({
  threads: [false, { option: true }],
  relaxedTier: [
    async ({ context, threads }, use) => {
      if (threads) {
        await use();
        return;
      }
      const seen = await forceRelaxedTier(context);
      await use();
      expect(seen, 'a page reported the threads tier under the relaxed default').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
