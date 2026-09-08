import { resolve } from 'node:path';
import { test, expect } from 'playwright/test';
import type { Locator, Page } from 'playwright/test';
import { ALPHABETS, QR_ALPHA, qrText } from '../src/lib/alphabet';
import { CENTRE_LABEL_MAX, EYE_STYLES, MODULE_STYLES, STORAGE_KEY } from '../src/lib/qr/options';
import { WEB_ROOT } from '../scripts/paths';
import { atMobile, encodeFirstExample, expectNoHorizontalOverflow, TESTID, testIdSelector, waitForModelReady, watchErrors } from './helpers';
import { CODEC_CALL } from './timeouts';

// The compressor's QR section against the real build: it opens, draws the
// link, follows the alphabet strip and every control, exports, persists —
// and, the part that matters, every style of it still scans. The scan is a
// JS decoder (jsqr) injected into the page for the test only: it reads the
// rendered SVG back off a canvas, so the check is on the pixels a phone
// would see, for every module style and every alphabet, on screen and as
// exported. `dontInvert`: a symbol that only reads inverted is a failure.

/** The text the symbol decodes to — the one on screen, or the SVG the
 *  export link carries — or null when it does not scan. */
async function scan(page: Page, source: 'screen' | 'export' = 'screen'): Promise<string | null> {
  return page.evaluate(async ([sel, dl, src]) => {
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
    type Decoder = (d: Uint8ClampedArray, w: number, h: number, o?: { inversionAttempts: string }) => { data: string } | null;
    const jsQR = (window as unknown as { jsQR: Decoder }).jsQR;
    return jsQR(px.data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
  }, [testIdSelector(TESTID.qrSvg), testIdSelector(TESTID.qrSvgDownload), source]);
}

/** On screen and as exported, both must read as the expected text. */
async function expectScans(page: Page, expected: string, what: string): Promise<void> {
  expect(await scan(page, 'screen'), `${what}, on screen`).toBe(expected);
  expect(await scan(page, 'export'), `${what}, exported`).toBe(expected);
}

/** The module path's data, which changes whenever the symbol does. */
const modules = (qr: Locator): Locator => qr.locator('path.modules');

test('QR section: renders, follows every control, exports, persists, and every style of every alphabet scans', async ({ page }) => {
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

  // --- the text in the symbol is the link as shown, and it scans ---
  await expect(readout).toHaveText(await shownLink());
  await expect(info).toContainText(/version \d+, \d+×\d+ modules · \d+ bytes of text/);
  await expect(info.locator('.chip')).not.toHaveCount(0);
  await expectScans(page, (await readout.textContent()) ?? '', 'the default');
  const dBase = await modules(qr).getAttribute('d');

  // --- error correction: a different level, a different symbol, same text ---
  const level = (l: string): Locator => qr.getByRole('group', { name: 'error correction' }).getByRole('button', { name: l, exact: true });
  await level('H').click();
  await expect(level('H')).toHaveAttribute('aria-pressed', 'true');
  await expect(modules(qr)).not.toHaveAttribute('d', dBase ?? '');
  const bytesOf = async (): Promise<string> => /(\d+) bytes/.exec((await info.textContent()) ?? '')?.[1] ?? '';
  const bytesBefore = await bytesOf();
  await level('M').click();
  await expect(modules(qr)).toHaveAttribute('d', dBase ?? '');
  expect(await bytesOf()).toBe(bytesBefore);

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

  // --- PNG export produces a PNG data: URL; SVG export is our document ---
  const png = qr.locator(testIdSelector(TESTID.qrPng));
  const downloadPromise = page.waitForEvent('download');
  await png.click();
  await expect(png).toHaveAttribute('href', /^data:image\/png;base64,/);
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^nanourl-.*\.png$/);
  await expect(qr.locator(testIdSelector(TESTID.qrSvgDownload))).toHaveAttribute('href', /^data:image\/svg\+xml/);

  // --- every module style × every alphabet scans back to the encoded text;
  //     every eye style too, for the first alphabet ---
  const style = (s: string): Locator => qr.getByRole('group', { name: 'module style' }).getByRole('button', { name: s, exact: true });
  const eyes = (s: string): Locator => qr.getByRole('group', { name: 'finder style' }).getByRole('button', { name: s, exact: true });
  const alphaStrip = page.locator('.alpha');
  for (const a of ALPHABETS) {
    const before = (await linkBox.textContent()) ?? '';
    await alphaStrip.getByText(a.key, { exact: true }).click();
    if (a.id !== ALPHABETS[0].id) await expect(linkBox).not.toHaveText(before, { timeout: CODEC_CALL });
    await expect(encodePane.locator(testIdSelector(TESTID.roundtrip))).toContainText('✓', { timeout: CODEC_CALL });
    const expected = qrText(await shownLink(), a.id);
    await expect(readout).toHaveText(expected);
    if (a.id === QR_ALPHA) {
      // uppercase base, and the fragment made only of qr-alpha digits
      expect(expected).toMatch(/^HTTP:\/\/[A-Z0-9.:-]+\/#[/0-9A-Z$*+\-.:]+$/);
      await expect(info.locator('.chip').first()).toContainText('Alphanumeric');
    }
    for (const s of MODULE_STYLES) {
      const before = await svg.innerHTML();
      await style(s).click();
      await expect(style(s)).toHaveAttribute('aria-pressed', 'true');
      if (s === 'nanourl') {
        await expect(level('H')).toHaveAttribute('aria-pressed', 'true');
        await expect(qr.locator('rect.plate')).toHaveCount(1);
        await expect(qr.locator('use')).toHaveCount(1);
      }
      // every style draws a different document (the strip starts on classic)
      if (s !== 'classic') await expect.poll(() => svg.innerHTML()).not.toBe(before);
      await expectScans(page, expected, `${a.key} in the ${s} style`);
      if (a.id === ALPHABETS[0].id) {
        for (const e of EYE_STYLES) {
          const beforeEyes = await svg.innerHTML();
          await eyes(e).click();
          await expect(eyes(e)).toHaveAttribute('aria-pressed', 'true');
          if (s !== 'nanourl' && e !== 'classic') await expect.poll(() => svg.innerHTML()).not.toBe(beforeEyes);
          await expectScans(page, expected, `${a.key} in the ${s} style with ${e} eyes`);
        }
        await eyes('classic').click();
      }
    }
    await style('classic').click();
  }
  await alphaStrip.getByText(ALPHABETS[0].key, { exact: true }).click();
  await expect(linkBox).toContainText('#' + codeBase64url, { timeout: CODEC_CALL });

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
  await expect(qr.locator('use')).toHaveCount(0);
  await expect(readout).toHaveText(await shownLink());
  await expectScans(page, (await readout.textContent()) ?? '', 'caption and label');
  // the label plate on a styled symbol: dots with circular eyes
  await style('dots').click();
  await eyes('circle').click();
  await expect(qr.locator('text.label')).toHaveText('QV');
  await expectScans(page, (await readout.textContent()) ?? '', 'dots, circle eyes, a label');
  await style('classic').click();
  await eyes('classic').click();
  await level('L').click();
  await expect(qr.locator(testIdSelector(TESTID.qrWarning))).toBeVisible();
  // a label that cannot fit is an inline error, and the symbol stays scannable
  await label.fill('X'.repeat(CENTRE_LABEL_MAX + 5));
  await expect(qr.locator(testIdSelector(TESTID.qrLabelCount))).toHaveText(`${CENTRE_LABEL_MAX}/${CENTRE_LABEL_MAX}`);
  await version.fill('1');
  await expect(error).toBeVisible(); // version 1 cannot hold the link at all
  await version.fill('');
  await label.fill('');
  await caption.fill('');
  await level('M').click();

  // --- a forced mask and no quiet zone still scan, and change the symbol ---
  const mask = (v: string): Locator => qr.getByRole('group', { name: 'mask pattern' }).getByRole('button', { name: v, exact: true });
  const margin = qr.getByRole('spinbutton', { name: /quiet zone/ });
  const dAuto = await modules(qr).getAttribute('d');
  await mask('3').click();
  await expect(mask('3')).toHaveAttribute('aria-pressed', 'true');
  await margin.fill('0');
  await expect(svg).toHaveAttribute('viewBox', /^0 0 (\d+) \1$/);
  await expect(modules(qr)).not.toHaveAttribute('d', dAuto ?? '');
  await expectScans(page, (await readout.textContent()) ?? '', 'mask 3, margin 0');
  await mask('auto').click();
  await margin.fill('4');

  // --- the settings persist per browser under one key ---
  await style('dots').click();
  const stored = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
  expect(JSON.parse(stored ?? '{}')).toMatchObject({ style: 'dots', level: 'M' });

  await atMobile(page, () => expectNoHorizontalOverflow(page));
  await style('classic').click();

  watch.expectClean();
});
