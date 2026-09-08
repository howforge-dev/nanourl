// Low-level C-ABI helpers shared by worker.ts (the real coordinator, running
// in a Worker) and tests/worker-smoke.test.ts (which instantiates the wasm
// directly, with no Worker, to smoke-check the codec end to end). Keeping
// exactly one copy means the test exercises the same byte-marshalling code
// the browser path uses.
//
// Callers pass their wasm exports object (typed `any` there, since the
// hand-rolled C ABI in rust/urlcodec has no generated type information — that
// stays internal to the codec worker/test and never reaches the public Codec
// API in client.ts); only the one export this module actually calls is typed
// here, so `any` isn't needed in this file's own signature.
export interface Ualloc {
  ualloc(n: number): number;
}

/** Copy a JS string into wasm memory (UTF-8, ualloc'd) and return [ptr, len]. */
export function put(ex: Ualloc, memory: WebAssembly.Memory, str: string): readonly [number, number] {
  const bytes = new TextEncoder().encode(str);
  const p = ex.ualloc(bytes.length);
  new Uint8Array(memory.buffer, p, bytes.length).set(bytes);
  return [p, bytes.length] as const;
}

/** Decode a packed (ptr<<32|len) UTF-8 JSON result out of wasm memory. */
export function read(memory: WebAssembly.Memory, packed: bigint): unknown {
  const p = Number(packed >> 32n);
  const l = Number(packed & 0xffffffffn);
  // The mt build's memory is a SharedArrayBuffer, and TextDecoder.decode()
  // throws ("The provided ArrayBufferView value must not be shared") on a
  // view backed by one — found by hand running the threads tier in a real
  // browser (single-thread build's plain-ArrayBuffer memory never hit this).
  // `.slice()` always constructs its result via the plain `Uint8Array`
  // intrinsic (TypedArray species), so it copies into a fresh non-shared
  // ArrayBuffer regardless of the source's buffer kind — cheap (these are
  // small JSON replies, not model-sized) and correct for both builds.
  const bytes = new Uint8Array(memory.buffer, p, l).slice();
  return JSON.parse(new TextDecoder().decode(bytes));
}
