import { test, expect } from './fixtures';
import type { Page } from 'playwright/test';
import { B79_MARK, QR_MARK } from '../src/lib/alphabet';
import { MODEL_RELEASE_URL, RELEASES_URL, SITE_URL } from '../src/lib/links';
import { SHORTEN_API } from '../src/lib/shortener';
import { TURNSTILE_SCRIPT } from '../src/lib/turnstile';
import { encodeUrl, loadScanner, NETWORK_FAILURE, scan, TESTID, testIdSelector, waitForModelReady, watchErrors } from './helpers';
import { CODEC_CALL, MODEL_LOAD } from './timeouts';

// The compressor flows `index.smoke.spec.ts` does not walk: the redirect
// overlay end to end (an http target opened, a non-http one shown and never
// opened, a malformed fragment refused, Escape), typing a URL of one's own,
// the Decode pane's every input shape, the copy buttons, the durability
// section, and the online short link with its server answered from here. Each case is its own page against the real build, in both
// projects, and fails on any console or page error.

/**
 * Two URLs and their codes under the pinned model, spelled as
 * `nanourl encode --bare` prints them: a marker digit in front where the code
 * could pass as base64url, none where the code says its alphabet itself.
 * A case that opens `/#<code>` directly costs one model load and nothing
 * else, and a model change fails these cases the way it fails the learn
 * page's worked example.
 */
const HN = {
  url: 'https://news.ycombinator.com/item?id=44567890',
  base64url: 'BAddTS_zj',
  base79: 'N7SVSx$F',
  emoji: '🏢🥉🐠🚼🎴',
  qrAlpha: 'N9.X-096Z',
};
const EXAMPLE = {
  url: 'https://example.com/a/b?c=d',
  base64url: 'QT4dKsC6jvCpi',
  qrAlpha: '/00YNH8EF4Q4DPIU',
};

/** A string that has base64url's shape and is not a code: the decoder reads
 *  a stream version it does not know from its first bits. */
const JUNK = 'zzzzzzzzzz';

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Answer every request to `url`'s origin from here, so a redirect to it
 *  never leaves this machine, and count the requests it gets. */
async function landAt(page: Page, url: string): Promise<{ readonly hits: number }> {
  const counter = { hits: 0 };
  await page.route(`${new URL(url).origin}/**`, (route) => {
    counter.hits++;
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>landed</title><p>landed</p>' });
  });
  return counter;
}

/** Open `/#<fragment>` and wait for the overlay to show the decoded target;
 *  the model loads behind it, so this is the long wait. */
async function openRedirect(page: Page, fragment: string, target: string): Promise<void> {
  await page.goto(`/#${fragment}`);
  await expect(page.locator(testIdSelector(TESTID.redirectOverlay))).toBeVisible();
  await expect(page.locator(testIdSelector(TESTID.redirectTarget))).toHaveText(target, { timeout: MODEL_LOAD });
}

test('redirect: an http target is decoded, counted down to, and opened', async ({ page }) => {
  const watch = watchErrors(page);
  const landed = await landAt(page, HN.url);
  await openRedirect(page, HN.base64url, HN.url);
  const overlay = page.locator(testIdSelector(TESTID.redirectOverlay));
  await expect(overlay).toHaveAttribute('role', 'dialog');
  await expect(page.locator('#redirect-title')).toHaveText(new RegExp(`^\\s*decoded\\s+#${escapeRegExp(HN.base64url)}\\s*$`));
  const note = page.locator(testIdSelector(TESTID.redirectNote));
  await expect(note).toHaveText('redirecting in 2…');
  // "1…" is on screen for one 700 ms tick: poll faster than the assertion
  // library's back-off, which would sample it once at best.
  await page.waitForFunction(
    (sel) => document.querySelector(sel)?.textContent === 'redirecting in 1…',
    testIdSelector(TESTID.redirectNote),
    { polling: 50 },
  );
  await page.waitForURL(HN.url);
  expect(page.url()).toBe(HN.url);
  await expect(page.locator('p')).toHaveText('landed');
  expect(landed.hits).toBeGreaterThan(0);
  watch.expectClean();
});

test('redirect: a non-http target is shown and never opened', async ({ page }) => {
  const watch = watchErrors(page);
  await page.goto('/');
  await waitForModelReady(page);
  const target = 'mailto:someone@example.com?subject=hello';
  const { fragment } = await encodeUrl(page, target);

  // a second page in the same context: the model comes from the cache
  const page2 = await page.context().newPage();
  watch.also(page2);
  await openRedirect(page2, fragment, target);
  const note = page2.locator(testIdSelector(TESTID.redirectNote));
  await expect(note).toContainText('not auto-opening a non-http(s) target');
  // longer than the whole countdown (3 × 700 ms): still here, overlay still up
  await page2.waitForTimeout(3000);
  expect(page2.url()).toContain('/#');
  await expect(page2.locator(testIdSelector(TESTID.redirectOverlay))).toBeVisible();
  await expect(note).toContainText('not auto-opening');
  await page2.close();
  watch.expectClean();
});

