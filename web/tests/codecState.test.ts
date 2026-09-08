import { describe, it, expect } from 'vitest';
import { errorTextFor, modelSizeDetail, readyParts, statusPartsFor } from '../src/lib/codec/codecState.svelte';
import { NBSP } from '../src/lib/format';
import { THREAD_FAULT_NOTE, THREAD_FAULT_UNRECOVERED } from '../src/lib/codec/poison';
import type { Codec } from '../src/lib/codec/client';

// `readyParts` composes the "model ready — …" line every page shares. Pure
// (it only reads the codec's own facts), so the three states it distinguishes
// can be checked without loading 125 MiB of model: a clean load, a tier that
// failed to load, and a tier that loaded, ran, and then faulted. The last two
// must not collapse into the same sentence, or a visitor whose kernel faulted
// mid-session would be told it had never loaded.
const codec = (over: Partial<Codec> = {}): Codec =>
  ({
    info: { kernel: 'simd', params: 246_119_680, vocab: 8192 },
    loadStats: { bytes: 130_862_112, elapsedMs: 6_900, fromCache: false, cachedBytes: 0 },
    degradedFrom: null,
    degradedAfterFault: false,
    ...over,
  }) as unknown as Codec;

const text = (c: Codec) =>
  readyParts(c)
    .map((p) => p.text)
    .join(' · ')
    .replace(new RegExp(NBSP, 'g'), ' '); // figures carry a non-breaking space before their unit

describe('readyParts', () => {
  it('names how the model arrived and which kernel is running it', () => {
    expect(text(codec())).toBe('model ready · 124.8 MiB in 6.9 s (18.1 MiB/s) · simd');
  });

  it('says nothing extra about a clean load', () => {
    expect(text(codec())).not.toContain('tier');
  });

  it('reports a tier that failed to load', () => {
    expect(text(codec({ degradedFrom: 'threads' }))).toContain('threads tier failed to load');
  });

  it('reports a mid-session fault differently — that tier DID load', () => {
    const line = text(codec({ degradedFrom: 'threads', degradedAfterFault: true }));
    expect(line).toContain(THREAD_FAULT_NOTE);
    expect(line).not.toContain('failed to load');
  });
});

describe('modelSizeDetail', () => {
  it('rounds the parameter count the one way the site quotes it', () => {
    expect(modelSizeDetail(codec()).map((p) => p.text)).toEqual(['246M params, int4', 'all local']);
  });
});

describe('statusPartsFor', () => {
  const loading = { fraction: 0.5, text: 'loading model…', parts: [{ text: 'loading model…' }] };
  const line = (parts: { text: string }[]) => parts.map((p) => p.text).join(' · ');

  it('shows the load line while there is no codec and no error', () => {
    expect(line(statusPartsFor({ codec: null, error: null, faulted: false, progress: loading }))).toBe('loading model…');
  });

  it('shows the ready line once a codec is there', () => {
    expect(line(statusPartsFor({ codec: codec(), error: null, faulted: false, progress: loading }))).toContain('model ready');
  });

  it('prefixes a load failure', () => {
    const parts = statusPartsFor({ codec: null, error: 'chunk 3: bad digest', faulted: false, progress: loading });
    expect(line(parts)).toBe('failed to load: chunk 3: bad digest');
  });

  // A non-null `codec` is not sufficient for "ready": on a dead codec the
  // forwarder is POISONED (non-null, isDead, every call answering with the
  // poison error), so an `isDead` check must run before treating a non-null
  // codec as ready — otherwise the page would read "model ready — …
  // threads:8" with a full bar while nothing works, and
  // THREAD_FAULT_UNRECOVERED would never reach the screen.
  it('renders an unrecovered thread fault even if a (dead) codec is still held', () => {
    const dead = codec({ info: { kernel: 'threads:8' } as Codec['info'], isDead: true });
    const parts = statusPartsFor({ codec: dead, error: THREAD_FAULT_UNRECOVERED, faulted: true, progress: loading });
    expect(line(parts)).toBe(THREAD_FAULT_UNRECOVERED);
    expect(line(parts)).not.toContain('model ready');
    expect(line(parts)).not.toContain('threads:8');
  });

  it('does not prefix a fault sentence with "failed to load"', () => {
    // "failed to load: the threads kernel faulted…" contradicts itself: that
    // tier loaded fine and then faulted.
    expect(errorTextFor({ error: THREAD_FAULT_UNRECOVERED, faulted: true })).toBe(THREAD_FAULT_UNRECOVERED);
    expect(errorTextFor({ error: 'boom', faulted: false })).toBe('failed to load: boom');
    expect(errorTextFor({ error: null, faulted: false })).toBe('');
  });
});
