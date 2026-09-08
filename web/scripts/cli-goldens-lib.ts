// The goldens that pin the Rust CLI to this app's own link handling.
//
// `nanourl decode` accepts exactly what the Decode pane accepts (a full
// redirect link, a link without its scheme, or a bare code in any of the four
// alphabets), which means `rust/nanourl/src/link.rs` is a second
// implementation of `src/lib/alphabet.ts`. Two implementations of one format
// drift, and the way this one drifts is silent: a code read under the wrong
// alphabet still decodes, to a different URL, with no error.
//
// So the cases are computed HERE, from the TypeScript, and written to
// `rust/nanourl/tests/goldens/`. `tests/cli-goldens.test.ts` fails when the
// checked-in file no longer matches this module, and the Rust side's
// `tests/link_test.rs` fails when the port no longer matches the file, so a
// change to either implementation alone breaks a gate.
import type { Alphabet } from '../src/lib/codec/types';
import { ALPHABETS, BASE79, DEFAULT_ALPHABET, EMOJI, QR_ALPHA, bareFor, fragmentFor, parseLink, sniff } from '../src/lib/alphabet';
// The character classes the marking rules turn on, spelled here so a case
// list can say which shape it covers; `tests/cli-goldens.test.ts` asserts
// the coverage against the same classes.
import { EXAMPLE_URLS } from '../src/lib/examples';
import { MODEL_ASSET_URL, MODEL_RELEASE_URL, RELEASES_URL, REPO_URL, SITE_URL } from '../src/lib/links';

/** A code, and everything the app derives from it. */
export interface CodeCase {
  kind: 'code';
  alpha: Alphabet;
  code: string;
  /** `fragmentFor(code, alpha)`: what the app writes after the '#'. */
  fragment: string;
  /** `sniff(code)`: null where base64url and base79 are indistinguishable. */
  sniff: Alphabet | null;
  /** `parseLink(SITE_URL + '#' + fragment)`. */
  fromLink: { code: string; alpha: Alphabet | null };
  /** `bareFor(code, alpha)`, the code as written down: behind its marker
   *  digit when it could pass as another alphabet. */
  bare: string;
  /** `parseLink(bare)`: the spelling comes back as itself. */
  fromBare: { code: string; alpha: Alphabet | null };
}

/** An input string and what `parseLink` makes of it, errors included. */
export interface ParseCase {
  kind: 'parse';
  input: string;
  code: string;
  alpha: Alphabet | null;
  error: string | null;
}

export type LinkCase = CodeCase | ParseCase;

/** The off-site addresses and example URLs the CLI has to agree with. */
export interface CliConstants {
  site: string;
  repo: string;
  modelRelease: string;
  modelAsset: string;
  releases: string;
  /** The alphabet a code falls back to when sniffing cannot tell. */
  defaultAlphabet: Alphabet;
  /** Every alphabet's wire id, its name and its blurb, as the picker spells them. */
  alphabets: { id: Alphabet; key: string; blurb: string }[];
  /** The compressor's "try:" row, encoded by the CLI parity test. */
  examples: string[];
}

// A dozen or more codes per alphabet, chosen for the shapes that have gone
// wrong rather than for coverage of the digit tables (the tables themselves
// are pinned by coder.rs's own tests). base79 leads with codes that contain
// no base79-only character at all and with codes of the qr-alpha shape
// (uppercase, every digit a qr-alpha one), which are the ones `bareFor` has
// to mark, plus codes already carrying '~' as a digit, which it must not
// mark again. base64url includes the all-uppercase codes that must stay
// ambiguous, never qr-alpha.
const B64_CODES = [
  'BAddTS_zj',
  'A',
  'pDkL',
  'abcDEF_-',
  'Z9',
  '0123456789',
  '-_',
  'aB_cD-eF',
  'QQQQ',
  'zzzzzzzz',
  'A_',
  'nanoURL_42',
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'AB-C9',
];

const B79_CODES = [
  'pDkLHLL',
  'x',
  'tilde~inside',
  'x~',
  'a.b',
  "x!y$z&w'",
  'A(B)C*D+E',
  'F,G;H=I:J@K',
  'plainlooking',
  'Q9-_',
  '.leadingdot',
  ':atstart',
  'AB$C',
  'A$B*C+D-E.F:G',
  'ABC',
  'Ab$C',
];