test('redirect: a malformed fragment is refused, and cancel closes the overlay', async ({ page }) => {
  const watch = watchErrors(page);
  await page.goto('/#abc%');
  const overlay = page.locator(testIdSelector(TESTID.redirectOverlay));
  await expect(overlay).toBeVisible();
  await expect(page.locator('#redirect-title')).toContainText('could not decode', { timeout: MODEL_LOAD });
  await expect(page.locator('#redirect-title')).toContainText('#abc%');
  await expect(page.locator(testIdSelector(TESTID.redirectNote))).toHaveText('invalid link: malformed percent-encoding');
  await expect(page.locator(testIdSelector(TESTID.redirectTarget))).toBeEmpty();
  await page.locator(testIdSelector(TESTID.redirectCancel)).click();
  await expect(overlay).toHaveCount(0);
  await expect(page.locator('.tabrow')).toBeVisible();
  watch.expectClean();
});

test('redirect: Escape closes the overlay and gives focus back to the page', async ({ page }) => {
  const watch = watchErrors(page);
  const landed = await landAt(page, HN.url);
  await openRedirect(page, HN.base64url, HN.url);
  const overlay = page.locator(testIdSelector(TESTID.redirectOverlay));
  // the dialog takes focus, so Escape works from wherever the page was
  await expect(overlay).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await page.waitForTimeout(2500); // past the countdown it would have run
  expect(page.url()).toContain('/#');
  expect(landed.hits).toBe(0);
  const focusOnPage = await page.evaluate(() => {
    const a = document.activeElement;
    return !!a && !a.closest('[data-testid="redirect-overlay"]') && document.body.contains(a);
  });
  expect(focusOnPage).toBe(true);
  await expect(page.locator('.tabrow')).toBeVisible();
  watch.expectClean();
});

test("typing a URL of one's own encodes it, and editing it changes the code", async ({ page }) => {
  const watch = watchErrors(page);
  await page.goto('/');
  await waitForModelReady(page);
  const pane = page.locator(testIdSelector(TESTID.paneEncode));
  await expect(pane.locator(testIdSelector(TESTID.redirectLink))).toHaveCount(0);
  const url = 'https://docs.example.org/guide/getting-started?lang=en#install';
  const first = await encodeUrl(page, url);
  expect(first.code.length).toBeGreaterThan(0);
  await expect(pane.locator('.stat').first()).toContainText(`${url.length} →`);
  const second = await encodeUrl(page, url + '-now');
  expect(second.code).not.toBe(first.code);
  // the decoded echo is the URL as typed
  await pane.locator(testIdSelector(TESTID.advanced)).locator('summary').click();
  await expect(pane.locator('dd.wrap')).toHaveText(url + '-now');
  watch.expectClean();
});

test('decode: every input shape reads back, and junk is refused', async ({ page }) => {
  const watch = watchErrors(page);
  await page.goto('/');
  await waitForModelReady(page);
  await page.locator('.tabs').getByRole('tab', { name: 'Decode', exact: true }).click();
  const pane = page.locator(testIdSelector(TESTID.paneDecode));
  const field = pane.locator('input[type=text]');
  const decoded = pane.locator(testIdSelector(TESTID.decodedUrl));
  const link = (code: string): string => SITE_URL + '#' + code;
  // Cleared first, and the clear waited for: two inputs in a row that decode
  // to the same URL would otherwise pass the second on the first's output.
  const enter = async (input: string): Promise<void> => {
    await field.fill('');
    await expect(decoded).toHaveCount(0);
    await field.fill(input);
    await field.press('Enter');
  };
  const expectDecodes = async (input: string, want: string, what: string): Promise<void> => {
    await enter(input);
    await expect(decoded, what).toHaveText(want, { timeout: CODEC_CALL });
    await expect(pane.getByRole('link', { name: 'open ↗' })).toHaveAttribute('href', want);
  };

  await expectDecodes(HN.base64url, HN.url, 'a bare base64url code');
  await expectDecodes(EXAMPLE.base64url, EXAMPLE.url, 'another bare base64url code');
  await expectDecodes(link(HN.emoji), HN.url, 'an emoji link');
  await expectDecodes(link(HN.base79), HN.url, 'a base79 link');
  // a marker in front of a code is a leading zero: the same URL
  await expectDecodes(link(B79_MARK + HN.base79), HN.url, 'a base79 link with an explicit ~');
  await expectDecodes(link(HN.qrAlpha), HN.url, 'a self-identifying qr-alpha link');
  await expectDecodes(link(QR_MARK + HN.qrAlpha), HN.url, 'a self-identifying qr-alpha link behind an explicit /');
  await expectDecodes(link(EXAMPLE.qrAlpha), EXAMPLE.url, 'a qr-alpha link that needs its marker');

  // junk: the message a visitor can act on, and nothing to open
  await enter(JUNK);
  await expect(pane.locator('.err')).toContainText('not a nanourl code', { timeout: CODEC_CALL });
  await expect(decoded).toHaveCount(0);
  await expect(pane.getByRole('link', { name: 'open ↗' })).toHaveCount(0);
  watch.expectClean();
});

