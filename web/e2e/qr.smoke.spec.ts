import { test, expect } from './fixtures';
import type { Locator, Page } from 'playwright/test';
import { ALPHABETS, QR_ALPHA, qrText } from '../src/lib/alphabet';
import { CENTRE_LABEL_MAX, CORNER_TYPES, MODULE_STYLES, PRESETS, STORAGE_KEY, applyPreset, isUnscannable } from '../src/lib/qr/options';
import { atMobile, encodeFirstExample, expectNoHorizontalOverflow, loadScanner, scan, TESTID, testIdSelector, waitForModelReady, watchErrors } from './helpers';
import type { Inversion } from './helpers';
import { CODEC_CALL } from './timeouts';

// The compressor's QR section against the real build: it opens, draws the
// link, follows the alphabet strip and every control, exports, persists, and
// every style of it still scans. The scan is a JS decoder (jsqr) injected
// into the page for the test only: it reads the rendered SVG back off a
// canvas, so the check is on the pixels a phone would see, on screen and as
// exported, with inversion OFF: a symbol that only reads inverted is a
// failure. After "invert colours" the check is the other way round: the raw
// pixels must NOT read, and the pixels inverted must; the inversion is done
// here on the canvas, since jsqr 1.4's own `onlyInvert` scans a bitmap it
// never builds.

/** On screen and as exported, both must read as the expected text. */
async function expectScans(page: Page, expected: string, what: string, inversion: Inversion = 'dontInvert'): Promise<void> {
  expect(await scan(page, 'screen', inversion), `${what}, on screen`).toBe(expected);
  expect(await scan(page, 'export', inversion), `${what}, exported`).toBe(expected);
}

/** The symbol on show: every look into the drawing is scoped to it, so an
 *  SVG elsewhere in the section can never stand in for it. */
const symbolBox = (qr: Locator): Locator => qr.locator(testIdSelector(TESTID.qrSvg));
/** The module path's data, which changes whenever the symbol does. */
const modules = (qr: Locator): Locator => symbolBox(qr).locator('path.modules');

