import { test, expect } from './fixtures';
import { numbers } from '../src/lib/numbers';
import { SECTION_IDS } from '../src/pages/learn/sections';
import { atMobile, expectNoHorizontalOverflow, watchErrors } from './helpers';
import { DESKTOP, MOBILE } from './viewports';

// End-to-end smoke test for the learn page: static content, no codec, no
// model load, so this only needs a real build+preview to
// check ids, links and layout, not "model ready" like index.smoke.spec.ts.

test('learn page: all 12 sections, TOC links resolve, real numbers, no overflow', async ({ page }) => {
  const watch = watchErrors(page);

  await page.goto('/learn.html');

  // all 12 stable section ids exist, in order
  for (const id of SECTION_IDS) {
    await expect(page.locator(`#${id}`)).toHaveCount(1);
  }
  const order = await page.evaluate((ids: readonly string[]) => {
    const positions = ids.map((id) => {
      const el = document.getElementById(id);
      return el ? el.getBoundingClientRect().top + window.scrollY : Infinity;
    });
    return positions.every((p, i) => i === 0 || p >= positions[i - 1]);
  }, SECTION_IDS);
  expect(order).toBe(true);

  // TOC has one link per section id, and each resolves to that element
  const tocLinks = page.locator('.toc a');
  await expect(tocLinks).toHaveCount(SECTION_IDS.length);
  for (const id of SECTION_IDS) {
    await expect(page.locator(`.toc a[href="#${id}"]`)).toHaveCount(1);
  }
  await tocLinks.first().click();
  await expect(page).toHaveURL(/#idea$/);

  // the page shows the real generated bits/char figure, not a placeholder
  const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  expect(bodyText).toContain(String(numbers.bitsPerChar));
  expect(bodyText).toContain(String(numbers.bitsPerCharKernel));
  // the worked HN example's real canonical form and coded string appear
  expect(bodyText).toContain(numbers.hn.canonical);
  expect(bodyText).toContain(numbers.hn.coded);

  // no placeholder markers ever leak into the rendered page
  expect(bodyText.toLowerCase()).not.toMatch(/todo|placeholder|n\/a|undefined|nan\b/);

  // no horizontal overflow at 375px
  await atMobile(page, () => expectNoHorizontalOverflow(page));

  // A breakout figure is positioned, not just sized. It is centred with a
  // half-width `translateX`, so anything that resets its balancing margin (a
  // `margin` shorthand in a later stylesheet, a utility) leaves it shifted
  // half its own width off the LEFT of the page, where no scrollWidth
  // assertion can see it, because leftward overflow contributes to none.
  // Measured position, at both widths, is the only check that catches that.
  for (const vp of [DESKTOP, MOBILE]) {
    await page.setViewportSize({ ...vp });
    await page.waitForTimeout(150);
    const boxes = await page.locator('.breakout').evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, width: r.width, viewport: window.innerWidth };
      }),
    );
    expect(boxes.length, 'the learn page has breakout figures to check').toBeGreaterThan(0);
    for (const b of boxes) {
      expect(b.left, `breakout at ${vp.width}px starts off the left edge`).toBeGreaterThanOrEqual(-0.5);
      expect(b.right, `breakout at ${vp.width}px runs past the right edge`).toBeLessThanOrEqual(b.viewport + 0.5);
      // and it is breaking out: wider than the reading column it sits in,
      // or the whole viewport when that is narrower than the column.
      expect(b.width, `breakout at ${vp.width}px is no wider than the prose`).toBeGreaterThanOrEqual(Math.min(vp.width, 880) - 0.5);
    }
  }
  await page.setViewportSize({ ...DESKTOP });

  // mathbox collapsibles open on click (spot-check one)
  const firstMathbox = page.locator('details.mathbox').first();
  await expect(firstMathbox.locator('.eq')).toBeHidden();
  await firstMathbox.locator('summary').click();
  await expect(firstMathbox.locator('.eq')).toBeVisible();

  watch.expectClean();
});
