// Every number the site prints, formatted here.
//
// One function per quantity, and callers choose the quantity, never the
// digits, except where a different precision is the point (a benchmark's 3
// decimals beside a prose figure's 1). One rendering per quantity is what
// keeps a figure from meaning two things in two places:
//
//   - 1048576 is a mebibyte, so every size that divides by it is labelled
//     MiB, and 124.8 cannot appear twice on one site under two units.
//   - a full-vocabulary distribution has pieces below one part in 100 000, so
//     the percent rendering falls back to scientific notation instead of
//     printing "0.000%" and destroying the information the panel exists to
//     show.
//   - a per-token bit cost below the display resolution prints as a bound,
//     because "0.0 b" says a token was free when it merely cost less than
//     the resolution.

/** 1 MiB. The divisor for every size this app shows. */
export const MIB = 1048576;

/** Non-breaking space between a figure and its unit: a line that wraps between
 *  "0.2" and "s" reads as two different numbers. */
export const NBSP = ' ';

/** A size already expressed in MiB: 124.8 -> "124.8 MiB". */
export const fmtMiB = (mib: number, digits = 1): string => `${mib.toFixed(digits)}${NBSP}MiB`;

/** A size in bytes: 130862112 -> "124.8 MiB". */
export const fmtBytes = (bytes: number, digits = 1): string => fmtMiB(bytes / MIB, digits);

/** A rate in bytes per second: 19084083 -> "18.2 MiB/s". */
export const fmtRate = (bytesPerSecond: number): string => `${fmtBytes(bytesPerSecond)}/s`;

/**
 * A per-token bit cost.
 *
 * Both sources round: the codec reports `bits` to 2dp on every encode, and the
 * learn page's stored trace carries the same 2dp. A token printing as "0.0 b"
 * or "0.00 b" cost less than the display resolution rather than nothing, and
 * a rounded zero next to an empty bar says the opposite. Say that instead.
 *
 * `unit` is the only thing that varies by context: a chip label has no room
 * for the word, a sentence reads badly without it, and `'none'` is for the
 * places that set the figure and its unit in different type (a `.n` monospace
 * span with the word beside it in prose) and so must keep them separate
 * elements.
 */
export function fmtBits(bits: number, digits: 1 | 2 = 1, unit: 'b' | 'bits' | 'none' = 'b'): string {
  const floor = digits === 1 ? 0.05 : 0.005;
  const value = bits < floor ? `<${(floor * 2).toFixed(digits)}` : bits.toFixed(digits);
  return unit === 'none' ? value : `${value}${NBSP}${unit}`;
}

/** Superscript digits, so an exponent survives being put in a plain string,
 *  an `{@html}` fragment and a Svelte template alike, the three places the
 *  percent below is rendered. `<sup>` markup works in only one of them. */
const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻',
};
const superscript = (n: number): string =>
  String(n)
    .split('')
    .map((c) => SUPERSCRIPT[c] ?? c)
    .join('');

/** Below this, a fixed-point percent has no significant digits left. */
const PCT_SCIENTIFIC_BELOW = 1e-3;

/**
 * A model probability as a percent: the one rendering, everywhere.
 *
 * Above 0.001% it is fixed-point to three decimals. Below that a fixed-point
 * rendering is all zeros, so it switches to scientific: `1.2×10⁻⁵%`. A URL
 * token's probability routinely lives down there, which is what makes it
 * expensive, so the low end is the end that carries the meaning.
 *
 * `bitsFallback` is the same probability expressed as `-log2(p)`, which the
 * codec reports alongside it and which keeps its precision after `prob` itself
 * has rounded (or underflowed) to zero. When given, it is what the scientific
 * branch is computed from.
 */
