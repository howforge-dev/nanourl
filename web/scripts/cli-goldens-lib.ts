// The goldens that pin the Rust CLI to this app's own link handling.
//
// `nanourl decode` accepts exactly what the Decode pane accepts — a full
// redirect link, a link without its scheme, or a bare code in any of the three
// alphabets — which means `rust/nanourl/src/link.rs` is a second
// implementation of `src/lib/alphabet.ts`. Two implementations of one format
// drift, and the way this one drifts is silent: a '~' stripped where it should
// not be still decodes, to a different URL, with no error (see `parseLink`).
//
// So the cases are computed HERE, from the TypeScript, and written to
// `rust/nanourl/tests/goldens/`. `tests/cli-goldens.test.ts` fails when the
// checked-in file no longer matches this module, and the Rust side's
// `tests/link_test.rs` fails when the port no longer matches the file — so a
// change to either implementation alone breaks a gate.
import type { Alphabet } from '../src/lib/codec/types';
import { ALPHABETS, BASE79, DEFAULT_ALPHABET, EMOJI, fragmentFor, parseLink, sniff } from '../src/lib/alphabet';
import { EXAMPLE_URLS } from '../src/lib/examples';
import { MODEL_ASSET_URL, MODEL_RELEASE_URL, RELEASES_URL, REPO_URL, SITE_URL } from '../src/lib/links';

/** A code, and everything the app derives from it. */
export interface CodeCase {
  kind: 'code';
  alpha: Alphabet;
  code: string;
  /** `fragmentFor(code, alpha)` — what the app writes after the '#'. */
  fragment: string;
  /** `sniff(code)` — null where base64url and base79 are indistinguishable. */
  sniff: Alphabet | null;
  /** `parseLink(SITE_URL + '#' + fragment)`. */
  fromLink: { code: string; alpha: Alphabet | null };
  /** `parseLink(code)` — a bare code keeps every character. */
  bare: { code: string; alpha: Alphabet | null };
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
  /** Every alphabet's wire id and its name, as the picker spells it. */
  alphabets: { id: Alphabet; key: string }[];
  /** The compressor's "try:" row, encoded by the CLI parity test. */
  examples: string[];
}

// A dozen codes per alphabet, chosen for the shapes that have actually gone
// wrong rather than for coverage of the digit tables (the tables themselves
// are pinned by coder.rs's own tests). base79 therefore leads with the '~'
// cases — '~' is a legal digit AND the fragment scheme's marker — and with
// codes that contain no base79-only character at all, which are the ones
// `fragmentFor` has to mark.
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
];

const B79_CODES = [
  '~pDkLHLL',
  '~',
  '~~x',
  'a.b',
  "x!y$z&w'",
  'A(B)C*D+E',
  'F,G;H=I:J@K',
  'plainlooking',
  'Q9-_',
  '.leadingdot',
  ':atstart',
  'tilde~inside',
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

const codeCase = (code: string, alpha: Alphabet): CodeCase => {
  const fragment = fragmentFor(code, alpha);
  const fromLink = parseLink(SITE_URL + '#' + fragment);
  const bare = parseLink(code);
  return {
    kind: 'code',
    alpha,
    code,
    fragment,
    sniff: sniff(code),
    fromLink: { code: fromLink.code, alpha: fromLink.alpha },
    bare: { code: bare.code, alpha: bare.alpha },
  };
};

const parseCase = (input: string): ParseCase => {
  const p = parseLink(input);
  return { kind: 'parse', input, code: p.code, alpha: p.alpha, error: p.error ?? null };
};

// Shapes a person pastes at a terminal that the fragment cases above do not
// reach: a percent-encoded fragment, a link with no scheme, surrounding
// whitespace, an empty fragment, and the two ways percent-encoding can be
// malformed.
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
];

/** Every golden case, in a fixed order — the file is diffed, not searched. */
export function linkCases(): LinkCase[] {
  return [
    ...B64_CODES.map((c) => codeCase(c, DEFAULT_ALPHABET)),
    ...B79_CODES.map((c) => codeCase(c, BASE79)),
    ...EMOJI_CODES.map((c) => codeCase(c, EMOJI)),
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
    alphabets: ALPHABETS.map(({ id, key }) => ({ id, key })),
    examples: EXAMPLE_URLS.map(([, url]) => url),
  };
}

/** The goldens as file text: one JSON object per line, and a JSON document. */
export const linkCasesJsonl = (): string => linkCases().map((c) => JSON.stringify(c)).join('\n') + '\n';
export const cliConstantsJson = (): string => JSON.stringify(cliConstants(), null, 2) + '\n';
