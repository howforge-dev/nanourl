import { describe, it, expect } from 'vitest';
import {
  ALPHABETS,
  BASE79,
  B79_MARK,
  B79_ONLY,
  DEFAULT_ALPHABET,
  EMOJI,
  QR_ALPHA,
  QR_MARK,
  QR_ONLY,
  QR_SHAPE,
  bareFor,
  fragmentFor,
  parseLink,
  qrText,
  sniff,
} from '../src/lib/alphabet';
import type { Alphabet } from '../src/lib/codec/types';

// The digit tables, frozen in rust/urlcodec/src/coder.rs — copied here (not
// imported; they live in Rust) so the properties below really do cover every
// digit, including each table's digit 0, which is its marker.
const B79 = "~ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._!$&'()*+,;=:@";
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const QR = '/0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ$*+-.:';

/** xorshift32, so the sampled codes are the same on every run. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x1_0000_0000;
  };
}

/** `n` random codes over `digits`, 1 to 16 characters long, never starting
 *  with digit 0 — the codec writes no leading zero. */
function sample(digits: string, n: number, seed: number): string[] {
  const r = rng(seed);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const len = 1 + Math.floor(r() * 16);
    let c = '';
    for (let k = 0; k < len; k++) c += digits[(k === 0 ? 1 : 0) + Math.floor(r() * (digits.length - (k === 0 ? 1 : 0)))];
    out.push(c);
  }
  return out;
}

describe('alphabet', () => {
  it('sizes and markers agree with the digit tables', () => {
    const size = (id: Alphabet): number => ALPHABETS.find((a) => a.id === id)?.size ?? 0;
    expect(B79.length).toBe(size(BASE79));
    expect(B64.length).toBe(size(DEFAULT_ALPHABET));
    expect(QR.length).toBe(size(QR_ALPHA));
    expect(B79[0]).toBe(B79_MARK);
    expect(QR[0]).toBe(QR_MARK);
    // each marker is a digit of its own table only
    expect(B64).not.toContain(B79_MARK);
    expect(QR).not.toContain(B79_MARK);
    expect(B64).not.toContain(QR_MARK);
    expect(B79).not.toContain(QR_MARK);
  });
  it('derives its character classes from the digit tables', () => {
    expect([...QR].every((d) => QR_SHAPE.test(d))).toBe(true);
    expect([...B79].filter((d) => !QR.includes(d)).some((d) => QR_SHAPE.test(d))).toBe(false);
    const qrOnly = [...QR].filter((d) => !B64.includes(d) && d !== QR_MARK).join('');
    expect(qrOnly).toBe('$*+.:');
    expect([...QR].filter((d) => QR_ONLY.test(d)).join('')).toBe(qrOnly);
    expect([...B79].filter((d) => B79_ONLY.test(d)).join('')).toBe([...B79].filter((d) => !B64.includes(d)).join(''));
    expect([...qrOnly].every((d) => B79_ONLY.test(d))).toBe(true);
    expect(B79_ONLY.test(B79_MARK)).toBe(true);
  });
  it('sniffs', () => {
    expect(sniff('😀🍕')).toBe(EMOJI);
    expect(sniff('a.b')).toBe(BASE79);
    expect(sniff('~abc')).toBe(BASE79);
    expect(sniff('abcDEF_-')).toBe(null);
    // a '/' anywhere is qr-alpha
    expect(sniff('/ABC')).toBe(QR_ALPHA);
    expect(sniff('AB/C')).toBe(QR_ALPHA);
    // unmarked: all qr-alpha digits with one base64url lacks
    expect(sniff('AB$C')).toBe(QR_ALPHA);
    expect(sniff('A.B')).toBe(QR_ALPHA);
    // all qr-alpha digits but none base64url lacks: ambiguous, base64url
    expect(sniff('ABC')).toBe(null);
    expect(sniff('AB-C')).toBe(null);
    expect(sniff('0123456789')).toBe(null);
    // a lowercase letter or a base79-only digit outside the qr set: base79
    expect(sniff('Ab$C')).toBe(BASE79);
    expect(sniff('AB$C!')).toBe(BASE79);
    expect(sniff('~AB$C')).toBe(BASE79);
    expect(sniff('')).toBe(null);
  });
  it('marks base79 codes that pass as base64url or have the qr-alpha shape, once', () => {
    expect(bareFor('abc', BASE79)).toBe('~abc');
    expect(bareFor('a.b', BASE79)).toBe('a.b');
    expect(bareFor('AB$C', BASE79)).toBe('~AB$C');
    expect(bareFor('ABC', BASE79)).toBe('~ABC');
    expect(bareFor('Ab$C', BASE79)).toBe('Ab$C');
    expect(bareFor('~abc', BASE79)).toBe('~abc');
    expect(bareFor('abc', DEFAULT_ALPHABET)).toBe('abc');
    expect(bareFor('ABC', DEFAULT_ALPHABET)).toBe('ABC');
    expect(fragmentFor).toBe(bareFor);
  });
  it('marks a qr-alpha code only when nothing in it says qr-alpha, once', () => {
    expect(bareFor('ABC', QR_ALPHA)).toBe('/ABC');
    expect(bareFor('AB-C', QR_ALPHA)).toBe('/AB-C');
    expect(bareFor('AB.C', QR_ALPHA)).toBe('AB.C');
    expect(bareFor('A$B*C+D.E:F', QR_ALPHA)).toBe('A$B*C+D.E:F');
    expect(bareFor('/ABC', QR_ALPHA)).toBe('/ABC');
    expect(bareFor('AB/C', QR_ALPHA)).toBe('AB/C');
    expect(bareFor('😀', EMOJI)).toBe('😀');
  });
  it('parses links and bare codes without stripping anything', () => {
    expect(parseLink('https://x.y/#~abc')).toEqual({ code: '~abc', alpha: BASE79 });
    expect(parseLink('~abc')).toEqual({ code: '~abc', alpha: BASE79 });
    expect(parseLink('pDkL')).toEqual({ code: 'pDkL', alpha: null });
    expect(parseLink('https://x.y/#%F0%9F%98%80')).toEqual({ code: '😀', alpha: EMOJI });
    expect(parseLink('https://x.y/#%zz').error).toMatch(/percent/);
    expect(parseLink('https://x.y/#/ABC')).toEqual({ code: '/ABC', alpha: QR_ALPHA });
    expect(parseLink('https://x.y/#%2FABC')).toEqual({ code: '/ABC', alpha: QR_ALPHA });
    expect(parseLink('https://x.y/#AB.C')).toEqual({ code: 'AB.C', alpha: QR_ALPHA });
    expect(parseLink('HTTPS://X.Y/#AB$C')).toEqual({ code: 'AB$C', alpha: QR_ALPHA });
    expect(parseLink('/ABC')).toEqual({ code: '/ABC', alpha: QR_ALPHA });
    expect(parseLink('https://x.y/#~AB.C')).toEqual({ code: '~AB.C', alpha: BASE79 });
    expect(parseLink('  qv.lc/#~pDkL  ')).toEqual({ code: '~pDkL', alpha: BASE79 });
  });
});

