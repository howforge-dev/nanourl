import { describe, it, expect } from 'vitest';
import { workerCount, hasRelaxedSimd, RELAXED_PROBE, describeKernel, kernelSummary } from '../src/lib/codec/tier';

describe('tier', () => {
  it('no threads without cross-origin isolation', () => expect(workerCount(false, 8)).toBe(0));
  it('leaves one core for the coordinator, caps at 8', () => {
    expect(workerCount(true, 4)).toBe(3);
    expect(workerCount(true, 32)).toBe(8);
    expect(workerCount(true, 1)).toBe(0);
  });

  it('the relaxed-SIMD probe module validates on this engine', () => {
    // Node 22+ (and this test's node) validates relaxed-SIMD by default.
    expect(WebAssembly.validate(RELAXED_PROBE)).toBe(true);
  });

  it('a copy of the probe with the relaxed-dot opcode corrupted fails validation', () => {
    const bad = RELAXED_PROBE.slice();
    // Locate the 3-byte LEB128 opcode encoding for i16x8.relaxed_dot_i8x16_i7x16_s
    // (0xfd 0x92 0x02) and corrupt its continuation byte so it decodes to an
    // opcode number no engine implements.
    let idx = -1;
    for (let i = 0; i + 2 < bad.length; i++) {
      if (bad[i] === 0xfd && bad[i + 1] === 0x92 && bad[i + 2] === 0x02) {
        idx = i;
        break;
      }
    }
    expect(idx).toBeGreaterThan(-1);
    bad[idx + 1] = 0xff;
    expect(WebAssembly.validate(bad)).toBe(false);
  });

  it('hasRelaxedSimd agrees with a direct WebAssembly.validate call', () => {
    expect(hasRelaxedSimd()).toBe(WebAssembly.validate(RELAXED_PROBE));
  });
});

describe('describeKernel', () => {
  it('spells out what each build actually contains', () => {
    expect(describeKernel('simd').features).toEqual(['SIMD128']);
    expect(describeKernel('relaxed').features).toEqual(['SIMD128', 'relaxed SIMD']);
  });

  it('knows the threads build is also a relaxed build', () => {
    // Taskfile.yml's codec:wasm builds urlcodec-mt.wasm with
    // +simd128,+relaxed-simd,+atomics — "threads:8" alone hides two thirds
    // of that, which is the whole reason this helper exists.
    const b = describeKernel('threads:8');
    expect(b.features).toEqual(['SIMD128', 'relaxed SIMD', '8 workers on shared memory']);
    expect(b.workers).toBe(8);
  });

  it('says "worker", singular, for one', () => {
    expect(describeKernel('threads:1').features.at(-1)).toBe('1 worker on shared memory');
  });

  it('treats threads:0 as the relaxed build it really is, not "0 workers"', () => {
    // lib::kernel_label() never emits this (zero workers IS the single-thread
    // tier), but claiming a worker count of zero would be worse than useless.
    expect(describeKernel('threads:0')).toEqual({ label: 'threads:0', features: ['SIMD128', 'relaxed SIMD'], workers: null });
  });

  it('claims nothing about a label it does not know', () => {
    // native x86 builds report avx2/vnni; a future wasm tier will report
    // something else again. Better to show the bare label than to describe
    // it wrongly.
    expect(describeKernel('avx2')).toEqual({ label: 'avx2', features: [], workers: null });
    expect(kernelSummary('avx2')).toBe('avx2');
  });

  it('names the scalar fallback as having no SIMD at all', () => {
    expect(describeKernel('scalar').features).toEqual(['no SIMD (scalar fallback)']);
  });

  it('renders a one-line summary', () => {
    expect(kernelSummary('threads:8')).toBe('threads:8 — SIMD128 + relaxed SIMD + 8 workers on shared memory');
    expect(kernelSummary('simd')).toBe('simd — SIMD128');
  });
});
