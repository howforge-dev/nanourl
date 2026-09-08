// The one place a page's "am I loading / ready / broken" state lives.
//
// index, dream, model and bench would otherwise each carry a copy of this —
// the same `codec`/`progress`/`loadError` fields, the same `statusText`
// derivation, the same `Codec.load(...).then/.catch`. Four copies meant a
// one-line fix to the status line had to be made four times (and was: the
// fraction-only tick rule below), and the copies had already drifted (index
// and dream spelled the ready line one way, model another).
import { paramsM } from '../format';
import { Codec } from './client';
import { loadedSummary, mergeProgress, type StatusPart } from './progress';
import { THREAD_FAULT_NOTE, THREAD_FAULT_UNRECOVERED } from './poison';
import { kernelShort } from './tier';
import type { Progress } from './types';

export interface CodecLoaderOptions {
  /** Force a tier instead of feature-detecting one (the bench page's
   *  `?tier=simd|relaxed|threads&w=N`). */
  tier?: { relaxed: boolean; threads: number };
  /** Words after "model ready — <load summary> · " on this page. The
   *  observatory says something different from the compressor. */
  readyDetail?: (c: Codec) => StatusPart[];
}

export interface CodecLoader {
  readonly codec: Codec | null;
  /** The raw failure message, for a caller's own error panel. */
  readonly error: string | null;
  /** The same failure as a sentence to show a visitor — "failed to load: …"
   *  for a load that never succeeded, and the fault's own wording for a
   *  tier-3 fault that could not be recovered from. Empty when there is no
   *  error, so a caller can render it behind its own `{#if error}`. */
  readonly errorText: string;
  readonly progress: Progress;
  /** Flat text for `#status` — what E2E asserts against. */
  readonly statusText: string;
  /** Same line, segmented, so numeric runs can be set in tabular monospace. */
  readonly statusParts: StatusPart[];
  readonly statusFraction: number;
  /** Start the load. Resolves with the codec, or with null once `error` has
   *  been set — the caller does not need its own catch. Returning it lets a
   *  page that owns the codec's lifetime (the bench page runs it, then
   *  terminates it) chain off the same load the status line is showing. */
  load(): Promise<Codec | null>;
  terminate(): void;
}

/** The compressor and the dream page say the same thing after the shared
 *  ready line; the observatory says something else. One export rather than
 *  two identical closures. */
export const modelSizeDetail = (c: Codec): StatusPart[] => [
  { text: `${paramsM(c.info.params)} params, int4` },
  { text: 'all local' },
];

/** Segments of the ready line every page shares: how the model got here, and
 *  which kernel is running it (spelled out — "threads:8" alone does not say
 *  it is also relaxed SIMD). */
export function readyParts(c: Codec): StatusPart[] {
  const parts: StatusPart[] = [
    { text: 'model ready' },
    // Plain, like the words around it: once the model is ready the load
    // figures are a footnote, not something to draw the eye to.
    { text: loadedSummary(c.loadStats.bytes, c.loadStats.elapsedMs, c.loadStats.cachedBytes) },
    { text: kernelShort(c.info.kernel) },
  ];
  // Codec.load degrades tiers on a load-time failure rather than ever failing
  // the whole app (see client.ts) — say so, rather than let the kernel that
  // was actually achieved imply nothing went wrong. A tier that ran and then
  // faulted is a different sentence: it did load.
  if (c.degradedAfterFault) parts.push({ text: THREAD_FAULT_NOTE });
  else if (c.degradedFrom) parts.push({ text: `${c.degradedFrom} tier failed to load` });
  return parts;
}

/** The state `statusPartsFor` renders. Broken out so the three-way choice can
 *  be unit-tested without a worker, a wasm module or 125 MiB of model — the
 *  unrecovered-fault arm in particular had no reachable test, and was in fact
 *  unreachable in the app. */
export interface StatusState {
  codec: Codec | null;
  error: string | null;
  /** `error` is a tier-3 fault's own sentence, not a failed load. */
  faulted: boolean;
  progress: Progress;
  readyDetail?: (c: Codec) => StatusPart[];
}