test('copy buttons put the link and the URL on the clipboard', async ({ page, context }) => {
  const watch = watchErrors(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await waitForModelReady(page);
  const { link } = await encodeUrl(page, HN.url);
  const readClipboard = (): Promise<string> => page.evaluate(() => navigator.clipboard.readText());

  const encodePane = page.locator(testIdSelector(TESTID.paneEncode));
  await encodePane.getByRole('button', { name: 'copy', exact: true }).click();
  await expect(encodePane.getByRole('button', { name: /copied/ })).toBeVisible();
  expect(await readClipboard()).toBe(link);

  await page.locator('.tabs').getByRole('tab', { name: 'Decode', exact: true }).click();
  const decodePane = page.locator(testIdSelector(TESTID.paneDecode));
  await decodePane.locator('input[type=text]').fill(link);
  await expect(decodePane.locator(testIdSelector(TESTID.decodedUrl))).toHaveText(HN.url, { timeout: CODEC_CALL });
  await decodePane.getByRole('button', { name: 'copy', exact: true }).click();
  await expect(decodePane.getByRole('button', { name: /copied/ })).toBeVisible();
  expect(await readClipboard()).toBe(HN.url);
  watch.expectClean();
});

test('the durability section links to the model release and the CLI releases', async ({ page }) => {
  const watch = watchErrors(page);
  await page.goto('/');
  const outlive = page.locator(testIdSelector(TESTID.outlive));
  await expect(outlive).toBeVisible();
  await expect(outlive.getByRole('link', { name: 'model weights' })).toHaveAttribute('href', MODEL_RELEASE_URL);
  await expect(outlive.getByRole('link', { name: /command-line tool/ })).toHaveAttribute('href', RELEASES_URL);
  // outside every disclosure: visible before anything is expanded
  expect(await outlive.evaluate((el) => !el.closest('details'))).toBe(true);
  watch.expectClean();
});

/** What the stubbed shortener answers. */
interface ShortenReply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * Answer the short link's two remote parts from here: Turnstile's script as a
 * stub that issues a token at once, and `/api/new` with `reply`. The real
 * service is never reached, and the bodies the page posted are kept.
 */
async function stubShortener(page: Page, reply: (body: { url: string; turnstile?: string }) => ShortenReply | 'abort'): Promise<{ posted: { url: string; turnstile?: string }[] }> {
  const posted: { url: string; turnstile?: string }[] = [];
  await page.route(`${TURNSTILE_SCRIPT.split('?')[0]}*`, (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.turnstile = { render(el, o) { setTimeout(() => o.callback('e2e-token'), 0); return 'w1'; }, remove() {} };`,
    }),
  );
  await page.route(SHORTEN_API, (route) => {
    const body = route.request().postDataJSON() as { url: string; turnstile?: string };
    posted.push(body);
    const r = reply(body);
    if (r === 'abort') return route.abort('connectionfailed');
    return route.fulfill({
      status: r.status,
      contentType: 'application/json',
      headers: r.headers,
      body: r.body === undefined ? '' : JSON.stringify(r.body),
    });
  });
  return { posted };
}

const minted = (slug: string, status = 201): ShortenReply => ({ status, body: { ok: true, slug, link: `${SITE_URL}${slug}` } });

test('short link: offered before the model is ready, made once with a token, shown in lowercase, copied, and dropped when the URL changes', async ({ page, context }) => {
  const watch = watchErrors(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { posted } = await stubShortener(page, () => minted('ABC123'));
  await page.goto('/');
  const pane = page.locator(testIdSelector(TESTID.paneEncode));
  const button = pane.locator(testIdSelector(TESTID.shortLinkButton));
  await expect(button).toHaveCount(0);
  await pane.locator('textarea').fill(HN.url);
  await expect(button).toBeVisible();

  await button.click();
  const row = pane.locator(testIdSelector(TESTID.shortLink));
  await expect(row).toHaveText('qv.lc/abc123');
  expect(posted).toEqual([{ url: HN.url, turnstile: 'e2e-token' }]);
  await expect(button).toHaveCount(0);
  await expect(pane.getByText(/A short link: 6 characters, stored on qv\.lc/)).toBeVisible();

  await row.locator('..').getByRole('button', { name: 'copy', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${SITE_URL}abc123`);

  await pane.locator('textarea').fill(EXAMPLE.url);
  await expect(row).toHaveCount(0);
  await expect(button).toBeVisible();
  expect(posted).toHaveLength(1);
  watch.expectClean();
});

test('short link: an existing link is told apart from a new one', async ({ page }) => {
  const watch = watchErrors(page);
  await stubShortener(page, () => minted('EX1ST5', 200));
  await page.goto('/');
  const pane = page.locator(testIdSelector(TESTID.paneEncode));
  await pane.locator('textarea').fill(HN.url);
  await pane.locator(testIdSelector(TESTID.shortLinkButton)).click();
  await expect(pane.locator(testIdSelector(TESTID.shortLink))).toHaveText('qv.lc/ex1st5');
  await expect(pane.getByText(/This URL already had a short link/)).toBeVisible();
  watch.expectClean();
});

test('short link: a rate limit, a refusal and an unreachable server are said in words, and the button stays', async ({ page }) => {
  const watch = watchErrors(page);
  let mode: 'limit' | 'refuse' | 'down' = 'limit';
  await stubShortener(page, () => {
    if (mode === 'down') return 'abort';
    if (mode === 'refuse') return { status: 400, body: { ok: false, error: 'not an http(s) URL this service will shorten' } };
    return { status: 429, headers: { 'Retry-After': '600' }, body: { ok: false, error: 'too many links from this address; try again later' } };
  });
  await page.goto('/');
  const pane = page.locator(testIdSelector(TESTID.paneEncode));
  const button = pane.locator(testIdSelector(TESTID.shortLinkButton));
  const error = pane.locator(testIdSelector(TESTID.shortLinkError));
  await pane.locator('textarea').fill(HN.url);

  await button.click();
  await expect(error).toHaveText('too many short links from your address; try again in 10 minutes');
  await expect(button).toBeEnabled();

  mode = 'refuse';
  await button.click();
  await expect(error).toHaveText('not an http(s) URL this service will shorten');

  mode = 'down';
  await button.click();
  await expect(error).toHaveText('could not reach qv.lc; check your connection and try again');
  await expect(pane.locator(testIdSelector(TESTID.shortLink))).toHaveCount(0);
  watch.expectClean([NETWORK_FAILURE]);
});

test('short link: the QR section carries it in capitals by default, in one compact segment, and it scans', async ({ page }) => {
  const watch = watchErrors(page);
  await stubShortener(page, () => minted('ABC123'));
  await page.goto('/');
  await waitForModelReady(page);
  await loadScanner(page);
  const pane = page.locator(testIdSelector(TESTID.paneEncode));
  await encodeUrl(page, HN.url);
  const qr = page.locator(testIdSelector(TESTID.qr));
  await qr.locator('summary').click();
  await expect(qr.locator(testIdSelector(TESTID.qrTarget))).toHaveCount(0);

  await pane.locator(testIdSelector(TESTID.shortLinkButton)).click();
  await expect(pane.locator(testIdSelector(TESTID.shortLink))).toHaveText('qv.lc/abc123');
  const target = qr.locator(testIdSelector(TESTID.qrTarget));
  await expect(target).toBeVisible();
  const text = qr.locator(testIdSelector(TESTID.qrText));
  // the short link is the default the moment it exists
  await expect(text).toHaveText('HTTPS://QV.LC/ABC123');
  await expect(qr.locator(testIdSelector(TESTID.qrInfo))).toContainText('all 20 characters stored in the compact mode');
  await expect(qr.locator(testIdSelector(TESTID.qrOffer))).toHaveCount(0);
  expect(await scan(page)).toBe('HTTPS://QV.LC/ABC123');

  await target.getByRole('button', { name: 'compressed link' }).click();
  await expect(text).toContainText('#');
  await target.getByRole('button', { name: 'short link' }).click();
  await expect(text).toHaveText('HTTPS://QV.LC/ABC123');
  // a new URL drops the short link, and with it the switch
  await pane.locator('textarea').fill(EXAMPLE.url);
  await expect(target).toHaveCount(0);
  await expect(text).toContainText('#', { timeout: CODEC_CALL });
  watch.expectClean();
});
