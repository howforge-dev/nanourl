import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures';
import type { Page } from 'playwright/test';
import type { Manifest } from '../src/lib/codec/manifest';
import { ASSETS_JSON } from '../scripts/paths';
import { expectNoHorizontalOverflow, waitForBenchReady, waitForModelReady, watchErrors } from './helpers';

// Cross-page smoke: every page loads without a page-level horizontal
// scrollbar and without a console/page error, under both the mobile and
// desktop projects (playwright.config.ts). Narrower than
// index/dream/learn.smoke.spec.ts on purpose: this only checks the one
// thing that's cheap to get wrong on every page (an element that doesn't
// wrap, a fixed width past the viewport) and doesn't drive any page's
// actual features.

// /model.html is never conditional here: skipping it when the manifest has
// `atlas: null` would silently narrow the suite to four pages with no skip
// marker and no report line, leaving the observatory untested with nothing
// to notice. `task web:assets` auto-detects web/atlas/atlas.bin and
// `pack-assets.ts` refuses to drop an atlas the previous manifest had, so a
// missing atlas is a loud pack-time warning, not something this spec should
// paper over. If one is absent this spec FAILS on model.html's
// `.err` panel, which is the correct outcome: that panel shows end users a
// message telling them to run a `task` command.
function assetsAtlas(): unknown {
  try {
    return (JSON.parse(readFileSync(ASSETS_JSON, 'utf8')) as Manifest).atlas;
  } catch {
    return null;
  }
}

interface PageSpec {
  path: string;
  /** Wait for whatever this page's own "I have real content now" signal is,
   * before measuring overflow: the widest content on most of these pages
   * (a long token/code string, a filled table) only exists once its async
   * load has finished. Omitted for pages with no such load (learn.html is
   * static). */
  waitForReady?: (page: Page) => Promise<unknown>;
}

const PAGES: PageSpec[] = [
  { path: '/', waitForReady: waitForModelReady },
  { path: '/dream.html', waitForReady: waitForModelReady },
  { path: '/learn.html' },
  // ?tier=simd: deterministic and fast, same reasoning as the other specs
  // that force a tier on this page rather than depend on feature detection.
  { path: '/bench.html?tier=simd', waitForReady: waitForBenchReady },
  { path: '/model.html', waitForReady: waitForModelReady },
];

test('the packed manifest carries a token atlas (model.html depends on it)', () => {
  expect(assetsAtlas(), 'run `task web:assets` (ATLAS is auto-detected at web/atlas/atlas.bin)').not.toBeNull();
});

/**
 * Content the visitor cannot get to, in the two shapes a page can hide it.
 *
 * The page-level `documentElement.scrollWidth` assertion below is necessary
 * but sees neither of them.
 *
 * **Clipped.** `overflow-x: hidden` (or `clip`) establishes a clip box that is
 * not user-scrollable and does not contribute to ancestor scrollable overflow.
 * Content too wide for such a box is silently truncated mid-character with no
 * scrollbar, worse than the scrollbar the page-level assertion looks for, and
 * structurally undetectable by it.
 *
 * **Painted off the left edge.** Leftward overflow never contributes to any
 * `scrollWidth`, so the page cannot be scrolled to it and no width assertion
 * anywhere can see it. A mispositioned full-bleed figure (a negative margin
 * or a `translateX` that nothing balances) puts real content at negative x
 * and every gate stays green. This half of the sweep has no exemption for an
 * element's own `overflow-x`: an element cannot scroll itself into view.
 *
 * Rightward overflow of a box that does NOT clip is deliberately not reported:
 * the content is painted and reachable, and whether it stays on screen is
 * exactly what `documentElement.scrollWidth` measures.
 */
async function unreachableContent(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const describe = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}`;
    const scrolls = (el: Element) => {
      const overflowX = getComputedStyle(el).overflowX;
      return overflowX === 'auto' || overflowX === 'scroll';
    };
    const clips = (el: Element) => {
      const overflowX = getComputedStyle(el).overflowX;
      return overflowX === 'hidden' || overflowX === 'clip';
    };
    /** Can something ABOVE `el` be scrolled sideways to bring it into view?
     *  Starts at the parent: an element's own overflow never moves itself. */
    const reachableByScrolling = (el: Element) => {
      for (let node = el.parentElement; node; node = node.parentElement) if (scrolls(node)) return true;
      return false;
    };
    const out: string[] = [];
    for (const el of [...document.querySelectorAll('*')]) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.left < -0.5 && !reachableByScrolling(el)) {
        out.push(`${describe(el)} is painted off the left edge (left ${r.left.toFixed(1)}, right ${r.right.toFixed(1)}) and nothing scrolls to it`);
        continue;
      }
      if (el.scrollWidth > el.clientWidth + 1 && clips(el)) {
        out.push(`${describe(el)} clips its content (scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth})`);
      }
    }
    return out;
  });
}

for (const { path, waitForReady } of PAGES) {
  test(`${path}: no page-level horizontal overflow, nothing clipped, no console/page errors`, async ({ page }) => {
    const watch = watchErrors(page);

    await page.goto(path);
    if (waitForReady) await waitForReady(page);

    await expectNoHorizontalOverflow(page);

    // A rendered `.err` is a failure everywhere, not just on model.html: every
    // handled failure in src/ renders into one and is never logged, so "no
    // console errors" alone would never catch it.
    await expect(page.locator('.err')).toHaveCount(0);

    expect(await unreachableContent(page), `${path}: content the visitor cannot reach`).toEqual([]);

    watch.expectClean();
  });
}
