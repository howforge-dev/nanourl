// Rendering + arithmetic for the model-load status line. Pure, so the
// throughput/ETA behaviour is unit-testable (tests/progress.test.ts) instead
// of only observable by staring at a ~125 MiB download.
//
// Sizes and durations come from lib/format.ts, so this line and the learn
// page quote the artifact in the same unit. They did not: this file used the
// 1048576 divisor with an "MB" label while the rest of the site called the
// same figure MiB, so 124.8 appeared twice on one site meaning two things.
import { fmtBytes, fmtRate, fmtSeconds, NBSP } from '../format';
import type { StatusPart } from './types';

export type { StatusPart };

/** ETA is rounded to whole seconds — a moving average is not precise enough
 *  to justify a decimal, and a jittering "~3.7 s left" reads worse than
 *  "~4 s left". */
export function formatEta(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `~${s}${NBSP}s left`;
  const m = Math.floor(s / 60);
  return `~${m}:${String(s - m * 60).padStart(2, '0')} left`;
}

/**
 * Throughput over a trailing time window, and the ETA that follows from it.
 *
 * A whole-download average (bytes ÷ elapsed, which is what the previous line
 * showed) is wrong in the two moments the number matters: it understates the
 * rate for the first second, while connection setup is still in the average,
 * and it keeps quoting a stale rate long after the real one has changed. A
 * trailing window tracks the current rate instead.
 *
 * `rate()` and `eta()` deliberately return null until the window holds at
 * least `minSpanMs` of data: a rate computed from two samples 30 ms apart is
 * noise, and showing an ETA derived from it means showing an ETA that swings
 * by minutes on every tick.
 */
export class RateMeter {
  private readonly samples: { t: number; bytes: number }[] = [];

  constructor(
    private readonly windowMs = 2000,
    private readonly minSpanMs = 1000,
  ) {}

  /** Record cumulative `bytes` transferred as of time `t` (ms, monotonic). */
  push(t: number, bytes: number): void {
    this.samples.push({ t, bytes });
    // keep one sample older than the window so the span covers it fully
    let drop = 0;
    while (drop + 1 < this.samples.length && t - this.samples[drop + 1].t > this.windowMs) drop++;
    this.samples.splice(0, drop);
  }

  /** Bytes per second across the window, or null with too little data. */
  rate(): number | null {
    if (this.samples.length < 2) return null;
    const a = this.samples[0];
    const b = this.samples[this.samples.length - 1];
    const dt = b.t - a.t;
    if (dt < this.minSpanMs) return null;
    const db = b.bytes - a.bytes;
    if (db <= 0) return null;
    return (db / dt) * 1000;
  }

  /** Milliseconds until `remaining` bytes are done, or null when unknown. */
  eta(remaining: number): number | null {
    const r = this.rate();
    if (r === null || r <= 0) return null;
    return (Math.max(0, remaining) / r) * 1000;
  }
}

export interface DownloadState {
  got: number;
  total: number;
  elapsedMs: number;
  /** bytes/sec, or null while the window is still filling */
  rate: number | null;
  /** ms remaining, or null while the window is still filling */
  etaMs: number | null;
  /** every byte so far came out of the Cache API — no network at all */
  fromCache: boolean;
}

/** The loading line: total size, how much has landed, current speed, elapsed,
 *  and (once there is enough data for it to mean anything) the ETA. */
export function downloadParts(s: DownloadState): StatusPart[] {
  if (s.fromCache) {
    // Quote what has actually come back, not the artifact's total. Every byte
    // so far being a cache hit does not mean every byte IS one: the ~1 MB wasm
    // is fetched first, so a bucket holding it but missing a model chunk
    // spends its first ticks in this branch, and quoting `total` there read as
    // "restoring 124.8 MB from cache…" for 1 MB of actual hit.
    return [{ text: 'restoring' }, { text: `${fmtBytes(s.got)} of ${fmtBytes(s.total)}`, num: true }, { text: 'from cache…' }];
  }
  const parts: StatusPart[] = [
    { text: fmtBytes(s.total), num: true },
    { text: `${fmtBytes(s.got)} downloaded`, num: true },
  ];
  if (s.rate !== null) parts.push({ text: fmtRate(s.rate), num: true });
  parts.push({ text: `${fmtSeconds(s.elapsedMs)} elapsed`, num: true });
  if (s.etaMs !== null) parts.push({ text: formatEta(s.etaMs), num: true });
  return parts;
}

/** The one-line summary of how the model actually got here, shown next to
 *  "model ready". Bytes that came out of the Cache API are named as such and
 *  never get a throughput — 125 MiB "at 496 MiB/s" is the disk, not the
 *  network, and says nothing a visitor can act on. A rate is shown only over
 *  the bytes that were actually downloaded (typically a fresh wasm build or
 *  tokenizer after a deploy while the model chunks stayed cached). */
export function loadedSummary(bytes: number, elapsedMs: number, cachedBytes: number): string {
  const downloaded = Math.max(0, bytes - cachedBytes);
  if (downloaded === 0) return `${fmtBytes(bytes)} from cache in ${fmtSeconds(elapsedMs)}`;
  const rate = elapsedMs > 0 ? (downloaded / elapsedMs) * 1000 : 0;
  const net = `${fmtBytes(downloaded)} in ${fmtSeconds(elapsedMs)} (${fmtRate(rate)})`;
  if (cachedBytes === 0) return net;
  return `${fmtBytes(cachedBytes)} from cache + ${net}`;
}

/** Joined form of a part list — what `#status` reads as textContent. */
export const partsText = (parts: StatusPart[]): string => parts.map((p) => p.text).join(' · ');

/**
 * Fold one progress tick into the last one.
 *
 * `loadStreaming` re-renders the status text at most every 100 ms but reports
 * a tick on every chunk read, so most ticks carry a fraction and nothing
 * else. A consumer that renders `p.text ?? 'loading model…'` therefore flashes
 * the placeholder back several times a second. The rule — carry the last text
 * and parts forward across a fraction-only tick — is here, once, rather than
 * copied into each page (where it was fixed four separate times).
 */
export function mergeProgress<P extends { fraction: number; text?: string; parts?: StatusPart[] }>(prev: P, next: P): P {
  return { ...next, text: next.text ?? prev.text, parts: next.parts ?? prev.parts };
}
