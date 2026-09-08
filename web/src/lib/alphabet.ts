// Alphabet helpers: the four output alphabets, plus the marking and
// link/code parsing shared by the encode/decode pages, and the text a QR code
// of a link carries.
import type { Alphabet } from './codec/types';

/**
 * The four alphabets `rust/urlcodec/src/coder.rs` implements, in the order
 * the picker offers them: default first, then the denser one, the exotic one
 * and the one for QR codes.
 *
 * The wasm enum values are named here and nowhere else: as bare numeric
 * literals at a call site the meaning of `1` lives everywhere except where it
 * is written down. `size` is the character-set size the blurb's
 * density claim is derived from, and the same figure `scripts/numbers.ts`
 * emits for the learn page's coder section. The blurbs are what the CLI's
 * `--help` prints too, through `rust/nanourl/tests/goldens/cli.json`.
 */
export const ALPHABETS = [
  { id: 1, key: 'base64url', size: 64, blurb: 'conservative base64url charset (default)' },
  {
    id: 0,
    key: 'base79',
    size: 79,
    blurb:
      "RFC 3986 path-segment charset, ~5% shorter, but its digits include punctuation () , ; ! ' .) that chat apps and Markdown trim from the end of a link, so a pasted link can lose its last character",
  },
  { id: 2, key: 'emoji-1k', size: 1024, blurb: '1024 emoji, 10 bits per glyph, ~37% fewer characters' },
  { id: 3, key: 'qr-alpha', size: 43, blurb: 'QR alphanumeric charset (uppercase), for QR codes' },
] as const satisfies readonly { id: Alphabet; key: string; size: number; blurb: string }[];

/** base64url: the conservative charset every link is minted in unless the
 *  visitor asks otherwise, and the one hn-trace.json was recorded with. */
export const DEFAULT_ALPHABET: Alphabet = 1;

/** base79 — marked with its digit 0, `~`, when it could pass as base64url
 *  or as qr-alpha (see `bareFor`). */
export const BASE79: Alphabet = 0;

/** emoji-1k — every character outside ASCII, so it needs no marker. */
export const EMOJI: Alphabet = 2;

/** qr-alpha — 43 of QR alphanumeric mode's 45 characters (`/ 0-9 A-Z $ * + - . :`),
 *  so a link in it rides through a QR code at 5.5 bits per character instead
 *  of byte mode's 8. Marked with its digit 0, `/`, when it could pass as
 *  base64url. */
export const QR_ALPHA: Alphabet = 3;

// The markers. Each is digit 0 of its own table and a digit of no other, so
// a code never starts with one (`bits_to_string_in` writes no leading zero)
// and one written in front of a code is a leading zero: the value is
// unchanged, nothing is ever stripped, and a marker can never truncate.
export const B79_MARK = '~';
export const QR_MARK = '/';

