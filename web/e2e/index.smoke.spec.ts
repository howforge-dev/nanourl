import { test, expect } from './fixtures';
import { numbers } from '../src/lib/numbers';
import { MODEL_RELEASE_URL, RELEASES_URL, REPO_URL } from '../src/lib/links';
import {
  atMobile,
  encodeFirstExample,
  expectNoHorizontalOverflow,
  TESTID,
  testIdSelector,
  waitForModelReady,
  watchErrors,
} from './helpers';
import { CODEC_CALL, MODEL_LOAD } from './timeouts';

// End-to-end smoke test for the compressor page (`index`), against a real
// build (`pnpm build && pnpm preview`, wired up as the config's webServer) so
// it exercises the actual wasm codec + the packed dev model, not a mock.
// Model load is ~125 MiB from localhost, hence the generous "model ready"
// timeout; everything after that is fast (single-digit ms wasm calls).

test('compressor page: encode, decode, distribution, alphabet toggle, redirect overlay', async ({ page }) => {
  const watch = watchErrors(page);

  await page.goto('/');

  // Before the model has loaded and before anything is expanded: the
  // durability claim is the reason to trust one of these links at all, so a
  // regression that hides it behind a disclosure has to fail here.
  const outlive = page.locator(testIdSelector(TESTID.outlive));
  await expect(outlive).toBeVisible();
  await expect(outlive.getByRole('link', { name: 'model weights' })).toHaveAttribute('href', MODEL_RELEASE_URL);
  await expect(outlive.getByRole('link', { name: /command-line tool/ })).toHaveAttribute('href', RELEASES_URL);
  await expect(page.locator('nav.pagenav a.source')).toHaveAttribute('href', REPO_URL);

  await waitForModelReady(page);

  const encodePane = page.locator(testIdSelector(TESTID.paneEncode));

  // --- example -> encode -> round-trip check ---
  const { url: originalUrl, code: codeBase64url } = await encodeFirstExample(page);
  expect(codeBase64url.length).toBeGreaterThan(0);

  // --- distribution viewer: click the 3rd token, jump to the chosen row ---
  await encodePane.locator(testIdSelector(TESTID.advanced)).locator('summary').click();
  const chips = encodePane.locator('.toks .tok');
  await chips.nth(2).click();
  await expect(encodePane.locator('.ctx')).not.toHaveText('computing…');
  await encodePane.locator('.next').click();
  await expect(encodePane.locator('.drow.hit')).toBeVisible();

  // --- jump-to-chosen when the active filter hides the chosen row: jumpChosen
  // must scroll against the current filtered scroll height, not a stale one,
  // or it lands at the top with nothing highlighted (see Dist.svelte's
  // jumpChosen). The wikipedia example's early, domain-structure tokens are
  // all highly predictable (rank #1-2, so jumping to them never needs to
  // scroll past the first page and can't exercise this path) — probe a
  // handful of later candidates and keep whichever has the highest chosen
  // rank.
  const tokenCount = await chips.count();
  let bestIdx = 2;
  let bestRank = 0;
  for (const idx of [12, 10, 18, 21, 24, 9, tokenCount - 3].filter((i) => i >= 0 && i < tokenCount)) {
    await chips.nth(idx).click();
    await expect(encodePane.locator('.ctx')).not.toHaveText('computing…');
    const r = Number(((await encodePane.locator('.next b').textContent()) ?? '#0').replace('#', ''));
    if (r > bestRank) {
      bestRank = r;
      bestIdx = idx;
    }
    if (bestRank > 20) break; // good enough — no need to keep probing
  }
  await chips.nth(bestIdx).click();
  await expect(encodePane.locator('.ctx')).not.toHaveText('computing…');

  const filterInput = encodePane.locator('input[type=search]');
  await filterInput.fill('zzzzz_no_such_token_zzzzz');
  await encodePane.locator('.next').click();
  await expect(encodePane.locator('.drow.hit')).toBeVisible();
  await expect(filterInput).toHaveValue(''); // jump drops the query that hid the row
  if (bestRank > 10) {
    const scrollTop = await encodePane.locator('.vlist').evaluate((el) => el.scrollTop);
    expect(scrollTop).toBeGreaterThan(0);
  }

  // --- alphabet toggle: code changes to base79, then back to the original ---
  const alphaRow = page.locator('.alpha');
  await alphaRow.getByText('base79', { exact: true }).click();
  const linkBox = encodePane.locator(testIdSelector(TESTID.redirectLink));
  await expect(linkBox).not.toContainText('#' + codeBase64url);
  await alphaRow.getByText('base64url', { exact: true }).click();
  await expect(linkBox).toContainText('#' + codeBase64url);

  // no page-level horizontal scroll at 375px, with the widest content (the
  // open distribution viewer + redirect link row) on screen
  await atMobile(page, () => expectNoHorizontalOverflow(page));

  const redirectLink = (await encodePane.locator(testIdSelector(TESTID.redirectLink)).textContent()) ?? '';
  expect(redirectLink).toContain('#');

  // --- decode tab: paste the redirect link, get the original URL back ---
  await page.locator('.tabs').getByRole('tab', { name: 'Decode', exact: true }).click();
  const decodePane = page.locator(testIdSelector(TESTID.paneDecode));
  await decodePane.locator('input[type=text]').fill(redirectLink);
  await expect(decodePane.locator(testIdSelector(TESTID.decodedUrl))).toHaveText(originalUrl);
  await expect(decodePane.getByRole('link', { name: 'open ↗' })).toHaveAttribute('href', originalUrl);

  await atMobile(page, () => expectNoHorizontalOverflow(page));

  // --- redirect overlay: a fresh navigation straight to /#<code> (a new tab,
  // not a same-document hash edit), sharing this context's model cache ---
  const page2 = await page.context().newPage();
  watch.also(page2);
  await page2.goto(`/#${codeBase64url}`);
  await expect(page2.locator(testIdSelector(TESTID.redirectOverlay))).toBeVisible();
  await expect(page2.locator(testIdSelector(TESTID.redirectTarget))).toHaveText(originalUrl, { timeout: MODEL_LOAD });
  await page2.locator(testIdSelector(TESTID.redirectCancel)).click();
  await expect(page2.locator(testIdSelector(TESTID.redirectOverlay))).toHaveCount(0);
  await expect(page2.locator('.tabrow')).toBeVisible();
  await page2.close();

  watch.expectClean();
});

