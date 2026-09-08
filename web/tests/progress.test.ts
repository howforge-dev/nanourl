import { describe, it, expect } from 'vitest';
import { NBSP } from '../src/lib/format';
import {
  RateMeter,
  downloadParts,
  formatEta,
  loadedSummary,
  mergeProgress,
  partsText,
  type StatusPart,
} from '../src/lib/codec/progress';

// Figures carry a non-breaking space before their unit (lib/format.ts's
// NBSP), so the readable assertions below normalise it back to a plain space.
// Sizes and seconds themselves are lib/format.ts's job, and are covered
// by tests/format.test.ts; what is this module's own is the composition
// below.
describe('formatting', () => {
  it('ETA is whole seconds — a moving average does not justify a decimal', () => {
    expect(formatEta(3_700)).toBe(`~4${NBSP}s left`);
    expect(formatEta(-5)).toBe(`~0${NBSP}s left`);
    expect(formatEta(95_000)).toBe('~1:35 left');
  });
});

describe('RateMeter', () => {
  it('reports nothing until the window holds a second of data', () => {
    const m = new RateMeter();
    expect(m.rate()).toBeNull();
    m.push(0, 0);
    expect(m.rate()).toBeNull();
    m.push(300, 3_000_000);
    // 300 ms of data: a rate from this would swing an ETA by minutes
    expect(m.rate()).toBeNull();
    expect(m.eta(100_000_000)).toBeNull();
  });

  it('measures bytes/sec once it has enough data', () => {
    const m = new RateMeter();
    m.push(0, 0);
    m.push(1_000, 10_000_000);
    m.push(2_000, 20_000_000);
    expect(m.rate()).toBeCloseTo(10_000_000, -3);
    expect(m.eta(20_000_000)).toBeCloseTo(2_000, -1);
  });

  it('tracks the CURRENT rate, not the whole-download average', () => {
    const m = new RateMeter(2000, 1000);
    // slow first 3 s (1 MiB/s), then fast (20 MiB/s)
    for (let t = 0; t <= 3_000; t += 500) m.push(t, (t / 1000) * 1_000_000);
    const slow = m.rate();
    expect(slow).toBeCloseTo(1_000_000, -4);
    for (let t = 3_500; t <= 6_000; t += 500) m.push(t, 3_000_000 + ((t - 3_000) / 1000) * 20_000_000);
    // a whole-download average here would be ~9 MiB/s; the window says ~20
    expect(m.rate()!).toBeGreaterThan(15_000_000);
  });

  it('never reports a negative or zero rate as an ETA', () => {
    const m = new RateMeter();
    m.push(0, 5_000_000);
    m.push(2_000, 5_000_000); // stalled
    expect(m.rate()).toBeNull();
    expect(m.eta(1_000)).toBeNull();
  });
});

describe('downloadParts', () => {
  const base = { got: 54_857_728, total: 130_876_112, elapsedMs: 3_100, rate: null, etaMs: null, fromCache: false };

  it('omits speed and ETA while the window is still filling', () => {
    expect(partsText(downloadParts(base)).replace(/\u00a0/g, ' ')).toBe('124.8 MiB · 52.3 MiB downloaded · 3.1 s elapsed');
  });

  it('adds speed and ETA once they mean something', () => {
    const parts = downloadParts({ ...base, rate: 19_084_083, etaMs: 4_000 });
    expect(partsText(parts).replace(/\u00a0/g, ' ')).toBe('124.8 MiB · 52.3 MiB downloaded · 18.2 MiB/s · 3.1 s elapsed · ~4 s left');
  });

  it('says restoring, not downloading, when every byte is a cache hit', () => {
    expect(partsText(downloadParts({ ...base, fromCache: true })).replace(/\u00a0/g, ' ')).toBe(
      'restoring · 52.3 MiB of 124.8 MiB · from cache…',
    );
  });

  // The restore line must quote the bytes actually restored (`got`), not the
  // artifact `total`; otherwise a bucket holding only the ~1 MiB wasm would
  // claim to be restoring the whole 124.8 MiB artifact from cache.
  it('quotes the bytes actually restored, not the artifact total', () => {
    const early = partsText(downloadParts({ ...base, got: 1_048_576, fromCache: true })).replace(/\u00a0/g, ' ');
    expect(early).toBe('restoring · 1.0 MiB of 124.8 MiB · from cache…');
  });

  it('marks the numeric segments so they can be set in tabular monospace', () => {
    const parts = downloadParts({ ...base, rate: 19_084_083, etaMs: 4_000 });
    expect(parts.every((p) => p.num === true)).toBe(true);
  });
});

describe('loadedSummary', () => {
  it('names cached bytes as cached and rates only the downloaded remainder', () => {
    // a deploy changed the wasm (270 KB) while the 124.8 MiB model stayed cached
    expect(loadedSummary(130_876_112, 310, 130_876_112 - 276_480).replace(/\u00a0/g, ' ')).toBe(
      '124.5 MiB from cache + 0.3 MiB in 0.3 s (0.9 MiB/s)',
    );
  });
  it('distinguishes a cache restore from a cold download', () => {
    expect(loadedSummary(130_876_112, 310, 130_876_112).replace(/\u00a0/g, ' ')).toBe('124.8 MiB from cache in 0.3 s');
    expect(loadedSummary(130_876_112, 6_900, 0).replace(/\u00a0/g, ' ')).toBe('124.8 MiB in 6.9 s (18.1 MiB/s)');
  });

  it('does not divide by zero on an instant load', () => {
    expect(loadedSummary(1_048_576, 0, 0).replace(/\u00a0/g, ' ')).toBe('1.0 MiB in 0.0 s (0.0 MiB/s)');
  });
});

describe('mergeProgress', () => {
  const parts: StatusPart[] = [{ text: 'a' }];
  type Tick = { fraction: number; text?: string; parts?: StatusPart[] };

  it('carries the last text and parts across a fraction-only tick', () => {
    const prev: Tick = { fraction: 0.4, text: 'x', parts };
    // exactly what loadStreaming emits between its 100 ms text refreshes
    expect(mergeProgress(prev, { fraction: 0.5 })).toEqual({ fraction: 0.5, text: 'x', parts });
  });

  it('takes the new text when there is one', () => {
    const prev: Tick = { fraction: 0.4, text: 'x', parts };
    const next: Tick = { fraction: 0.5, text: 'y', parts: [{ text: 'b' }] };
    expect(mergeProgress(prev, next)).toEqual(next);
  });
});
