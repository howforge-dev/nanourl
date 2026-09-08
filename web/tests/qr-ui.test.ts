import { beforeEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import ColorField from '../src/lib/ui/ColorField.svelte';
import Hint from '../src/lib/ui/Hint.svelte';
import Qr from '../src/pages/index/Qr.svelte';
import { HINTS } from '../src/lib/qr/hints';
import { DEFAULT_SETTINGS, PRESETS, STORAGE_KEY, type QrSettings } from '../src/lib/qr/options';
import { bounded } from '../src/lib/qr/fields';
import { DEFAULT_ALPHABET, QR_ALPHA } from '../src/lib/alphabet';
import { TESTID, testIdSelector } from '../src/lib/testids';

// The QR section's own UI contracts, in jsdom: the colour field keeps its
// picker and its hex text on one value, a hint explains and is wired to
// what it explains, every hint text reads as one or two plain sentences,
// and every labelled control in the section has a hint.

let host: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    // no storage here
  }
});

const input = (el: Element, value: string, type = 'input'): void => {
  (el as HTMLInputElement).value = value;
  el.dispatchEvent(new Event(type, { bubbles: true }));
  flushSync();
};

describe('ColorField', () => {
  it('keeps the picker and the hex text on one value, in either direction', () => {
    const seen: string[] = [];
    const app = mount(ColorField, { target: host, props: { value: '#112233', label: 'ink', onchange: (c: string) => seen.push(c) } });
    flushSync();
    const picker = host.querySelector<HTMLInputElement>('input[type=color]')!;
    const text = host.querySelector<HTMLInputElement>('input[type=text]')!;
    expect(picker.value).toBe('#112233');
    expect(text.value).toBe('#112233');
    expect(picker.getAttribute('aria-label')).toBe('ink picker');
    expect(text.getAttribute('aria-label')).toBe('ink');

    input(picker, '#abcdef');
    expect(text.value).toBe('#abcdef');
    expect(seen).toEqual(['#abcdef']);

    input(text, '#12');
    expect(picker.value).toBe('#abcdef'); // a half-typed colour changes nothing
    expect(seen).toEqual(['#abcdef']);
    input(text, '#FF0000');
    expect(picker.value).toBe('#ff0000');
    expect(seen).toEqual(['#abcdef', '#ff0000']);
    unmount(app);
  });
});

describe('Hint', () => {
  it('is a "?" that points at its tooltip and toggles it on a tap', () => {
    const app = mount(Hint, { target: host, props: { id: 'hint-x', text: 'Plain words.' } });
    flushSync();
    const q = host.querySelector<HTMLButtonElement>(testIdSelector(TESTID.hint))!;
    const tip = host.querySelector('#hint-x')!;
    expect(q.getAttribute('aria-describedby')).toBe('hint-x');
    expect(tip.getAttribute('role')).toBe('tooltip');
    expect(tip.textContent).toBe('Plain words.');
    expect(q.getAttribute('aria-expanded')).toBe('false');
    q.click();
    flushSync();
    expect(q.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('.hint.open')).not.toBeNull();
    unmount(app);
  });
  it('every hint reads as one or two plain sentences', () => {
    for (const [key, text] of Object.entries(HINTS)) {
      const sentences = text.split(/[.!?](?:\s|$)/).filter((s) => s.trim());
      expect(sentences.length, key).toBeGreaterThanOrEqual(1);
      expect(sentences.length, key).toBeLessThanOrEqual(3);
      expect(text.length, key).toBeGreaterThan(30);
    }
  });
});

describe('bounded', () => {
  const ev = (value: string): Event => ({ currentTarget: { value } }) as unknown as Event;
  it('applies live only inside the bounds, and the raw text on change', () => {
    const seen: (string | number)[] = [];
    const h = bounded((v) => seen.push(v), 96, 1024);
    h.oninput(ev('2'));
    h.oninput(ev('24'));
    h.oninput(ev('240'));
    h.oninput(ev('2400'));
    h.oninput(ev('2.5'));
    expect(seen).toEqual([240]);
    h.onchange(ev('2400'));
    expect(seen).toEqual([240, '2400']);
  });
  it('an empty field waits for blur by default, and means auto at once when asked', () => {
    const waits: (string | number)[] = [];
    bounded((v) => waits.push(v), 0, 16).oninput(ev(''));
    expect(waits).toEqual([]);
    const auto: (string | number)[] = [];
    const h = bounded((v) => auto.push(v), 1, 40, { emptyIsAuto: true });
    h.oninput(ev('7'));
    h.oninput(ev(''));
    expect(auto).toEqual([7, '']);
  });
  it('accepts fractions when told to', () => {
    const seen: (string | number)[] = [];
    bounded((v) => seen.push(v), 0, 1, { integer: false }).oninput(ev('0.35'));
    expect(seen).toEqual([0.35]);
  });
});