export function fmtPct(prob: number, bitsFallback?: number): string {
  const p = prob * 100;
  if (p >= PCT_SCIENTIFIC_BELOW) return `${p.toFixed(3)}%`;
  const q = bitsFallback === undefined ? p : 2 ** -bitsFallback * 100;
  if (!(q > 0)) return '0%';
  let e = Math.floor(Math.log10(q));
  let mantissa = q / 10 ** e;
  // 9.99e-6 rounds to "10.0", which is a mantissa of the wrong magnitude;
  // carry it into the exponent so the output is always 1.0..9.9.
  if (Number(mantissa.toFixed(1)) >= 10) {
    e += 1;
    mantissa = q / 10 ** e;
  }
  return `${mantissa.toFixed(1)}×10${superscript(e)}%`;
}

/** A `-log2(p)` bit cost back to a percent probability: 0.26 bits -> "83.6%".
 *  One decimal, because this is prose about a likely token, not a table row. */
export const probPct = (bits: number): string => `${(2 ** -bits * 100).toFixed(1)}%`;

/** A share of a whole: of a bit stream, of a parameter budget, of an
 *  attention head's weight. Never small enough to need the scientific branch
 *  `fmtPct` has. */
export const fmtShare = (fraction: number, digits = 1): string => `${(fraction * 100).toFixed(digits)}%`;

/** The compressor's headline ratio. Three decimals because the interesting
 *  differences between two URLs are in the third. */
export const fmtBitsPerChar = (bpc: number): string => bpc.toFixed(3);

/**
 * "model 86.5 bits + coder overhead 0.5 → 87 bits": where a URL's cost went.
 *
 * The compressor's advanced panel and the observatory's coder stepper render
 * this from the same `EncodeResult` fields. Returned as parts, not a
 * sentence, because the two lay them out differently (a definition list vs
 * one line of prose).
 */
export function costParts(modelBits: number, codedBits: number): { model: string; overhead: string; total: string } {
  return {
    model: fmtBits(modelBits, 1, 'none'),
    overhead: fmtBits(codedBits - modelBits, 1, 'none'),
    // The coded total is an integer count of emitted bits, never fractional:
    // print it as one (the compressor's stat line does too), not as '87.0'.
    total: String(codedBits),
  };
}

/** A duration. `digits` is the one thing callers differ on: a bench
 *  median is quoted to 3 decimals, a prose figure to 1, a round-trip to 0. */
export const fmtMs = (ms: number, digits = 0): string => `${ms.toFixed(digits)}${NBSP}ms`;

/** Seconds: "0.3 s", "6.9 s", "1:04". One decimal below a minute, because a
 *  fast cache restore is the case where the decimal carries the meaning. */
export function fmtSeconds(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}${NBSP}s`;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s - m * 60)).padStart(2, '0')}`;
}

/** A count, abbreviated: 246119680 -> "246M", 365779523 -> "366M",
 *  4919922944 -> "4.9B", 19922944000 -> "20B". One decimal below 10 of a
 *  unit, none at or above it: "19.9B" reads as a precision a training-token
 *  count does not have. */
export function fmtCount(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 10e9 ? 0 : 1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 10e6 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 10e3 ? 0 : 1)}K`;
  return `${n}`;
}

/**
 * Exact counts worth spelling out in full (a vocabulary size, an eval set),
 * locale-PINNED.
 *
 * A bare `n.toLocaleString()` renders "8,192" here and "8 192" in a French
 * browser, inside a page whose every other word is English, and beside a
 * `fmtCount` that is not localised at all. One product, one number format.
 */
export const fmtExact = (n: number): string => n.toLocaleString('en-US');

/** One decimal, for a measured figure quoted in prose: a millisecond timing
 *  or a pass count. The raw bench values carry three decimals (9.571, 3.195),
 *  which reads as a precision the median of ten runs on one laptop does not
 *  have; the source stays full precision in numbers.ts and only the rendering
 *  is rounded. */
export const oneDp = (n: number): string => n.toFixed(1);

/** A parameter count is a count: `fmtCount`. Named separately only for the
 *  call sites that read better for it, and implemented BY it, so one quantity
 *  cannot round two ways on the same page. */
export const paramsM = fmtCount;
