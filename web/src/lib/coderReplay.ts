// Bit-exact JS replica of the wasm arithmetic coder (rust/urlcodec/src/coder.rs
// `Encoder`), rebuilt from the `clo`/`chi`/`emit`/`pend` fields codec_encode()
// already reports per token. This exists purely to DISPLAY the coder's
// step-by-step behaviour for the observatory's coder stepper; the caller
// (CoderStepper.svelte) compares `.bitstr` against the wasm's own bitstr and
// disables the stepper on any mismatch (never lies about what the coder did).
//
// PROB_BITS/TOTAL are the coder's stream-format constants (coder.rs), not
// model architecture: they never vary with n_layer/d_model/vocab, so they
// are not read from `codec.info`.
import type { Tok } from './codec/types';

const PROB_BITS = 24n;
export const TOTAL = 1n << PROB_BITS; // matches rust/urlcodec/src/coder.rs::TOTAL (16,777,216)
const MASK = (1n << 64n) - 1n;
const HALF = 1n << 63n;
const QUARTER = 1n << 62n;
const THREE_QUARTER = 3n << 62n;

/** One renormalization-loop action: an emitted 0/1 bit (possibly flushing
 * pending E3 bits) or an E3 re-center that defers a bit without writing yet. */
export interface ReplayAction {
  t: '0' | '1' | 'E3';
  /** pending bits flushed BY this action (0 for 'E3', which only defers). */
  flush: number;
  lo: number; // fractional low bound of the interval right after this action
  hi: number; // fractional high bound
  emitted: number; // total bits written to the stream after this action
  pend: number; // deferred (E3) bits outstanding after this action
}

export interface ReplayStep {
  pre: [number, number]; // [lo, hi] before this token's zoom
  post: [number, number]; // [lo, hi] right after the zoom, before renormalizing
  acts: ReplayAction[]; // the renormalization loop's real actions, in order
  prevEmitted: number; // bits written before this token started
  emitted: number; // bits written once this token's renormalization settles
  pend: number; // deferred bits outstanding at the end of this token
}

export interface ReplayResult {
  steps: ReplayStep[];
  /** The FULL stream, including the bits coder.rs's `finish()` writes after
   * the last token (see `finish` below), bit-exact equal to the wasm's own
   * `bitstr`, not just a prefix of it. */
  bitstr: string;
  /** coder.rs's `finish()`: `pending += 1; emit(low < QUARTER ? 0 : 1)`: one
   * settle bit plus `flush` copies of its complement, appended once after
   * every token (including the in-band `<eos>`) has been coded. Not tied to
   * any single token's renormalization loop, so it isn't one of `steps`'
   * `acts`; callers that want to present it as a final step do so themselves
   * (see CoderStepper.svelte). */
  finish: { bit: '0' | '1'; flush: number };
}

// Top 40 bits of a 64-bit interval bound, as a fraction of the [0,1) line;
// plenty of resolution for display.
const frac = (v: bigint): number => Number(v >> 24n) / 2 ** 40;

/** version_header(), bit for bit as coder.rs emits it: the guard bit is NOT
 * included (the caller prepends '1' itself, matching bits_to_string_in's
 * sentinel). Only stream version 0 exists today; header bit-widths for
 * versions 3-65 (8 bits) and 66-320 (16 bits) are implemented for when a new
 * stream version ships. */
export function headerBits(version: number): string {
  if (version < 0 || version > 320 || !Number.isInteger(version)) {
    throw new Error(`headerBits: stream version ${version} out of range`);
  }
  if (version <= 2) {
    return String((version >> 1) & 1) + String(version & 1);
  }
  if (version <= 65) {
    const e = version - 3;
    let h = '11';
    for (let k = 5; k >= 0; k--) h += (e >> k) & 1;
    return h;
  }
  const f = version - 66;
  let h = '11111111';
  for (let k = 7; k >= 0; k--) h += (f >> k) & 1;
  return h;
}

/** Replay the encoder's interval-halving loop over tokens already coded by
 * the wasm codec (their clo/chi are the token's true slice of the
 * probability line, as fractions of TOTAL; emit/pend are the wasm's own
 * post-token bit-stream state, used by the caller to verify this replica
 * didn't drift). Only stream version 0's algorithm is implemented: the
 * arithmetic here IS the stream format, so a future version that changes it
 * needs its own replay path rather than silently reusing this one. */
export function replay(tokens: Tok[], version: number): ReplayResult {
  if (version !== 0) {
    throw new Error(`coderReplay: no JS replica for stream version ${version} (only version 0 is implemented)`);
  }
  let low = 0n;
  let high = MASK;
  let pending = 0;
  let out = '';
  const steps: ReplayStep[] = [];
  let prevEmitted = 0;
  for (const t of tokens) {
    if (t.clo === undefined || t.chi === undefined) {
      throw new Error('coderReplay: token missing clo/chi — re-encode with a build that reports coder state');
    }
    const pre: [number, number] = [frac(low), frac(high)];
    const cl = BigInt(Math.round(t.clo * Number(TOTAL)));
    const ch = BigInt(Math.round(t.chi * Number(TOTAL)));
    const span = high - low + 1n;
    high = low + (span * ch) / TOTAL - 1n;
    low = low + (span * cl) / TOTAL;
    const post: [number, number] = [frac(low), frac(high)];
    const acts: ReplayAction[] = [];
    for (;;) {
      let kind: '0' | '1' | 'E3';
      let flush = 0;
      if (high < HALF) {
        kind = '0';
        flush = pending;
        out += '0' + '1'.repeat(pending);
        pending = 0;
      } else if (low >= HALF) {
        kind = '1';
        flush = pending;
        out += '1' + '0'.repeat(pending);
        low -= HALF;
        high -= HALF;
        pending = 0;
      } else if (low >= QUARTER && high < THREE_QUARTER) {
        kind = 'E3';
        pending += 1;
        low -= QUARTER;
        high -= QUARTER;
      } else {
        break;
      }
      low = (low << 1n) & MASK;
      high = ((high << 1n) | 1n) & MASK;
      acts.push({ t: kind, flush, lo: frac(low), hi: frac(high), emitted: out.length, pend: pending });
    }
    steps.push({ pre, post, acts, prevEmitted, emitted: out.length, pend: pending });
    prevEmitted = out.length;
  }
  // coder.rs's Encoder::finish(): consumed by DROPPING self (a one-shot
  // method), so it always runs exactly once, after every token (including
  // the terminating <eos>) has already been through encode(). It is NOT
  // part of the renormalization loop above: no interval halving, one
  // settle bit chosen from whichever quarter `low` currently sits in, plus
  // flushing whatever E3 bits were still deferred.
  pending += 1;
  const finishBit: '0' | '1' = low < QUARTER ? '0' : '1';
  const finishFlip = finishBit === '0' ? '1' : '0';
  out += finishBit + finishFlip.repeat(pending);
  return { steps, bitstr: out, finish: { bit: finishBit, flush: pending } };
}
