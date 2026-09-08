import { resolve } from 'node:path';
import { test, expect } from 'playwright/test';
import type { Locator, Page } from 'playwright/test';
import { ALPHABETS, QR_ALPHA, qrText } from '../src/lib/alphabet';
import { CENTRE_LABEL_MAX, CORNER_TYPES, MODULE_STYLES, STORAGE_KEY, isUnscannable } from '../src/lib/qr/options';
import { WEB_ROOT } from '../scripts/paths';
import { atMobile, encodeFirstExample, expectNoHorizontalOverflow, TESTID, testIdSelector, waitForModelReady, watchErrors } from './helpers';
import { CODEC_CALL } from './timeouts';

// The compressor's QR section against the real build: it opens, draws the
// link, follows the alphabet strip and every control, exports, persists —
// and, the part that matters, every style of it still scans. The scan is a
// JS decoder (jsqr) injected into the page for the test only: it reads the
// rendered SVG back off a canvas, so the check is on the pixels a phone
// would see, on screen and as exported, with inversion OFF: a symbol that
// only reads inverted is a failure. Under the dark-mode switch the check is
// the other way round: the raw pixels must NOT read, and the pixels
// inverted must — the inversion done here on the canvas, since jsqr 1.4's
// own `onlyInvert` scans a bitmap it never builds.

type Inversion = 'dontInvert' | 'onlyInvert';

/** The text the symbol decodes to — the one on screen, or the SVG the
 *  export link carries — or null when it does not scan. */
async function scan(page: Page, source: 'screen' | 'export' = 'screen', inversion: Inversion = 'dontInvert'): Promise<string | null> {
  return page.evaluate(
    async ([sel, dl, src, inv]) => {
      let xml: string;
      if (src === 'export') {
        const href = document.querySelector<HTMLAnchorElement>(dl)?.getAttribute('href') ?? '';
        if (!href.startsWith('data:image/svg+xml')) return null;
        xml = decodeURIComponent(href.slice(href.indexOf(',') + 1));
      } else {
        const svg = document.querySelector<SVGSVGElement>(`${sel} svg`);
        if (!svg) return null;
        xml = new XMLSerializer().serializeToString(svg);
      }
      const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(xml);
      if (!m) return null;
      const vb = { width: Number(m[1]), height: Number(m[2]) };
      const scale = 6;
      const img = new Image();
      await new Promise<void>((ok, bad) => {
        img.onload = () => ok();
        img.onerror = () => bad(new Error('svg did not load'));
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
      });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vb.width * scale);
      canvas.height = Math.round(vb.height * scale);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const px = ctx.getImageData(0, 0, canvas.width, canvas.height);
      if (inv === 'onlyInvert') {
        for (let i = 0; i < px.data.length; i += 4) {
          px.data[i] = 255 - px.data[i];
          px.data[i + 1] = 255 - px.data[i + 1];
          px.data[i + 2] = 255 - px.data[i + 2];
        }
      }
      type Decoder = (d: Uint8ClampedArray, w: number, h: number, o?: { inversionAttempts: string }) => { data: string } | null;
      const jsQR = (window as unknown as { jsQR: Decoder }).jsQR;
      return jsQR(px.data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
    },
    [testIdSelector(TESTID.qrSvg), testIdSelector(TESTID.qrSvgDownload), source, inversion] as const,
  );
}

/** On screen and as exported, both must read as the expected text. */
async function expectScans(page: Page, expected: string, what: string, inversion: Inversion = 'dontInvert'): Promise<void> {
  expect(await scan(page, 'screen', inversion), `${what}, on screen`).toBe(expected);
  expect(await scan(page, 'export', inversion), `${what}, exported`).toBe(expected);
}

/** The module path's data, which changes whenever the symbol does. */
const modules = (qr: Locator): Locator => qr.locator('path.modules');