/** `error` as a sentence to show a visitor. `error` itself stays raw, since
 *  callers put it in their own panels. */
export function errorTextFor(s: Pick<StatusState, 'error' | 'faulted'>): string {
  if (s.error === null) return '';
  return s.faulted ? s.error : `failed to load: ${s.error}`;
}

/**
 * The status line, as segments.
 *
 * `error` is tested BEFORE `codec`. A codec that is present is normally the
 * whole story, but not on the unrecovered-fault path: there the codec is the
 * poisoned forwarder — non-null, `isDead`, every call answering with the
 * poison error — and testing it first left the page reading
 * "model ready — … threads:8" with a full progress bar while nothing worked.
 * `onThreadFault` also drops the codec, so the two halves agree rather than
 * one masking the other.
 */
export function statusPartsFor(s: StatusState): StatusPart[] {
  if (s.error) return [{ text: errorTextFor(s) }];
  if (s.codec) return [...readyParts(s.codec), ...(s.readyDetail?.(s.codec) ?? [])];
  return s.progress.parts ?? [{ text: s.progress.text ?? 'loading model…' }];
}

export function createCodecLoader(opts: CodecLoaderOptions = {}): CodecLoader {
  let codec: Codec | null = $state(null);
  let error: string | null = $state(null);
  /** True when `error` describes a tier-3 fault that could not be recovered
   *  from, rather than a load that never succeeded. Only the second reads as
   *  "failed to load: …"; the first already is a whole sentence. */
  let faulted = $state(false);

  const state = (): StatusState => ({ codec, error, faulted, progress, readyDetail: opts.readyDetail });
  let progress: Progress = $state({ fraction: 0, text: 'loading model…', parts: [{ text: 'loading model…' }] });

  // See mergeProgress: a fraction-only tick must not blank the line.
  function onProgress(p: Progress): void {
    progress = mergeProgress(progress, p);
  }

  // `error` is tested BEFORE `codec`. A codec that is present is normally the
  // whole story, but not on the unrecovered-fault path: there the codec is the
  // poisoned forwarder — non-null, `isDead`, every call answering with the
  // poison error — and testing it first left the page reading
  // "model ready — … threads:8" with a full progress bar while nothing worked,
  // so THREAD_FAULT_UNRECOVERED could never reach the screen
  // `onThreadFault` also drops the codec, so the two
  // halves agree rather than one masking the other.
  const statusParts = $derived.by(() => statusPartsFor(state()));

  /** A mid-session tier-3 fault: `client.ts` has already terminated the
   *  poisoned instance, loaded a replacement without threads and replayed the
   *  failed call on it. All that is left here is to point at the replacement
   *  so the ready line re-derives — it now names the fallback kernel and says
   *  the threads tier faulted.
   *
   *  `next === null` means even the fallback failed: drop the codec as well as
   *  setting the error, because the one that is left cannot answer anything. */
  function onThreadFault(next: Codec | null): void {
    if (next) {
      codec = next;
      return;
    }
    codec = null;
    faulted = true;
    error = THREAD_FAULT_UNRECOVERED;
  }

  return {
    get codec() {
      return codec;
    },
    get error() {
      return error;
    },
    get errorText() {
      return errorTextFor({ error, faulted });
    },
    get progress() {
      return progress;
    },
    get statusParts() {
      return statusParts;
    },
    get statusText() {
      return statusParts.map((p) => p.text).join(' · ');
    },
    get statusFraction() {
      return codec ? 1 : progress.fraction;
    },
    load() {
      return Codec.load(onProgress, { tier: opts.tier, onThreadFault }).then(
        (c) => {
          codec = c;
          return c;
        },
        (e: unknown) => {
          error = e instanceof Error ? e.message : String(e);
          return null;
        },
      );
    },
    terminate() {
      codec?.terminate();
      codec = null;
    },
  };
}