test('QR section: renders, follows every control, exports, persists, and every style of every alphabet scans', async ({ page }) => {
  test.setTimeout(600_000);
  const watch = watchErrors(page);

  await page.goto('/');
  await waitForModelReady(page);
  await loadScanner(page);

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
  const sym = symbolBox(qr);
  const svg = sym.locator('svg');
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
  const rect = await svg.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, height: r.height, viewport: window.innerHeight };
  });
  const inView = rect.top >= 0 && rect.bottom <= rect.viewport && rect.height > 0 && rect.height <= rect.viewport * 0.4 + 1;
  expect(inView, `the symbol stays within the viewport while the export controls are in view: ${JSON.stringify(rect)}`).toBe(true);
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
  await expect(sym.locator('svg')).toHaveCount(0);
  await version.fill('');
  await expect(error).toHaveCount(0);
  await expect(sym.locator('svg')).toHaveCount(1);

  // --- hints: a "?" beside every label, each explaining its control ---
  const hints = qr.locator(testIdSelector(TESTID.hint));
  expect(await hints.count()).toBe((await qr.locator('.lbl').count()) + PRESETS.length);
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
      await expect(sym.locator('rect.plate')).toHaveCount(1);
      await expect(sym.locator('use')).toHaveCount(1);
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
    await expect(sym.locator('circle.background')).toHaveCount(1);
    await expectScans(page, expected0, `${s} modules in a circle`);
    await opt('shape', 'square').click();
  }
  await style('classic').click();
  // the logo is a setting of its own and survives the style change
  await expect(sym.locator('use')).toHaveCount(1);
  await opt('picture', 'none').click();
  await expect(sym.locator('use')).toHaveCount(0);
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
  await expect(sym.locator('linearGradient')).toHaveCount(1);
  const stop1 = dotsGroup.getByLabel('dots stop 1 colour picker');
  await stop1.fill('#224488');
  await expect(sym.locator('linearGradient stop').first()).toHaveAttribute('stop-color', '#224488');
  await expect(dotsGroup.getByLabel('dots stop 1 colour', { exact: true })).toHaveValue('#224488');
  // the default second stop is the accent, chosen to be seen; for the scan
  // the gradient ends dark, since the edge rows hold two finders
  await dotsGroup.getByLabel('dots stop 2 colour picker').fill('#003366');
  await expect(sym.locator('linearGradient stop').nth(1)).toHaveAttribute('stop-color', '#003366');
  await dotsGroup.getByRole('spinbutton', { name: 'dots gradient angle in degrees' }).fill('45');
  await dotsGroup.getByRole('spinbutton', { name: 'dots gradient angle in degrees' }).press('Enter');
  // vertical by default (x1 = x2); at 45° both axes move
  const grad = sym.locator('linearGradient');
  await expect.poll(async () => (await grad.getAttribute('x1')) !== (await grad.getAttribute('x2'))).toBe(true);
  await dotsGroup.getByRole('button', { name: 'add stop' }).click();
  await expect(dotsGroup.getByLabel(/dots stop \d colour picker/)).toHaveCount(3);
  await expectScans(page, expected0, 'a three-stop gradient at 45°');
  await dotsGroup.getByRole('group', { name: 'dots gradient type' }).getByRole('button', { name: 'radial', exact: true }).click();
  await expect(sym.locator('radialGradient')).toHaveCount(1);
  await expectScans(page, expected0, 'a radial gradient');
  await group('corners-square').getByRole('group', { name: 'corners square paint source' }).getByRole('button', { name: 'own', exact: true }).click();
  await group('corners-square').getByLabel('corners square colour picker').fill('#aa0000');
  await expect(sym.locator('path.ring')).toHaveAttribute('fill', '#aa0000');
  await expectScans(page, expected0, 'red corners');

  // --- invert colours: the config's dots take the background colour and
  //     the symbol reads only inverted; a two-colour gradient on each paint
  //     survives it (the paints swap, no colour is replaced): dark colours
  //     where the paint becomes the background, light ones where it stays
  //     on the modules or the corners ---
  await qr.locator('[data-testid="qr-preset-classic"]').click();
  const settingsNow = async (): Promise<Record<string, { color: string }>> => JSON.parse((await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY)) ?? '{}');
  const darkCases: [string, string, string, string][] = [
    ['dots', 'dots', '#224488', '#003366'],
    ['background', 'background', '#ffffff', '#dddddd'],
    ['corners-square', 'corners square', '#ffffff', '#cccccc'],
    ['corners-dot', 'corners dot', '#eeeeee', '#ffffff'],
  ];
  for (const [g, paint, c1, c2] of darkCases) {
    if (paint.startsWith('corners')) await group(g).getByRole('group', { name: `${paint} paint source` }).getByRole('button', { name: 'own', exact: true }).click();
    await group(g).getByRole('group', { name: `${paint} paint` }).getByRole('button', { name: 'gradient', exact: true }).click();
    await group(g).getByLabel(`${paint} stop 1 colour picker`).fill(c1);
    await group(g).getByLabel(`${paint} stop 2 colour picker`).fill(c2);
    const before = await settingsNow();
    await qr.locator(testIdSelector(TESTID.qrInvert)).click();
    const after = await settingsNow();
    expect(after.dots.color, `${paint}: the dots take the background colour`).toBe(before.background.color);
    expect(after.background.color).toBe(before.dots.color);
    await expect(qr.locator(testIdSelector(TESTID.qrDarkNote))).toBeVisible();
    // both chosen colours are in the document
    const shown = await sym.locator('svg').innerHTML();
    expect(shown, `${paint} stop colours after inverting`).toContain(c2);
    expect(shown, `${paint} stop colours after inverting`).toContain(c1);
    if (paint === 'dots') {
      expect(await scan(page, 'screen', 'dontInvert'), 'inverted, read as is').toBeNull();
      expect(await scan(page, 'export', 'dontInvert'), 'inverted export, read as is').toBeNull();
    }
    await expectScans(page, expected0, `${paint} gradient inverted`, 'onlyInvert');
    await qr.locator(testIdSelector(TESTID.qrInvert)).click();
    expect(await settingsNow()).toEqual(before);
    await qr.locator('[data-testid="qr-preset-classic"]').click();
  }
  await qr.locator('[data-testid="qr-preset-classic"]').click();
  await expect(sym.locator('linearGradient, radialGradient')).toHaveCount(0);
  await expect(qr.locator('[data-testid="qr-preset-classic"]')).toHaveAttribute('aria-pressed', 'true');
  // a third stop lands between the last two, and its colour stays where it is set
  await dotsGroup.getByRole('group', { name: 'dots paint' }).getByRole('button', { name: 'gradient', exact: true }).click();
  await dotsGroup.getByRole('button', { name: 'add stop' }).click();
  await expect(dotsGroup.getByRole('spinbutton', { name: 'dots stop 2 offset' })).toHaveValue('0.5');
  await dotsGroup.getByLabel('dots stop 3 colour picker').fill('#3a7c5e');
  await expect(sym.locator('linearGradient stop').nth(2)).toHaveAttribute('stop-color', '#3a7c5e');
  await qr.locator('[data-testid="qr-preset-classic"]').click();

  // --- caption and centre label: drawn, not encoded; the label raises the
  //     level to H, lowering it warns, and the symbol still scans ---
  const caption = qr.getByRole('textbox', { name: /caption/ });
  const label = qr.getByRole('textbox', { name: /centre plate/ });
  await level('L').click();
  await caption.fill('scan me & open');
  await label.fill('QV');
  await expect(qr.locator(testIdSelector(TESTID.qrLabelCount))).toHaveText(`2/${CENTRE_LABEL_MAX}`);
  await expect(level('H')).toHaveAttribute('aria-pressed', 'true');
  await expect(sym.locator('text.caption')).not.toHaveCount(0);
  await expect(sym.locator('text.label')).toHaveText('QV');
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

  // --- every preset renders, is shown as pressed, and scans ---
  for (const name of PRESETS) {
    const chip = qr.locator(`[data-testid="qr-preset-${name}"]`);
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await expect(sym.locator('svg').first()).toHaveCount(1);
    // a preset whose modules are lighter than its background reads inverted
    const p = applyPreset(name);
    const luma = (hex: string): number => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).reduce((a, b) => a + b);
    const dark = luma(p.dots.color) > luma(p.background.color);
    await expectScans(page, (await readout.textContent()) ?? '', `the ${name} preset`, dark ? 'onlyInvert' : 'dontInvert');
  }
  await qr.locator(testIdSelector(TESTID.qrReset)).click();
  await expect(qr.locator('[data-testid="qr-preset-classic"]')).toHaveAttribute('aria-pressed', 'true');

  // --- the settings persist per browser under one key ---
  await style('rounded').click();
  const stored = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
  expect(JSON.parse(stored ?? '{}')).toMatchObject({ style: 'rounded', level: 'M', padding: 0 });
  await qr.locator(testIdSelector(TESTID.qrReset)).click();
  await expect(style('classic')).toHaveAttribute('aria-pressed', 'true');

  await atMobile(page, () => expectNoHorizontalOverflow(page));

  watch.expectClean();
});
