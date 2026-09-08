import { beforeEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import ColorField from '../src/lib/ui/ColorField.svelte';
import Hint from '../src/lib/ui/Hint.svelte';
import Qr from '../src/pages/index/Qr.svelte';
import { HINTS } from '../src/lib/qr/hints';
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

describe('the QR section', () => {
  const open = (props: { link: string; altLink?: string; code: string; alpha: 0 | 1 | 2 | 3; onalpha?: (a: number) => void }) => {
    const app = mount(Qr, { target: host, props });
    flushSync();
    const details = host.querySelector<HTMLDetailsElement>(testIdSelector(TESTID.qr))!;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    flushSync();
    return app;
  };

  it('gives every labelled control a hint, wired to the control', () => {
    const app = open({ link: 'https://qv.lc/#BAddTS_zj', code: 'BAddTS_zj', alpha: DEFAULT_ALPHABET });
    const labels = host.querySelectorAll('.lbl');
    const hints = host.querySelectorAll(testIdSelector(TESTID.hint));
    expect(labels.length).toBeGreaterThan(20);
    // one hint per label
    expect(hints.length).toBe(labels.length);
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

  it('shows the error-correction share on each option and in the readout', () => {
    const app = open({ link: 'https://qv.lc/#BAddTS_zj', code: 'BAddTS_zj', alpha: DEFAULT_ALPHABET });
    const group = host.querySelector('[aria-label="error correction"]')!;
    expect([...group.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['L 7%', 'M 15%', 'Q 25%', 'H 30%']);
    expect(host.querySelector(testIdSelector(TESTID.qrInfo))!.textContent).toContain('level M recovers 15%');
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
    expect(offer).toMatch(/version \d+ → version \d+/);
    expect(offer).toMatch(/\d+×\d+ → \d+×\d+ modules/);
    host.querySelector<HTMLButtonElement>(testIdSelector(TESTID.qrSwitch))!.click();
    expect(picked).toEqual([QR_ALPHA]);
    unmount(app);
  });
});