// Every character below is a digit of coder.rs's ALPHABET_EMOJI_1K. Link
// parsing never checks a code against the digit table, but a golden made of
// characters the codec could not emit would be testing a case that cannot
// occur.
const EMOJI_CODES = [
  '😀',
  '😀🍕',
  '🀄🃏🆎',
  '⌚⌛⏩',
  '🌍🌎🌏🌐',
  '🚀',
  '🧿💡🔥',
  '♈♉♊♋',
  '⬛⬜⭐⭕',
  '🥰🥱🥳',
  '📡📢📣📤',
  '🦀🦁🦂🦃',
];

// Every character below is a digit of coder.rs's ALPHABET_QR. The shapes:
// codes that could pass as base64url (all letters, all digits, a '-'), which
// take the marker, and codes carrying one of `$*+.:` or a '/' digit, which
// identify themselves, with each of the five leading, all of them together,
// and a '/' inside.
const QR_CODES = [
  'PDKLHLL',
  'A',
  '0',
  '$ABC',
  '*ABC',
  '+ABC',
  '-ABC',
  '.ABC',
  ':ABC',
  '0123456789',
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'A$B*C+D-E.F:G',
  'AB-C9',
  'AB/C',
  '$*+.:',
];

const codeCase = (code: string, alpha: Alphabet): CodeCase => {
  const fragment = fragmentFor(code, alpha);
  const fromLink = parseLink(SITE_URL + '#' + fragment);
  const bare = bareFor(code, alpha);
  const fromBare = parseLink(bare);
  return {
    kind: 'code',
    alpha,
    code,
    fragment,
    sniff: sniff(code),
    fromLink: { code: fromLink.code, alpha: fromLink.alpha },
    bare,
    fromBare: { code: fromBare.code, alpha: fromBare.alpha },
  };
};

const parseCase = (input: string): ParseCase => {
  const p = parseLink(input);
  return { kind: 'parse', input, code: p.code, alpha: p.alpha, error: p.error ?? null };
};

// Shapes a person pastes at a terminal that the fragment cases above do not
// reach: a percent-encoded fragment, a link with no scheme, surrounding
// whitespace, an empty fragment, the two ways percent-encoding can be
// malformed, each marker percent-encoded or uppercased by a QR reader, and
// a bare marker on its own.
const PARSE_INPUTS = [
  SITE_URL + '#%F0%9F%98%80',
  SITE_URL + '#%7EpDkLHLL',
  'qv.lc/#~pDkL',
  '  BAddTS_zj  ',
  SITE_URL + '#',
  SITE_URL + '#a.b',
  SITE_URL + '#%zz',
  SITE_URL + '#abc%',
  SITE_URL + '#%F0%9F',
  SITE_URL + '#%2FABC',
  'HTTPS://QV.LC/#/ABC',
  'HTTPS://QV.LC/#A$B',
  SITE_URL + '#~AB$C',
  '/',
  '~',
  'ABC',
  'AB$C',
];

/** Every golden case, in a fixed order: the file is diffed, not searched. */
export function linkCases(): LinkCase[] {
  return [
    ...B64_CODES.map((c) => codeCase(c, DEFAULT_ALPHABET)),
    ...B79_CODES.map((c) => codeCase(c, BASE79)),
    ...EMOJI_CODES.map((c) => codeCase(c, EMOJI)),
    ...QR_CODES.map((c) => codeCase(c, QR_ALPHA)),
    ...PARSE_INPUTS.map(parseCase),
  ];
}

/** The constants the CLI hard-codes and this app owns. */
export function cliConstants(): CliConstants {
  return {
    site: SITE_URL,
    repo: REPO_URL,
    modelRelease: MODEL_RELEASE_URL,
    modelAsset: MODEL_ASSET_URL,
    releases: RELEASES_URL,
    defaultAlphabet: DEFAULT_ALPHABET,
    alphabets: ALPHABETS.map(({ id, key, blurb }) => ({ id, key, blurb })),
    examples: EXAMPLE_URLS.map(([, url]) => url),
  };
}

/** The goldens as file text: one JSON object per line, and a JSON document. */
export const linkCasesJsonl = (): string => linkCases().map((c) => JSON.stringify(c)).join('\n') + '\n';
export const cliConstantsJson = (): string => JSON.stringify(cliConstants(), null, 2) + '\n';
