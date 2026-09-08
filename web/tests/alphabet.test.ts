import { describe, it, expect } from 'vitest';
import { sniff, fragmentFor, parseLink } from '../src/lib/alphabet';

// The base79 digit table, frozen in rust/urlcodec/src/coder.rs's ALPHABET —
// copied here (not imported; it lives in Rust) so the round-trip property
// below really does cover every digit a code can start with, including '~',
// which is digit 65 and also the fragment scheme's alphabet marker (see
// below).
const B79 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~!$&'()*+,;=:@";
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

describe('alphabet', () => {
  it('sniffs', () => {
    expect(sniff('😀🍕')).toBe(2);
    expect(sniff('a.b')).toBe(0);
    expect(sniff('abcDEF_-')).toBe(null);
  });
  it('marks base79 codes that pass as base64url', () => {
    expect(fragmentFor('abc', 0)).toBe('~abc');
    expect(fragmentFor('a.b', 0)).toBe('a.b');
    expect(fragmentFor('~x', 0)).toBe('~~x');
    expect(fragmentFor('abc', 1)).toBe('abc');
  });
  it('parses links and bare codes', () => {
    expect(parseLink('https://x.y/#~abc')).toEqual({ code: 'abc', alpha: 0 });
    expect(parseLink('pDkL')).toEqual({ code: 'pDkL', alpha: null });
    expect(parseLink('https://x.y/#%F0%9F%98%80')).toEqual({ code: '😀', alpha: 2 });
    expect(parseLink('https://x.y/#%zz').error).toMatch(/percent/);
  });
});

// '~' is a legal base79 digit (coder.rs's ALPHABET ends
// "…-._~!$&'()*+,;=:@") *and* the fragment scheme's alphabet marker, so
// parseLink must not strip a leading '~' unconditionally: for a bare base79
// code beginning with '~', doing so would drop its most significant digit —
// copy the code, paste it into Decode, get a different URL back with no
// error. The marker is only meaningful where fragmentFor could have written
// it: in a fragment.
describe('code round trip: parseLink(fragmentFor(c)) === c, and parseLink(c) === c', () => {
  // Every base79 digit as a leading character, in a few shapes (single
  // digit, digit + a base64url-looking tail, digit + a tail that already
  // contains a base79-only character, and a digit doubled).
  const base79Codes = [...B79].flatMap((d) => [d, d + 'pDkLHLL', d + 'aB.cD', d + d + 'xy']);
  const base64Codes = [...B64].flatMap((d) => [d, d + 'pDkLHLL']);
  const emojiCodes = ['😀', '😀🍕', '🀄🃏🆎'];

  it.each([
    ['base79', 0 as const, base79Codes],
    ['base64url', 1 as const, base64Codes],
    ['emoji-1k', 2 as const, emojiCodes],
  ])('%s: a fragment link round-trips every code exactly', (_name, alpha, codes) => {
    for (const c of codes) {
      const link = 'https://nanourl.example/#' + fragmentFor(c, alpha);
      const parsed = parseLink(link);
      expect(parsed.error).toBeUndefined();
      expect(parsed.code, `fragment round trip for ${JSON.stringify(c)}`).toBe(c);
      // the sniffed/marked alphabet must never contradict the alphabet that
      // built the fragment (null = "ambiguous, caller's toggle decides")
      if (parsed.alpha !== null) expect(parsed.alpha).toBe(alpha);
    }
  });

  it.each([
    ['base79', 0 as const, base79Codes],
    ['base64url', 1 as const, base64Codes],
    ['emoji-1k', 2 as const, emojiCodes],
  ])('%s: a bare code is passed through untouched', (_name, alpha, codes) => {
    for (const c of codes) {
      const parsed = parseLink(c);
      expect(parsed.error).toBeUndefined();
      expect(parsed.code, `bare round trip for ${JSON.stringify(c)}`).toBe(c);
      if (parsed.alpha !== null) expect(parsed.alpha).toBe(alpha);
    }
  });

  it('a percent-encoded fragment still round-trips (emoji, and a base79 code that needs the marker)', () => {
    for (const c of ['😀🍕', 'pDkLHLL', '~pDkLHLL']) {
      const alpha = c.startsWith('😀') ? (2 as const) : (0 as const);
      const link = 'https://nanourl.example/#' + encodeURIComponent(fragmentFor(c, alpha));
      expect(parseLink(link).code).toBe(c);
    }
  });
});