test('QR section: renders, follows every control, exports, persists, and every style of every alphabet scans', async ({ page }) => {
  test.setTimeout(600_000);
  const watch = watchErrors(page);

  await page.goto('/');
  await waitForModelReady(page);
  await page.addScriptTag({ path: resolve(WEB_ROOT, 'node_modules/jsqr/dist/jsQR.js') });

  const encodePane = page.locator(testIdSelector(TESTID.paneEncode));
  const { code: codeBase64url } = await encodeFirstExample(page);
  const origin = new URL(page.url()).origin;
  const linkBox = encodePane.locator(testIdSelector(TESTID.redirectLink));
  /** The full link the page shows (it drops the scheme for display). */
  const shownLink = async (): Promise<string> => origin + ((await linkBox.textContent()) ?? '').replace(/^[^/]*/, '');
  const alphaStrip = page.locator('.alpha');

  // Collapsed until asked; above the Advanced disclosure so it is the first
  // <details> of the pane.
  const qr = page.locator(testIdSelector(TESTID.qr));
  await expect(qr).toBeVisible();
  await expect(qr).not.toHaveAttribute('open', '');
  await expect(encodePane.locator('details').first()).toHaveAttribute('data-testid', TESTID.qr);
  await expect(qr.locator('svg')).toHaveCount(0);

  await qr.locator('summary').click();
  const svg = qr.locator(testIdSelector(TESTID.qrSvg)).locator('svg');
  await expect(svg).toHaveCount(1);
  await expect(svg).toHaveAttribute('viewBox', /^0 0 \d+ \d+$/);
  const readout = qr.locator(testIdSelector(TESTID.qrText));
  const info = qr.locator(testIdSelector(TESTID.qrInfo));
  const group = (name: string): Locator => qr.locator(`[data-testid="qr-group-${name}"]`);
  const opt = (groupLabel: string, name: string): Locator => qr.getByRole('group', { name: groupLabel }).getByRole('button', { name, exact: true });
  // every group opens
  for (const g of ['dots', 'corners-square', 'corners-dot', 'background', 'image', 'text', 'export']) {
    await group(g).locator('summary').click();
    await expect(group(g)).toHaveAttribute('open', '');
  }

  // --- the preview stays in view: with the Export group open and scrolled
  //     to, the symbol is still inside the viewport ---
  await group('export').locator('summary').scrollIntoViewIfNeeded();
  await qr.locator(testIdSelector(TESTID.qrDownload)).scrollIntoViewIfNeeded();
  const inView = await svg.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight && r.height > 0 && r.height <= window.innerHeight * 0.4 + 1;
  });
  expect(inView, 'the symbol stays within the viewport while the export controls are in view').toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));

  // --- the offer to switch: base64url is the default, the callout names both
  //     versions, and the button changes the page's own alphabet picker. At
  //     level M this link fits the same version either way and the callout
  //     says so; at H the byte-mode link needs a version more than the
  //     alphanumeric one, so the offer gains and the button shows ---
  const level = (l: string): Locator => qr.getByRole('group', { name: 'error correction' }).getByRole('button', { name: new RegExp(`^${l} `) });
  const offer = qr.locator(testIdSelector(TESTID.qrOffer));
  await expect(offer).toBeVisible({ timeout: CODEC_CALL });
  await expect(offer).toContainText(/would not make the QR smaller: it stays \d+×\d+ squares/);
  await expect(qr.locator(testIdSelector(TESTID.qrSwitch))).toHaveCount(0);
  await level('H').click();
  await expect(offer).toContainText(/A smaller QR is possible/);
  const offerText = ((await offer.textContent()) ?? '').replace(/\s+/g, ' ');
  expect(offerText).toMatch(/shrinks it from \d+×\d+ to \d+×\d+ squares/);
  await qr.locator(testIdSelector(TESTID.qrSwitch)).click();
  await expect(alphaStrip.locator('button[aria-pressed="true"]')).toHaveText('qr-alpha');
  await expect(linkBox).not.toContainText('#' + codeBase64url, { timeout: CODEC_CALL });
  await expect(encodePane.locator(testIdSelector(TESTID.roundtrip))).toContainText('✓', { timeout: CODEC_CALL });
  await expect(info).toContainText(/characters stored in the compact mode/);
  await expect(offer).toHaveCount(0);
  await alphaStrip.getByText(ALPHABETS[0].key, { exact: true }).click();
  await expect(linkBox).toContainText('#' + codeBase64url, { timeout: CODEC_CALL });
  await expect(encodePane.locator(testIdSelector(TESTID.roundtrip))).toContainText('✓', { timeout: CODEC_CALL });
  await level('M').click();

  // --- the text in the symbol is the link as shown, and it scans ---
  await expect(readout).toHaveText(await shownLink());
  await expect(info).toContainText(/\d+×\d+ squares \(version \d+\) · level M survives 15% damage · all \d+ characters stored as plain bytes/);
  await expectScans(page, (await readout.textContent()) ?? '', 'the default');
  const dBase = await modules(qr).getAttribute('d');

  // --- error correction: labels carry the share; a different level, a
  //     different symbol, same text ---
  await expect(level('H')).toHaveText('H 30%');
  await level('H').click();
  await expect(level('H')).toHaveAttribute('aria-pressed', 'true');
  await expect(modules(qr)).not.toHaveAttribute('d', dBase ?? '');
  await expect(info).toContainText('level H survives 30% damage');
  // the text is the same whatever the level, so the character count is too
  const charsOf = async (): Promise<string> => /(\d+) characters/.exec((await info.textContent()) ?? '')?.[1] ?? '';
  const charsBefore = await charsOf();
  await level('M').click();
  await expect(modules(qr)).toHaveAttribute('d', dBase ?? '');
  expect(await charsOf()).toBe(charsBefore);

  // --- byte mode: one segment, a note, still scans ---
  await opt('segment mode', 'byte').click();
  await expect(qr.locator(testIdSelector(TESTID.qrModeNote))).toBeVisible();
  await expect(info).toContainText(/all \d+ characters stored as plain bytes/);
  await expectScans(page, (await readout.textContent()) ?? '', 'byte mode');
  await opt('segment mode', 'auto').click();

  // --- the scheme off: the text starts at the host, and still scans ---
  await opt('scheme in the QR text', 'off').click();
  await expect(readout).toHaveText(qrText(await shownLink(), ALPHABETS[0].id, { scheme: false }));
  await expect(readout).not.toContainText('://');
  await expectScans(page, (await readout.textContent()) ?? '', 'the scheme off');
  await opt('scheme in the QR text', 'on').click();
  await expect(readout).toContainText('://');

  // --- a forced version below the minimum is an inline error, no console ---
  const version = qr.getByRole('textbox', { name: /QR version/ });
  await version.fill('1');
  const error = qr.locator(testIdSelector(TESTID.qrError));
  await expect(error).toBeVisible();
  await expect(error).toContainText(/version/i);
  await expect(qr.locator('svg')).toHaveCount(0);
  await version.fill('');
  await expect(error).toHaveCount(0);
  await expect(qr.locator('svg')).toHaveCount(1);

  // --- hints: a "?" beside every label, each explaining its control ---
  const hints = qr.locator(testIdSelector(TESTID.hint));
  expect(await hints.count()).toBe(await qr.locator('.lbl').count());
  await hints.first().hover();
  await expect(qr.locator('[role=tooltip]').first()).toBeVisible();

  // --- exports: PNG through the canvas, JPEG and WebP with quality, SVG ---
  const download = qr.locator(testIdSelector(TESTID.qrDownload));
  for (const [format, mime] of [
    ['png', 'image/png'],
    ['jpeg', 'image/jpeg'],
    ['webp', 'image/webp'],
  ] as const) {
    await opt('export format', format).click();
    await expect(download).toHaveText(`Download ${format.toUpperCase()}`);
    const downloadPromise = page.waitForEvent('download');
    await download.click();
    await expect(download).toHaveAttribute('href', /^blob:/);
    const d = await downloadPromise;
    expect(d.suggestedFilename()).toMatch(new RegExp(`^nanourl-.*\\.${format}$`));
    const type = await page.evaluate(async (href) => (await (await fetch(href)).blob()).type, (await download.getAttribute('href')) ?? '');
    expect(type).toBe(mime);
  }
  await opt('export format', 'svg').click();
  await expect(download).toHaveAttribute('href', /^data:image\/svg\+xml/);
  await qr.getByRole('textbox', { name: 'file name' }).fill('my poster');
  await expect(download).toHaveAttribute('download', 'my_poster.svg');
  await qr.getByRole('textbox', { name: 'file name' }).fill('');
  await opt('export format', 'png').click();
  // copy image: the clipboard API exists in Chromium; a refusal is a message, never a throw
  await qr.locator(testIdSelector(TESTID.qrCopy)).click();
  await expect(qr.locator('[role=status]').filter({ hasText: /copied|copy failed|cannot copy/ })).toBeVisible();

  // --- every module type × every corner type scans on the first alphabet,
  //     except the combinations the page itself warns about; both shapes ---
  const style = (s: string): Locator => opt('module style', s);
  const square = (s: string): Locator => opt('corners square type', s);
  const dot = (s: string): Locator => opt('corners dot type', s);
  const expected0 = (await readout.textContent()) ?? '';
  for (const s of MODULE_STYLES) {
    await style(s).click();
    await expect(style(s)).toHaveAttribute('aria-pressed', 'true');
    if (s === 'nanourl') {
      await expect(level('H')).toHaveAttribute('aria-pressed', 'true');
      await expect(qr.locator('rect.plate')).toHaveCount(1);
      await expect(qr.locator('use')).toHaveCount(1);
    }
    for (const t of CORNER_TYPES) {
      await square(t).click();
      await dot(t).click();
      await expect(dot(t)).toHaveAttribute('aria-pressed', 'true');
      const combo = { style: s, cornersSquareType: t, cornersDotType: t };
      if (isUnscannable(combo)) {
        await expect(qr.locator(testIdSelector(TESTID.qrUnscannable))).toBeVisible();
        continue;
      }
      await expect(qr.locator(testIdSelector(TESTID.qrUnscannable))).toHaveCount(0);
      await expectScans(page, expected0, `${s} modules with ${t} corners`);
    }
    await square('square').click();
    await dot('square').click();
    await opt('shape', 'circle').click();
    await expect(qr.locator('circle.background')).toHaveCount(1);
    await expectScans(page, expected0, `${s} modules in a circle`);
    await opt('shape', 'square').click();
  }
  await style('classic').click();
  // the logo is a setting of its own and survives the style change
  await expect(qr.locator('use')).toHaveCount(1);
  await opt('picture', 'none').click();
  await expect(qr.locator('use')).toHaveCount(0);
  await level('M').click();

  // --- every alphabet on classic, on screen and exported ---
  for (const a of ALPHABETS) {
    const before = (await linkBox.textContent()) ?? '';
    await alphaStrip.getByText(a.key, { exact: true }).click();
    if (a.id !== ALPHABETS[0].id) await expect(linkBox).not.toHaveText(before, { timeout: CODEC_CALL });
    await expect(encodePane.locator(testIdSelector(TESTID.roundtrip))).toContainText('✓', { timeout: CODEC_CALL });
    const expected = qrText(await shownLink(), a.id);
    await expect(readout).toHaveText(expected);
    if (a.id === QR_ALPHA) {
      expect(expected).toMatch(/^HTTP:\/\/[A-Z0-9.:-]+\/#[/0-9A-Z$*+\-.:]+$/);
      await expect(info).toContainText(/\d+ of \d+ characters stored in the compact mode/);
    }
    await expectScans(page, expected, `${a.key} on classic`);
  }
  await alphaStrip.getByText(ALPHABETS[0].key, { exact: true }).click();
  await expect(linkBox).toContainText('#' + codeBase64url, { timeout: CODEC_CALL });
  await expect(encodePane.locator(testIdSelector(TESTID.roundtrip))).toContainText('✓', { timeout: CODEC_CALL });

  // --- gradients and colours: a custom gradient at an angle, radial, a
  //     colour picked with the native picker, own corner paints ---
  const dotsGroup = group('dots');
  await dotsGroup.getByRole('group', { name: 'dots paint' }).getByRole('button', { name: 'gradient', exact: true }).click();
  await expect(qr.locator('linearGradient')).toHaveCount(1);
  const stop1 = dotsGroup.getByLabel('dots stop 1 colour picker');
  await stop1.fill('#224488');
  await expect(qr.locator('linearGradient stop').first()).toHaveAttribute('stop-color', '#224488');
  await expect(dotsGroup.getByLabel('dots stop 1 colour', { exact: true })).toHaveValue('#224488');
  // the default second stop is the accent, chosen to be seen; for the scan
  // the gradient ends dark, since the edge rows hold two finders
  await dotsGroup.getByLabel('dots stop 2 colour picker').fill('#003366');
  await expect(qr.locator('linearGradient stop').nth(1)).toHaveAttribute('stop-color', '#003366');
  await dotsGroup.getByRole('spinbutton', { name: 'dots gradient angle in degrees' }).fill('45');
  await dotsGroup.getByRole('spinbutton', { name: 'dots gradient angle in degrees' }).press('Enter');
  // vertical by default (x1 = x2); at 45° both axes move
  const grad = qr.locator('linearGradient');
  await expect.poll(async () => (await grad.getAttribute('x1')) !== (await grad.getAttribute('x2'))).toBe(true);
  await dotsGroup.getByRole('button', { name: 'add stop' }).click();
  await expect(dotsGroup.getByLabel(/dots stop \d colour picker/)).toHaveCount(3);
  await expectScans(page, expected0, 'a three-stop gradient at 45°');
  await dotsGroup.getByRole('group', { name: 'dots gradient type' }).getByRole('button', { name: 'radial', exact: true }).click();
  await expect(qr.locator('radialGradient')).toHaveCount(1);
  await expectScans(page, expected0, 'a radial gradient');
  await group('corners-square').getByRole('group', { name: 'corners square paint source' }).getByRole('button', { name: 'own', exact: true }).click();
  await group('corners-square').getByLabel('corners square colour picker').fill('#aa0000');
  await expect(qr.locator('path.ring')).toHaveAttribute('fill', '#aa0000');
  await expectScans(page, expected0, 'red corners');

  // --- dark mode: reads only inverted; the note shows ---
  await opt('on dark', 'on').click();
  await expect(qr.locator(testIdSelector(TESTID.qrDarkNote))).toBeVisible();
  expect(await scan(page, 'screen', 'dontInvert'), 'on dark, not inverted').toBeNull();
  expect(await scan(page, 'export', 'dontInvert'), 'on dark export, not inverted').toBeNull();
  await expectScans(page, expected0, 'on dark', 'onlyInvert');
  await opt('on dark', 'off').click();
  await qr.locator('[data-testid="qr-preset-classic"]').click();
  await expect(qr.locator('linearGradient, radialGradient')).toHaveCount(0);

  // --- caption and centre label: drawn, not encoded; the label raises the
  //     level to H, lowering it warns, and the symbol still scans ---
  const caption = qr.getByRole('textbox', { name: /caption/ });
  const label = qr.getByRole('textbox', { name: /centre plate/ });
  await level('L').click();
  await caption.fill('scan me & open');
  await label.fill('QV');
  await expect(qr.locator(testIdSelector(TESTID.qrLabelCount))).toHaveText(`2/${CENTRE_LABEL_MAX}`);
  await expect(level('H')).toHaveAttribute('aria-pressed', 'true');
  await expect(qr.locator('text.caption')).not.toHaveCount(0);
  await expect(qr.locator('text.label')).toHaveText('QV');
  await expect(readout).toHaveText(await shownLink());
  await expectScans(page, (await readout.textContent()) ?? '', 'caption and label');
  await style('dots').click();
  await square('dot').click();
  await dot('dot').click();
  await expectScans(page, (await readout.textContent()) ?? '', 'dots with circular corners and a label');
  await style('classic').click();
  await square('square').click();
  await dot('square').click();
  await level('L').click();
  await expect(qr.locator(testIdSelector(TESTID.qrWarning))).toBeVisible();
  await label.fill('X'.repeat(CENTRE_LABEL_MAX + 5));
  await expect(qr.locator(testIdSelector(TESTID.qrLabelCount))).toHaveText(`${CENTRE_LABEL_MAX}/${CENTRE_LABEL_MAX}`);
  await label.fill('');
  await caption.fill('');
  await level('M').click();

  // --- image: the logo plate at a clamped size, hide dots on and off ---
  await opt('picture', 'logo').click();
  await expect(level('H')).toHaveAttribute('aria-pressed', 'true');
  await expect(qr.locator(testIdSelector(TESTID.qrImageWarning))).toBeVisible(); // 0.4 is past what H can lose
  await expectScans(page, (await readout.textContent()) ?? '', 'the logo');
  await opt('hide background dots', 'off').click();
  await expectScans(page, (await readout.textContent()) ?? '', 'the logo over the dots');
  await opt('hide background dots', 'on').click();
  await opt('picture', 'none').click();
  await level('M').click();

  // --- a forced mask, no quiet zone, frame padding: still scan, and change the symbol ---
  const mask = (v: string): Locator => opt('mask pattern', v);
  const marginPick = (v: string): Locator => opt('quiet zone picks', v);
  const padding = qr.getByRole('spinbutton', { name: /frame padding/ });
  const dAuto = await modules(qr).getAttribute('d');
  await mask('3').click();
  await expect(mask('3')).toHaveAttribute('aria-pressed', 'true');
  await marginPick('0').click();
  await expect(svg).toHaveAttribute('viewBox', /^0 0 (\d+) \1$/);
  await expect(modules(qr)).not.toHaveAttribute('d', dAuto ?? '');
  await expectScans(page, (await readout.textContent()) ?? '', 'mask 3, margin 0');
  await padding.fill('3');
  await padding.press('Enter');
  const vb = (await svg.getAttribute('viewBox')) ?? '';
  const size = Number(vb.split(' ')[2]);
  await marginPick('4').click();
  await expect(svg).toHaveAttribute('viewBox', `0 0 ${size + 8} ${size + 8}`);
  await padding.fill('0');
  await padding.press('Enter');
  await mask('auto').click();

  // --- the settings persist per browser under one key ---
  await style('rounded').click();
  const stored = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
  expect(JSON.parse(stored ?? '{}')).toMatchObject({ style: 'rounded', level: 'M', padding: 0 });
  await qr.locator(testIdSelector(TESTID.qrReset)).click();
  await expect(style('classic')).toHaveAttribute('aria-pressed', 'true');

  await atMobile(page, () => expectNoHorizontalOverflow(page));

  watch.expectClean();
});