// C1: the learn page's worked example and the compressor must agree, because
// they are the same model. They did not — numbers.ts was generated from one
// run's manifest while web/public carried another run's export,
// so learn.html showed `IDrqYQdZ` (8 chars) and this page produced
// `BAajQuI8c` (9 chars) for the same URL, two clicks apart. Every gate was
// green: learn.smoke.spec.ts asserted the page renders numbers.ts, which is
// the module the page renders from.
//
// `tests/assets-sync.test.ts` and `tests/worker-smoke.test.ts` gate this in
// node; this is the in-browser half — the real wasm, the real chunked
// download, the real UI.
test('the learn page worked example is what the shipped compressor produces', async ({ page }) => {
  const watch = watchErrors(page);

  await page.goto('/');
  await waitForModelReady(page);

  const encodePane = page.locator(testIdSelector(TESTID.paneEncode));
  // base64url is the default alphabet, and the one hn-trace.json was recorded
  // with — assert that rather than assume it.
  await expect(page.locator('.alpha button[aria-pressed="true"]')).toHaveText('base64url');

  await encodePane.locator('textarea').fill(numbers.hn.url);
  await encodePane.locator('textarea').press('Enter');
  await expect(encodePane.locator(testIdSelector(TESTID.redirectLink))).toContainText('#' + numbers.hn.coded);
  await expect(encodePane.locator(testIdSelector(TESTID.roundtrip))).toContainText('✓', { timeout: CODEC_CALL });

  // and the derived figures the learn page quotes for the same example
  const stats = await encodePane.locator('.stat').allTextContents();
  expect(stats.join(' ')).toContain(`${numbers.hn.url_chars} → ${numbers.hn.coded_chars}`);
  expect(stats.join(' ')).toContain(`${numbers.hn.coded_bits}`);

  watch.expectClean();
});