/** Mount the section on the host and open it. */
const open = (props: { link: string; altLink?: string; code: string; alpha: 0 | 1 | 2 | 3; onalpha?: (a: number) => void }) => {
  const app = mount(Qr, { target: host, props });
  flushSync();
  const details = host.querySelector<HTMLDetailsElement>(testIdSelector(TESTID.qr))!;
  details.open = true;
  details.dispatchEvent(new Event('toggle'));
  flushSync();
  return app;
};

describe('the QR section', () => {

  it('gives every labelled control a hint, wired to the control', () => {
    const app = open({ link: 'https://qv.lc/#BAddTS_zj', code: 'BAddTS_zj', alpha: DEFAULT_ALPHABET });
    const labels = host.querySelectorAll('.lbl');
    const hints = host.querySelectorAll(testIdSelector(TESTID.hint));
    expect(labels.length).toBeGreaterThan(20);
    // one hint per label, and one per preset chip
    expect(hints.length).toBe(labels.length + PRESETS.length);
    for (const q of hints) {
      const id = q.getAttribute('aria-describedby')!;
      expect(host.querySelector(`#${id}[role=tooltip]`), id).not.toBeNull();
      expect(host.querySelector(`[aria-describedby="${id}"]:not([data-testid="${TESTID.hint}"])`), `a control described by ${id}`).not.toBeNull();
    }
    unmount(app);
  });

  it('clearing the version field returns to auto at once; clearing the width waits for blur', () => {
    const app = open({ link: 'https://qv.lc/#BAddTS_zj', code: 'BAddTS_zj', alpha: DEFAULT_ALPHABET });
    const version = host.querySelector<HTMLInputElement>('input[aria-label^="QR version"]')!;
    input(version, '1');
    expect(host.querySelector(testIdSelector(TESTID.qrError))).not.toBeNull();
    input(version, '');
    expect(host.querySelector(testIdSelector(TESTID.qrError))).toBeNull();
    expect(host.querySelector('svg')).not.toBeNull();
    const width = host.querySelector<HTMLInputElement>('input[aria-label="on-screen width in pixels"]')!;
    input(width, '');
    expect(width.value).toBe(''); // not snapped back while typing
    input(width, '', 'change');
    expect(width.value).toBe('240'); // the default, on blur
    unmount(app);
  });

  it('shows the chosen preset as pressed until a control changes, with a swatch each', () => {
    const app = open({ link: 'https://qv.lc/#BAddTS_zj', code: 'BAddTS_zj', alpha: DEFAULT_ALPHABET });
    const chip = (name: string): HTMLButtonElement => host.querySelector<HTMLButtonElement>(`[data-testid="qr-preset-${name}"]`)!;
    expect(chip('classic').getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelectorAll('.swatch svg')).toHaveLength(PRESETS.length);
    chip('ocean').click();
    flushSync();
    expect(chip('ocean').getAttribute('aria-pressed')).toBe('true');
    expect(chip('classic').getAttribute('aria-pressed')).toBe('false');
    const width = host.querySelector<HTMLInputElement>('input[aria-label="on-screen width in pixels"]')!;
    input(width, '400');
    expect(chip('ocean').getAttribute('aria-pressed')).toBe('false');
    unmount(app);
  });

  it('shows the error-correction share on each option and in the readout', () => {
    const app = open({ link: 'https://qv.lc/#BAddTS_zj', code: 'BAddTS_zj', alpha: DEFAULT_ALPHABET });
    const group = host.querySelector('[aria-label="error correction"]')!;
    expect([...group.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['L 7%', 'M 15%', 'Q 25%', 'H 30%']);
    expect(host.querySelector(testIdSelector(TESTID.qrInfo))!.textContent).toContain('level M survives 15%');
    unmount(app);
  });

  it('offers the switch to qr-alpha with both versions when it gains, and calls back with the alphabet', () => {
    const picked: number[] = [];
    const app = open({
      link: 'http://localhost/#BGUPruptvF5DHzzzzzzzzzzzzzz',
      altLink: 'http://localhost/#/BGUPRUPTVF5DH',
      code: 'BGUPruptvF5DH',
      alpha: DEFAULT_ALPHABET,
      onalpha: (a) => picked.push(a),
    });
    const offer = host.querySelector(testIdSelector(TESTID.qrOffer))!.textContent!.replace(/\s+/g, ' ');
    expect(offer).toMatch(/A smaller QR is possible/);
    expect(offer).toMatch(/shrinks it from \d+×\d+ to \d+×\d+ squares/);
    host.querySelector<HTMLButtonElement>(testIdSelector(TESTID.qrSwitch))!.click();
    expect(picked).toEqual([QR_ALPHA]);
    unmount(app);
  });
});

// Every field of the settings schema, reached through its own control: the
// change lands in exactly that field of the persisted settings (which are
// what the component holds), and shows in the document it belongs to — the
// on-screen SVG for what is drawn, the export link for the export-only
// fields, the width style for the on-screen size. A control this cannot
// reach is a defect in its markup.
describe('every settings field, through its control', () => {
  /** Where the change shows: the drawing, the export link, the on-screen
   *  width, the download name — or nowhere yet (`none`): "own" corner paint
   *  starts as the dots' colour and draws the same until its editor is
   *  used, and JPEG/WebP quality goes into a raster built on click. */
  type Observe = 'screen' | 'export' | 'width' | 'name' | 'none';
  interface Case {
    field: keyof QrSettings;
    /** Fields the control changes beside its own, by design: a picture or a
     *  label raises the level to H the first time. */
    also?: (keyof QrSettings)[];
    /** What has to be true before the control is touched. */
    before?: (h: HTMLElement) => void | Promise<void>;
    act: (h: HTMLElement) => void;
    observe: Observe;
  }
  const q = <T extends Element>(h: HTMLElement, sel: string): T => {
    const el = h.querySelector<T>(sel);
    if (!el) throw new Error(`no control ${sel}`);
    return el;
  };
  const press = (h: HTMLElement, group: string, name: string): void => {
    const btn = [...q<HTMLElement>(h, `[aria-label="${group}"]`).querySelectorAll('button')].find((b) => b.textContent?.trim() === name);
    if (!btn) throw new Error(`no option ${name} in ${group}`);
    btn.click();
    flushSync();
  };
  const type = (h: HTMLElement, label: string, value: string, event = 'input'): void => input(q(h, `[aria-label="${label}"]`), value, event);
  const paintCases = (key: keyof QrSettings, name: string, own?: (h: HTMLElement) => void): Case[] => [
    { field: key, before: own, act: (h) => type(h, `${name} colour`, '#3a7c5e'), observe: 'screen' },
    { field: key, before: own, act: (h) => press(h, `${name} paint`, 'gradient'), observe: 'screen' },
    { field: key, before: (h) => { own?.(h); press(h, `${name} paint`, 'gradient'); }, act: (h) => press(h, `${name} gradient type`, 'radial'), observe: 'screen' },
    { field: key, before: (h) => { own?.(h); press(h, `${name} paint`, 'gradient'); }, act: (h) => type(h, `${name} gradient angle in degrees`, '45', 'change'), observe: 'screen' },
    { field: key, before: (h) => { own?.(h); press(h, `${name} paint`, 'gradient'); }, act: (h) => type(h, `${name} stop 1 colour picker`, '#3a7c5e'), observe: 'screen' },
    { field: key, before: (h) => { own?.(h); press(h, `${name} paint`, 'gradient'); }, act: (h) => type(h, `${name} stop 2 colour`, '#3a7c5e'), observe: 'screen' },
    { field: key, before: (h) => { own?.(h); press(h, `${name} paint`, 'gradient'); }, act: (h) => type(h, `${name} stop 1 offset`, '0.4', 'change'), observe: 'screen' },
  ];
  const withImage = (h: HTMLElement): void => press(h, 'picture', 'logo');
  /** An upload, which is what `imageSize` and `imageMargin` size (the logo
   *  plate has its own fixed size). */
  const withUpload = async (h: HTMLElement): Promise<void> => {
    press(h, 'picture', 'upload');
    const file = q<HTMLInputElement>(h, testIdSelector(TESTID.qrImageFile));
    const png = new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], 'dot.png', { type: 'image/png' });
    Object.defineProperty(file, 'files', { value: [png] });
    file.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    flushSync();
  };
  const cases: Case[] = [
    { field: 'level', act: (h) => press(h, 'error correction', 'H 30%'), observe: 'screen' },
    { field: 'version', act: (h) => type(h, 'QR version, 1 to 40, or empty for automatic', '5'), observe: 'screen' },
    // two masks, so whichever the automatic choice was, the last is another
    { field: 'mask', act: (h) => { press(h, 'mask pattern', '3'); press(h, 'mask pattern', '6'); }, observe: 'screen' },
    { field: 'mode', act: (h) => press(h, 'segment mode', 'byte'), observe: 'screen' },
    { field: 'scheme', act: (h) => press(h, 'scheme in the QR text', 'off'), observe: 'screen' },
    { field: 'width', act: (h) => type(h, 'on-screen width in pixels', '300'), observe: 'width' },
    { field: 'scale', act: (h) => type(h, 'export scale in pixels per module', '12'), observe: 'export' },
    { field: 'margin', act: (h) => press(h, 'quiet zone picks', '0'), observe: 'screen' },
    { field: 'padding', act: (h) => type(h, 'frame padding in modules', '3'), observe: 'screen' },
    { field: 'shape', act: (h) => press(h, 'shape', 'circle'), observe: 'screen' },
    { field: 'style', act: (h) => press(h, 'module style', 'dots'), observe: 'screen' },
    { field: 'roundSize', before: (h) => type(h, 'on-screen width in pixels', '250'), act: (h) => press(h, 'round size', 'on'), observe: 'width' },
    ...paintCases('dots', 'dots'),
    { field: 'cornersSquareType', act: (h) => press(h, 'corners square type', 'dot'), observe: 'screen' },
    { field: 'cornersSquare', act: (h) => press(h, 'corners square paint source', 'own'), observe: 'none' },
    ...paintCases('cornersSquare', 'corners square', (h) => press(h, 'corners square paint source', 'own')),
    { field: 'cornersDotType', act: (h) => press(h, 'corners dot type', 'dot'), observe: 'screen' },
    { field: 'cornersDot', act: (h) => press(h, 'corners dot paint source', 'own'), observe: 'none' },
    ...paintCases('cornersDot', 'corners dot', (h) => press(h, 'corners dot paint source', 'own')),
    ...paintCases('background', 'background'),
    { field: 'transparent', act: (h) => press(h, 'background', 'transparent'), observe: 'screen' },
    { field: 'backgroundRound', act: (h) => type(h, 'background corner radius, 0 to 1', '0.5', 'change'), observe: 'screen' },
    { field: 'imageSource', also: ['level'], act: withImage, observe: 'screen' },
    { field: 'imageSize', before: withUpload, act: (h) => type(h, 'image size as a share of the code, 0 to 1', '0.1', 'change'), observe: 'screen' },
    { field: 'imageMargin', before: withUpload, act: (h) => type(h, 'image margin in pixels', '10'), observe: 'screen' },
    { field: 'hideBackgroundDots', before: withImage, act: (h) => press(h, 'hide background dots', 'off'), observe: 'screen' },
    { field: 'caption', act: (h) => type(h, 'caption drawn under the code', 'scan me'), observe: 'screen' },
    { field: 'centreLabel', also: ['level'], act: (h) => type(h, 'short text drawn on the centre plate in place of the picture', 'QV'), observe: 'screen' },
    { field: 'format', act: (h) => press(h, 'export format', 'svg'), observe: 'name' },
    { field: 'quality', before: (h) => press(h, 'export format', 'jpeg'), act: (h) => type(h, 'jpeg quality, 0.05 to 1', '0.5', 'change'), observe: 'none' },
    { field: 'fileName', act: (h) => type(h, 'file name', 'poster'), observe: 'name' },
  ];

  it('covers every key of the schema', () => {
    const covered = new Set(cases.map((c) => c.field));
    const uncovered = (Object.keys(DEFAULT_SETTINGS) as (keyof QrSettings)[]).filter((k) => !covered.has(k) && k !== 'imageData');
    expect(uncovered).toEqual([]);
  });

  it('an upload lands in imageData and is drawn', async () => {
    const app = open({ link: 'https://qv.lc/#BAddTS_zj', code: 'BAddTS_zj', alpha: DEFAULT_ALPHABET });
    press(host, 'picture', 'upload');
    const file = q<HTMLInputElement>(host, testIdSelector(TESTID.qrImageFile));
    const png = new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], 'dot.png', { type: 'image/png' });
    Object.defineProperty(file, 'files', { value: [png] });
    file.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    flushSync();
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as QrSettings;
    expect(stored.imageData).toMatch(/^data:image\/png;base64,/);
    expect(host.querySelector(testIdSelector(TESTID.qrSvg))!.innerHTML).toContain('<image href="data:image/png;base64,');
    unmount(app);
  });

  it('invert colours rewrites the config visibly and undoes itself', () => {
    const app = open({ link: 'https://qv.lc/#BAddTS_zj', code: 'BAddTS_zj', alpha: DEFAULT_ALPHABET });
    const settings = (): QrSettings => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as QrSettings;
    const before = settings();
    const svgBefore = host.querySelector(testIdSelector(TESTID.qrSvg))!.innerHTML;
    q<HTMLButtonElement>(host, testIdSelector(TESTID.qrInvert)).click();
    flushSync();
    const after = settings();
    expect(after.dots.color).toBe(before.background.color);
    expect(after.background.color).toBe(before.dots.color);
    expect(host.querySelector(testIdSelector(TESTID.qrSvg))!.innerHTML).not.toBe(svgBefore);
    expect(q<HTMLInputElement>(host, '[aria-label="dots colour"]').value).toBe(before.background.color);
    expect(host.querySelector(testIdSelector(TESTID.qrDarkNote))).not.toBeNull();
    q<HTMLButtonElement>(host, testIdSelector(TESTID.qrInvert)).click();
    flushSync();
    expect(settings()).toEqual(before);
    unmount(app);
  });

  for (const c of cases) {
    {
      it(`${c.field} via its control${c.before ? ' (with a precondition)' : ''}`, async () => {
        // a qr-alpha link, so that the segment mode has two different answers
        const app = open({ link: 'https://qv.lc/#/BADDTSZJ', code: 'BADDTSZJ', alpha: QR_ALPHA });
        await c.before?.(host);
        const read = (): { settings: QrSettings; screen: string; exportHref: string; width: string; name: string } => ({
          settings: JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as QrSettings,
          screen: host.querySelector(testIdSelector(TESTID.qrSvg))!.innerHTML,
          exportHref: host.querySelector(testIdSelector(TESTID.qrSvgDownload))!.getAttribute('href') ?? '',
          width: (host.querySelector(testIdSelector(TESTID.qrSvg)) as HTMLElement).style.width,
          name: host.querySelector(testIdSelector(TESTID.qrDownload))!.getAttribute('download') ?? '',
        });
        const was = read();
        c.act(host);
        const now = read();
        // (a) exactly that field changed
        const changed = (Object.keys(DEFAULT_SETTINGS) as (keyof QrSettings)[]).filter((k) => JSON.stringify(was.settings[k]) !== JSON.stringify(now.settings[k]));
        expect(changed.sort(), `fields changed by ${c.field}`).toEqual([c.field, ...(c.also ?? [])].sort());
        // (b) it shows in the document it belongs to
        if (c.observe === 'screen') expect(now.screen, `${c.field} on screen`).not.toBe(was.screen);
        if (c.observe === 'export') expect(now.exportHref, `${c.field} in the export`).not.toBe(was.exportHref);
        if (c.observe === 'width') expect(now.width, `${c.field} in the width`).not.toBe(was.width);
        if (c.observe === 'name') expect(now.name + now.exportHref, `${c.field} in the download`).not.toBe(was.name + was.exportHref);
        unmount(app);
      });
    }
  }
});
