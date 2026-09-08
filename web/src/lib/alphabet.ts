// Alphabet helpers: the three output alphabets, plus the fragment marking and
// link/code parsing shared by the encode/decode pages.
import type { Alphabet } from './codec/types';

/**
 * The three alphabets `rust/urlcodec/src/coder.rs` implements, in the order
 * the picker offers them: default first, then the denser and the exotic one.
 *
 * The wasm enum values are named here and nowhere else: as bare numeric
 * literals at a call site the meaning of `1` lives everywhere except where it
 * is written down. `size` is the character-set size the blurb's
 * density claim is derived from, and the same figure `scripts/numbers.ts`
 * emits for the learn page's coder section.
 */
export const ALPHABETS = [
  { id: 1, key: 'base64url', size: 64, blurb: 'conservative base64url charset (default)' },
  { id: 0, key: 'base79', size: 79, blurb: 'RFC 3986 path-segment charset, ~5% denser' },
  { id: 2, key: 'emoji-1k', size: 1024, blurb: '1024 emoji, 10 bits per glyph — ~37% fewer characters' },
] as const satisfies readonly { id: Alphabet; key: string; size: number; blurb: string }[];

/** base64url: the conservative charset every link is minted in unless the
 *  visitor asks otherwise, and the one hn-trace.json was recorded with. */
export const DEFAULT_ALPHABET: Alphabet = 1;

/** base79 — self-marking in a fragment (see `fragmentFor`). */
export const BASE79: Alphabet = 0;

/** emoji-1k — every character outside ASCII, so it needs no marker. */
export const EMOJI: Alphabet = 2;

// Characters that only ever appear in base79 output, never in base64url.
export const B79_ONLY = /[.~!$&'()*+,;=:@]/;

// non-ASCII -> emoji-1k; a base79-only char -> base79; otherwise ambiguous
// with base64url, so the caller's alphabet toggle decides.
export const sniff = (code: string): Alphabet | null =>
  // eslint-disable-next-line no-control-regex -- \x00-\x7f is the 7-bit ASCII range, not a stray control char
  /[^\x00-\x7f]/.test(code) ? EMOJI : B79_ONLY.test(code) ? BASE79 : null;

// Fragment scheme: bare = base64url. base79 self-marks via its extended
// charset; when a base79 code happens to look base64url-only (or starts with
// '~', which the fragment reader strips as a marker), prepend '~'. emoji-1k
// needs no marker — every character of it is outside ASCII.
export function fragmentFor(code: string, alpha: Alphabet): string {
  return alpha === BASE79 && (!B79_ONLY.test(code) || code.startsWith('~')) ? '~' + code : code;
}

/**
 * Accepts either a full redirect link (`https://host/#<fragment>`) or a bare
 * code, and returns the code with only the scaffolding *this app added*
 * removed.
 *
 * The '~' marker is part of the **fragment** scheme (`fragmentFor` above),
 * not part of a code. '~' is also base79 digit 65
 * (`rust/urlcodec/src/coder.rs`'s ALPHABET), and the framing is a bignum
 * radix-79 conversion whose leading digit ranges over all 79 characters — so
 * a perfectly ordinary base79 code can begin with '~'. Stripping it from a
 * *bare* code silently discards the code's most significant digit: about a
 * third of the time the truncated stream still parses as stream version 0 and
 * decodes to a plausible but completely different URL, with no error at all.
 * That is the worst failure a lossless codec has, and it was reachable
 * through the app's own copy-the-code / paste-it-back loop
 * (`Encode.svelte`'s CopyButton -> `Decode.svelte`'s input), so the marker is
 * only honoured where `fragmentFor` could have written it: after a '#'.
 *
 * A bare code keeps every character, and `sniff` still recognises a leading
 * '~' as base79 (it is in `B79_ONLY`), so nothing is lost by not stripping.
 * The invariants, both covered by a property test over every base79 digit in
 * `tests/alphabet.test.ts`:
 *
 *     parseLink('https://x/#' + fragmentFor(c, 0)).code === c
 *     parseLink(c).code === c
 */
export function parseLink(input: string): { code: string; alpha: Alphabet | null; error?: string } {
  let code = input.trim();
  const hash = code.indexOf('#');
  const fromFragment = hash >= 0;
  if (fromFragment) {
    code = code.slice(hash + 1);
    try {
      code = decodeURIComponent(code);
    } catch {
      return { code: '', alpha: null, error: 'malformed link: bad percent-encoding' };
    }
  }
  const marked = fromFragment && code.startsWith('~');
  if (marked) code = code.slice(1);
  const alpha = marked ? BASE79 : sniff(code);
  return { code, alpha };
}