// A marker is digit 0 of its table, which the codec never writes first, so
// writing one in front of a code is a leading zero the decoder ignores —
// nothing is stripped anywhere, and a marked code reads the same bare and in
// a fragment. The properties below hold that over every digit, a large
// random sample per alphabet, and the hand-built worst cases: all-uppercase
// base64url codes, base79 codes of the qr-alpha shape with and without one
// of `$*+.:`, qr-alpha codes with only `0-9A-Z-`, with only `$*+.:`, and
// codes that start with a marker.
describe('code round trip: parseLink of a fragment and of a bare spelling', () => {
  const base79Codes = [
    ...[...B79.slice(1)].flatMap((d) => [d, d + 'pDkLHLL', d + 'aB.cD', d + d + 'xy', d + 'AB$C', d + 'ABC']),
    ...sample(B79, 3000, 7),
    ...sample(QR.slice(1), 500, 11),
    'ABC',
    'AB$C',
    'A$B*C+D-E.F:G',
    '0123456789',
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    'tilde~inside',
    'x~',
  ];
  const base64Codes = [
    ...[...B64].flatMap((d) => [d, d + 'pDkLHLL', d + 'ABC', d + d]),
    ...sample(B64, 3000, 13),
    'ABC',
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    '0123456789',
    'AB-C',
    'A-B_C',
  ];
  const emojiCodes = ['😀', '😀🍕', '🀄🃏🆎'];
  const qrCodes = [
    ...[...QR.slice(1)].flatMap((d) => [d, d + 'PDKLHLL', d + 'A.B', d + d + 'XY', d + 'ABC', d + '/Z']),
    ...sample(QR, 3000, 17),
    'ABC',
    'AB$C',
    'AB-C',
    'A$B*C+D-E.F:G',
    '$*+.:',
    '0123456789',
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    'AB/C',
  ];

  const cases: [string, Alphabet, string[]][] = [
    ['base79', BASE79, base79Codes],
    ['base64url', DEFAULT_ALPHABET, base64Codes],
    ['emoji-1k', EMOJI, emojiCodes],
    ['qr-alpha', QR_ALPHA, qrCodes],
  ];
  const marker: Record<number, string> = { [BASE79]: B79_MARK, [QR_ALPHA]: QR_MARK };

  it.each(cases)('%s: the spelling is the code or one marker digit then the code', (_name, alpha, codes) => {
    for (const c of codes) {
      const spelled = bareFor(c, alpha);
      expect([c, (marker[alpha] ?? '') + c], `spelling of ${JSON.stringify(c)}`).toContain(spelled);
      if (spelled !== c) expect(c.startsWith(marker[alpha])).toBe(false);
      // never two markers
      expect(spelled.startsWith((marker[alpha] ?? '\0') + (marker[alpha] ?? '\0'))).toBe(false);
    }
  });

  it.each(cases)('%s: a fragment link comes back as the spelling and the alphabet', (_name, alpha, codes) => {
    for (const c of codes) {
      const spelled = fragmentFor(c, alpha);
      const parsed = parseLink('https://nanourl.example/#' + spelled);
      expect(parsed.error).toBeUndefined();
      expect(parsed.code, `fragment round trip for ${JSON.stringify(c)}`).toBe(spelled);
      expect(parsed.alpha, `alphabet of ${JSON.stringify(c)}`).toBe(alpha === DEFAULT_ALPHABET ? null : alpha);
    }
  });

  it.each(cases)('%s: a bare spelling comes back as itself and the alphabet', (_name, alpha, codes) => {
    for (const c of codes) {
      const spelled = bareFor(c, alpha);
      const parsed = parseLink(spelled);
      expect(parsed.error).toBeUndefined();
      expect(parsed.code, `bare round trip for ${JSON.stringify(c)}`).toBe(spelled);
      expect(parsed.alpha, `bare alphabet of ${JSON.stringify(c)}`).toBe(alpha === DEFAULT_ALPHABET ? null : alpha);
    }
  });

  it('a percent-encoded fragment still round-trips', () => {
    const marked: [string, Alphabet][] = [
      ['😀🍕', EMOJI],
      ['pDkLHLL', BASE79],
      ['AB$C', BASE79],
      ['AB$C:D', QR_ALPHA],
      ['ABCD', QR_ALPHA],
    ];
    for (const [c, alpha] of marked) {
      const link = 'https://nanourl.example/#' + encodeURIComponent(fragmentFor(c, alpha));
      const parsed = parseLink(link);
      expect(parsed.code).toBe(bareFor(c, alpha));
      expect(parsed.alpha).toBe(alpha);
    }
  });

  it('a qr-alpha code is marked exactly when it could pass as base64url', () => {
    for (const c of qrCodes) {
      const lookalike = [...c].every((d) => B64.includes(d));
      expect(bareFor(c, QR_ALPHA)).toBe(lookalike ? QR_MARK + c : c);
    }
  });
});

