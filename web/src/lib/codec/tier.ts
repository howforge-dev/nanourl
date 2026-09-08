// Runtime feature detection: which wasm variant to load (relaxed-SIMD vs
// portable SIMD/scalar) and how many compute workers to spawn.

// Minimal hand-assembled module that only validates on engines supporting the
// relaxed-SIMD proposal, equivalent to the WAT:
//   (module (func (result v128)
//     v128.const i32x4 0 0 0 0
//     v128.const i32x4 0 0 0 0
//     i16x8.relaxed_dot_i8x16_i7x16_s))
// The relaxed-dot opcode is the two-byte prefixed encoding 0xfd 0x112 (274),
// LEB128-encoded as 0xfd 0x92 0x02 (0x112 = 0b1_0010010 -> low 7 bits 0x12
// with the continuation bit set = 0x92, remaining bits 0x02).
export const RELAXED_PROBE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // \0asm, version 1
  0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b, // type section: (func () -> v128)
  0x03, 0x02, 0x01, 0x00, // function section: fn 0 has type 0
  0x0a, 0x2b, 0x01, 0x29, 0x00, // code section: 1 body, size 41, 0 locals
  0xfd, 0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // v128.const 0
  0xfd, 0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // v128.const 0
  0xfd, 0x92, 0x02, // i16x8.relaxed_dot_i8x16_i7x16_s
  0x0b, // end
]);

export const hasRelaxedSimd = (): boolean => {
  try {
    return WebAssembly.validate(RELAXED_PROBE);
  } catch {
    return false;
  }
};

/**
 * Hard cap on compute workers, everywhere.
 *
 * One thread per core minus the coordinator, but never more than this. Two
 * reasons the cap is low: past a handful of workers the shared block cursor's
 * contention eats the gain, and `navigator.hardwareConcurrency` is not
 * trustworthy — Brave randomises it, and other browsers clamp or round it —
 * so the core count can only ever lower the number, never raise it beyond a
 * value every real device can carry. Every worker also reserves a 1 MiB stack
 * + TLS block inside the shared memory `worker.ts` sizes up front, so the cap
 * bounds that reservation too. `worker.ts` sizes memory from this constant;
 * a cap changed anywhere else would leave that sizing describing the old one.
 * `/bench.html?w=N` bypasses it on purpose, for measurement.
 */
export const MAX_WORKERS = 4;

export const workerCount = (isolated: boolean, cores: number): number =>
  isolated ? Math.max(0, Math.min(cores - 1, MAX_WORKERS)) : 0;

export function detectTier(): { relaxed: boolean; threads: number } {
  const isolated = typeof globalThis.crossOriginIsolated !== 'undefined' && globalThis.crossOriginIsolated === true;
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 1;
  return { relaxed: hasRelaxedSimd(), threads: workerCount(isolated, cores) };
}

/** What a `codec_info().kernel` label actually contains.
 *
 * The three wasm builds nest, and the label alone does not say so: `simd` is
 * simd128, `relaxed` adds the relaxed-SIMD proposal, and the mt build is
 * built with BOTH (`RUSTFLAGS=-C target-feature=+simd128,+relaxed-simd,
 * +atomics,...` in Taskfile.yml's `codec:wasm`) and adds N compute workers on
 * shared memory — so "threads:8" silently implies relaxed SIMD too. Derived
 * from the reported string rather than a hand-typed table so a new tier can
 * never quietly keep describing itself as the old one.
 *
 * `threads:0` is never emitted by `lib::kernel_label()` (zero workers IS the
 * single-threaded tier), but a malformed or zero count is treated as the
 * relaxed build it really is rather than claiming "0 workers".
 */
export interface KernelBuild {
  /** the label as reported, e.g. "threads:8" */
  label: string;
  /** what the build contains, in nesting order */
  features: string[];
  /** compute workers, or null outside the threads tier */
  workers: number | null;
}

const SIMD128 = 'SIMD128';
const RELAXED = 'relaxed SIMD';

export function describeKernel(kernel: string): KernelBuild {
  const threads = /^threads:(\d+)$/.exec(kernel);
  if (threads) {
    const workers = Number(threads[1]);
    if (workers > 0) {
      return {
        label: kernel,
        features: [SIMD128, RELAXED, `${workers} worker${workers === 1 ? '' : 's'} on shared memory`],
        workers,
      };
    }
    return { label: kernel, features: [SIMD128, RELAXED], workers: null };
  }
  if (kernel === 'relaxed') return { label: kernel, features: [SIMD128, RELAXED], workers: null };
  if (kernel === 'simd') return { label: kernel, features: [SIMD128], workers: null };
  if (kernel === 'scalar') return { label: kernel, features: ['no SIMD (scalar fallback)'], workers: null };
  // native x86 labels (vnni/avx2) and anything a future build reports: say the
  // label and claim nothing about what is in it
  return { label: kernel, features: [], workers: null };
}

/** Full nesting, for the build panel: "threads:8 — SIMD128 + relaxed SIMD +
 *  8 workers on shared memory". */
export function kernelSummary(kernel: string): string {
  const b = describeKernel(kernel);
  return b.features.length ? `${b.label} — ${b.features.join(' + ')}` : b.label;
}

/** The same thing for a one-line status: "threads:8 — relaxed SIMD, 8
 *  workers". Drops SIMD128 (implied by every other feature, and by every
 *  build the browser can actually reach) and shortens the worker phrase, so
 *  the ready line stays one line on a phone.
 *
 *  Built from `KernelBuild`'s structured fields, not by string-surgery on the
 *  long phrases `describeKernel` composed: rewording "N workers on shared
 *  memory" must not silently stop this from shortening. */
export function kernelShort(kernel: string): string {
  const b = describeKernel(kernel);
  const rest: string[] = [];
  if (b.features.includes(RELAXED)) rest.push(RELAXED);
  if (b.workers !== null) rest.push(`${b.workers} worker${b.workers === 1 ? '' : 's'}`);
  if (!rest.length && b.features.length && !b.features.includes(SIMD128)) rest.push(...b.features);
  return rest.length ? `${b.label} — ${rest.join(', ')}` : b.label;
}