// Characters that only ever appear in base79 output, never in base64url.
export const B79_ONLY = /[.~!$&'()*+,;=:@]/;

// A string made only of qr-alpha digits: the shape a qr-alpha code has, and
// the shape ~1 in 3,000 base79 codes of a typical length (~13 characters;
// more often for shorter ones) happen to have too, since every qr-alpha digit
// but `/` is a base79 digit.
export const QR_SHAPE = /^[0-9A-Z$*+\-.:/]+$/;

// The qr-alpha digits base64url lacks, the marker aside. One of them in a
// code of `QR_SHAPE` is what makes the code self-identifying.
export const QR_ONLY = /[$*+.:]/;

// Whether a qr-alpha code says so itself: one of the digits base64url lacks,
// or the marker.
const qrSelfMarked = (code: string): boolean => QR_ONLY.test(code) || code.includes(QR_MARK);

// non-ASCII -> emoji-1k. A '/' anywhere -> qr-alpha, since no other table
// has it; so does an unmarked qr-alpha code, all qr-alpha digits with one
// base64url lacks. Then a base79-only character (the marker among them) ->
// base79; otherwise ambiguous with base64url, so the caller's toggle
// decides.
//
// base64url is untouched by every branch: its codes never contain a marker,
// a non-ASCII character or a `QR_ONLY` digit.
export const sniff = (code: string): Alphabet | null =>
  // eslint-disable-next-line no-control-regex -- \x00-\x7f is the 7-bit ASCII range, not a stray control char
  /[^\x00-\x7f]/.test(code)
    ? EMOJI
    : code.includes(QR_MARK) || (QR_SHAPE.test(code) && QR_ONLY.test(code))
      ? QR_ALPHA
      : B79_ONLY.test(code)
        ? BASE79
        : null;

/**
 * A code as it is written down, bare or after the '#': behind its
 * alphabet's marker when nothing in it says which alphabet it is, otherwise
 * as the codec emitted it. base79 marks when it has no base79-only character
 * or has the shape of a qr-alpha code; qr-alpha marks when it could pass as
 * base64url; base64url and emoji-1k never mark. A code that already carries
 * its marker as a digit is never marked again.
 */
export function bareFor(code: string, alpha: Alphabet): string {
  if (alpha === BASE79 && (!B79_ONLY.test(code) || QR_SHAPE.test(code))) return B79_MARK + code;
  if (alpha === QR_ALPHA && !qrSelfMarked(code)) return QR_MARK + code;
  return code;
}

/** The `#fragment` that carries a code: its bare spelling, since a marker
 *  is a digit and reads the same in either place. */
export const fragmentFor = bareFor;

/**
 * Accepts either a full redirect link (`https://host/#<fragment>`) or a bare
 * code, and returns the code as written plus the alphabet it identifies.
 * Nothing is stripped: a marker is a leading zero digit, and the decoder
 * reads it as one.
 *
 * The invariants, covered by property tests over every digit and the
 * hand-built worst cases in `tests/alphabet.test.ts`:
 *
 *     parseLink('https://x/#' + fragmentFor(c, a)) is { code: bareFor(c, a), alpha: a }
 *     parseLink(bareFor(c, a))                     is { code: bareFor(c, a), alpha: a }
 *         (alpha null for base64url, which never marks)
 *     bareFor(c, a) is c, or one marker digit then c
 */
export function parseLink(input: string): { code: string; alpha: Alphabet | null; error?: string } {
  let code = input.trim();
  const hash = code.indexOf('#');
  if (hash >= 0) {
    code = code.slice(hash + 1);
    try {
      code = decodeURIComponent(code);
    } catch {
      return { code: '', alpha: null, error: 'malformed link: bad percent-encoding' };
    }
  }
  return { code, alpha: sniff(code) };
}

/**
 * The text a QR code of `link` carries.
 *
 * With `scheme` off the `https://` is dropped and the text starts at the
 * host: 8 characters fewer (about 44 bits, a version step on a small code).
 * Most phone cameras open a bare host as a link; some scanners need the
 * scheme, which is why it stays on by default.
 *
 * For qr-alpha the scheme and host are uppercased: both are case-insensitive
 * (RFC 3986 §3.1 and §3.2.2), and QR alphanumeric mode has no lowercase, so
 * `HTTPS://QV.LC/` lets the base ride in the same 5.5-bit segment as the
 * code behind it instead of forcing a byte-mode segment in front. The path
 * is case-sensitive and is left alone; at the site's root it is `/`, so the
 * base is one alphanumeric run and the code another — `HTTPS://QV.LC/#CODE`
 * unmarked, `HTTPS://QV.LC/#/CODE` marked — with only the `#` between them
 * (not an alphanumeric-mode character) in byte mode. Every other alphabet's
 * link is carried as it is — its code needs byte mode anyway.
 */
export function qrText(link: string, alpha: Alphabet, { scheme = true }: { scheme?: boolean } = {}): string {
  const text = scheme ? link : link.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  if (alpha !== QR_ALPHA) return text;
  return text.replace(/^(?:[a-z][a-z0-9+.-]*:\/\/)?[^/?#]*/i, (base) => base.toUpperCase());
}