describe('qrText', () => {
  it('uppercases the scheme and host of a qr-alpha link, and nothing else', () => {
    expect(qrText('https://qv.lc/#/ABCD', QR_ALPHA)).toBe('HTTPS://QV.LC/#/ABCD');
    expect(qrText('https://qv.lc/#AB$C:D', QR_ALPHA)).toBe('HTTPS://QV.LC/#AB$C:D');
    // the path is case-sensitive and is left alone
    expect(qrText('https://qv.lc/Index.html#/AB', QR_ALPHA)).toBe('HTTPS://QV.LC/Index.html#/AB');
    // a port is part of the authority
    expect(qrText('http://localhost:4173/#/AB', QR_ALPHA)).toBe('HTTP://LOCALHOST:4173/#/AB');
  });
  it('leaves every other alphabet’s link exactly as it is', () => {
    for (const a of ALPHABETS) {
      if (a.id === QR_ALPHA) continue;
      expect(qrText('https://qv.lc/#pDkL', a.id)).toBe('https://qv.lc/#pDkL');
    }
    expect(qrText('https://qv.lc/#😀', EMOJI)).toBe('https://qv.lc/#😀');
  });
  it('is alphanumeric-mode text on both sides of the # for a qr-alpha link at the site root', () => {
    // '#' is the one character QR alphanumeric mode lacks; the base before
    // it and the code after it are each one alphanumeric run.
    for (const code of ['AB$*+-.:9Z', 'ABCD']) {
      const text = qrText('https://qv.lc/#' + fragmentFor(code, QR_ALPHA), QR_ALPHA);
      const [base, fragment] = text.split('#');
      expect(base).toMatch(/^[0-9A-Z $%*+\-./:]+$/);
      expect(fragment).toMatch(/^[0-9A-Z $%*+\-./:]+$/);
    }
  });
});
