/// <reference lib="webworker" />
// Coordinator worker: owns the wasm instance, the codec's model/tokenizer
// state, and (in the shared-memory build) spawns the compute workers that
// share its memory.
//
// Most messages are RPCs: `{ id, op, ... }` in, `{ id, r }` out, where `r` is
// the parsed JSON result (or a `Fail`); 'setup', 'finish' and the codec
// calls below all follow this. 'chunk' and 'tokenizer' are one-way: the
// coordinator streams model bytes in as they download and never waits for a
// reply, so codec_init can run only once every byte has landed in wasm
// memory. That is what 'finish' is for.
//
// Load handshake, in order:
//   1. main thread -> 'setup' { wasm, modelBytes, threads }: compile +
//      instantiate (creating shared memory and spawning compute workers
//      first, in the mt build, since it owns that memory), then
//      ualloc(modelBytes) up front, because the model region must exist
//      before the first chunk can land in it. Reply: { id, r: { ok: true } } (or a Fail
//      if compile/instantiate throws).
//   2. main thread, only after that reply -> 'chunk' { offset, bytes } per
//      model chunk (any arrival order: offset is absolute, so order doesn't
//      matter) and 'tokenizer' { bytes } once: each writes straight into
//      wasm memory, so no assembled intermediate model buffer ever exists on
//      either side.
//   3. main thread -> 'finish' { id }: waits for every spawned compute
//      worker's 'ready' message (below) if this is the mt build. A compute
//      worker signals ready only after it has instantiated over the shared
//      memory and run `thread_setup`, i.e. once its stack/TLS are valid.
//      CLAMPS W to `threads_ready()` if some never arrive (the contract
//      rust/urlcodec's `codec_init` documents), then calls codec_init over
//      the now-complete model + tokenizer, ufree's both scratch regions, and
//      replies { id, r: Info | Fail }. A chunk/tokenizer write that failed
//      earlier is surfaced here (they have no id of their own to reply to).
//      Without this wait, codec_init could hand the first job to a worker
//      that hasn't set its stack yet.
//
// Compute worker handshake (mt build only): each spawned compute-worker.ts
// posts back `{ type: 'ready', id }` once `thread_setup` returns and the
// worker is about to enter `worker_main` (which never returns, so this is
// the last chance it has to post anything), or `{ type: 'error', id, error }`
// if instantiation/thread_setup throws first. `threadReady` below holds one
// promise per spawned worker, resolved/rejected by that message.
//
// 'setup' also carries `mtFailHandshake` (a dev/bench-only test hook,
// gated in client.ts's `mtFailMode`): when true, the FIRST
// spawned compute worker is told to skip its 'ready' message. Since W is
// clamped to the leading run of workers that handshook (participation is by
// id; see the 'finish' handler), a missing worker 1 leaves nothing usable
// and the tier is abandoned with the rest of the workers already spawned and
// spinning. That is the cleanup path e2e/threads.smoke.spec.ts exercises. A
// missing worker N>1 instead clamps W to N-1 and the tier runs, which is what
// the clamp is for.

import { put, read } from './abi';
import { MAX_WORKERS } from './tier';

const PAGE_BYTES = 65536; // wasm32 linear-memory page size, fixed by the spec
const STACK_PER_THREAD = 1 << 20; // 1 MiB: matches STACK below
const TLS_PER_THREAD = 1 << 16; // 64 KiB: today's __tls_size is 32 bytes; generous headroom for a future TLS section
const TOKENIZER_MARGIN = 2 << 20; // 2 MiB: the BPE vocab file is ~500 KiB (models/url-bpe-8k-cap24-s0/tokenizer.json)
const SCRATCH_MARGIN = 16 << 20; // 16 MiB: encode/decode/dist/trace each ualloc a small buffer and free it same-call, never overlapping the download; not a tight fit
const MAX_PAGES = 16384; // 1 GiB ceiling: comfortably above any model this project has shipped or has planned (current: ~125 MiB); memory.grow covers the gap if a future model needs more than `initial`

/** How many pages to commit up front for the mt build's shared memory: the
 * model weights (the only large, variable-sized piece, known from the
 * manifest before any byte lands) plus a documented margin for the
 * tokenizer, up to MAX_WORKERS compute-worker stacks + TLS blocks, and the
 * coder's own scratch allocations, rounded up to whole pages. Scales with
 * the artifact instead of a flat guess that a smaller model wastes
 * and a larger one could exceed outright; `maximum` (below) still bounds it
 * and growth (`memory.grow`, automatic on `ualloc` overflow) covers any
 * shortfall in this estimate. */
function initialPagesFor(modelBytes: number): number {
  const needed = modelBytes + TOKENIZER_MARGIN + SCRATCH_MARGIN + MAX_WORKERS * (STACK_PER_THREAD + TLS_PER_THREAD);
  return Math.min(Math.ceil(needed / PAGE_BYTES), MAX_PAGES);
}

/**
 * `?mtfail=poison` (a dev/bench-only test hook, gated in client.ts's
 * `mtFailMode`): answer one codec call with the wasm's poison result, byte for
 * byte, instead of dispatching it.
 *
 * The string is `rust/urlcodec/src/lib.rs`'s `POISONED_JSON`. It is repeated
 * here rather than imported because there is nothing to import it from: it
 * lives in the wasm module's data section, and the hook exists to produce it
 * WITHOUT a real fault. What the client keys on is `code`, which
 * `lib/codec/poison.ts` owns and `tests/poison.test.ts` pins against this
 * literal, so a reworded `error` cannot make the two drift in a way that
 * matters.
 *
 * Why a short-circuit and not a real fault: a real poison needs a compute
 * worker descheduled past the bounded join, and nothing reachable from JS can
 * arrange that: a page cannot terminate or stall a worker it did not spawn.
 * The behaviour under test is the client's response to the documented reply.
 */
const POISONED_JSON =
  '{"ok":false,"code":"instance_poisoned",' +
  '"error":"a tier-3 compute worker was lost (codec_info().threads_error = 2). ' +
  'This instance is poisoned and will answer every call with this error: ' +
  'discard it - module, workers and memory - and rebuild at a lower tier."}';

/** Codec calls seen since setup. The load's own self-test is call 1, so the
 *  hook fires on call 2, the page's first real request, which is the
 *  mid-session case the recovery path exists for. */
let codecCalls = 0;
let poisonNextCall = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- hand-rolled C ABI has no generated types
let ex: any = null;
let memory: WebAssembly.Memory;
let threads = 0;
let shared = false;
let modelPtr = 0;
let modelLen = 0;
let tokPtr = 0;
let tokLen = 0;
let fatalError: string | null = null;
// One promise per spawned compute worker (mt build only), resolved when that
// worker posts 'ready' and rejected if it posts 'error' or crashes outright.
// See the handshake note above. Empty in the non-shared build.
let threadReady: Promise<void>[] = [];
// Which of those reported ready, indexed by `id - 1`. The count of LEADING
// trues is what W can be clamped to, because threads.rs picks participants by
// id (`id <= W`): a worker takes part in a job only while its id is within
// the configured W, so a gap (worker 2 dead with 1 and 3 alive) cannot be
// clamped around, only truncated before.
let threadReadyById: boolean[] = [];

self.onmessage = async (e: MessageEvent) => {
  const m = e.data;
  try {
    if (m.op === 'setup') {
      threads = m.threads;
      // Only a shared-memory instance can be poisoned (there is no join to
      // time out otherwise), so the hook is inert on the fallback the
      // recovery loads. That is what stops the E2E from poisoning the
      // replacement too (the query string is still on the URL when it
      // reloads).
      poisonNextCall = m.mtFailPoison === true && threads > 0;
      const module = await WebAssembly.compile(m.wasm);
      const imports = WebAssembly.Module.imports(module);
      shared = imports.some((i) => i.module === 'env' && i.name === 'memory');
      if (shared) {
        const initial = initialPagesFor(m.modelBytes);
        memory = new WebAssembly.Memory({ initial, maximum: MAX_PAGES, shared: true });
        const instance = await WebAssembly.instantiate(module, { env: { memory } });
        ex = instance.exports;
        const tls = ex.__tls_size ? ex.__tls_size.value : 0;
        threadReady = [];
        threadReadyById = new Array<boolean>(threads).fill(false);
        for (let id = 1; id <= threads; id++) {
          const w = new Worker(new URL('./compute-worker.ts', import.meta.url), { type: 'module' });
          const ready = new Promise<void>((resolve, reject) => {
            w.onmessage = (ev: MessageEvent) => {
              if (ev.data?.type === 'ready') {
                threadReadyById[id - 1] = true;
                resolve();
              } else reject(new Error(`compute worker ${id}: ${ev.data?.error ?? 'unexpected message'}`));
            };
            w.onerror = (ev: ErrorEvent) => reject(new Error(`compute worker ${id} crashed: ${ev.message}`));
          });
          threadReady.push(ready);
          // 'finish' (seconds to minutes away, once the whole model has
          // downloaded) is what awaits `threadReady`. Without a handler
          // attached now, a worker that fails fast would reject an unobserved
          // promise and surface first as a console `unhandledrejection`,
          // ahead of and separate from the load's own error reporting.
          ready.catch(() => {});
          // Wasm loads/stores never trap on misalignment, but v128 spills
          // (exactly what this tier exists to accelerate) want a 16-byte
          // aligned frame; ualloc (dlmalloc, 8-byte aligned on wasm32)
          // doesn't guarantee that on its own.
          const stackTop = (ex.ualloc(STACK_PER_THREAD) + STACK_PER_THREAD) & ~15;
          // Dev/bench-only test hook: only the first spawned worker
          // (id === 1) skips its ready message, so the others spin up and
          // register, exercising the "compute workers already spawned and
          // spinning" cleanup path a threads-tier fallback must handle (see
          // client.ts's mtFailHandshakeRequested).
          const failHandshake = m.mtFailHandshake === true && id === 1;
          w.postMessage({ module, memory, id, stackTop, tlsBase: tls ? ex.ualloc(tls) : 0, failHandshake });
        }
      } else {
        const instance = await WebAssembly.instantiate(module, {});
        ex = instance.exports;
        memory = ex.memory as WebAssembly.Memory;
      }
      // Allocated before any chunk exists so the coordinator can start
      // streaming chunks in the moment this reply lands, instead of waiting
      // for the whole model to assemble somewhere first.
      modelLen = m.modelBytes;
      modelPtr = ex.ualloc(modelLen);
      self.postMessage({ id: m.id, r: { ok: true } });
      return;
    }
    if (m.op === 'chunk') {
      new Uint8Array(memory.buffer, modelPtr + m.offset, m.bytes.length).set(m.bytes);
      return;
    }
    if (m.op === 'tokenizer') {
      tokLen = m.bytes.length;
      tokPtr = ex.ualloc(tokLen);
      new Uint8Array(memory.buffer, tokPtr, tokLen).set(m.bytes);
      return;
    }
    if (m.op === 'finish') {
      if (fatalError) throw new Error(fatalError);
      // Establish how many compute workers are ready (stack + TLS valid, and
      // the wasm's own bookkeeping agrees) before codec_init hands out the
      // first job (see the handshake note at the top of this file), and run
      // at that width. Both phases below share one 5s deadline, so
      // the whole ready phase is bounded end to end rather than only its
      // second half. A no-op when threadReady is empty (single-thread build,
      // or threads === 0).
      if (shared && threads > 0) {
        const deadline = performance.now() + 5000;
        const settleIn = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

        // Phase 1: every spawned compute worker's JS-side 'ready' message,
        // bounded by the same deadline as phase 2 so the whole ready phase is
        // bounded end to end rather than only its second half. An unbounded
        // wait in front of a bounded poll would let exactly the stall this
        // exists to catch (a compute worker wedged inside
        // WebAssembly.instantiate, posting neither 'ready' nor 'error') hang
        // forever before ever reaching the bound.
        //
        // allSettled, and expiry is not an error: neither a worker that
        // reported 'error' nor one that never answered is fatal on its own,
        // because the clamp below decides what is usable. Rejections are
        // already handled individually (`ready.catch(() => {})` above), so
        // nothing here is an unobserved rejection.
        await Promise.race([Promise.allSettled(threadReady), settleIn(Math.max(0, deadline - performance.now()))]);

        // Phase 2 (remainder of the same deadline): the wasm's own readiness
        // count (`threads_ready()`, incremented from inside `thread_setup`),
        // which is what codec_init's dispatch relies on rather than
        // anything JS-side. A missing export is a thrown error (never a
        // silent skip): dropping it in a future build must fail the load
        // loudly, not quietly disable this whole check.
        if (!ex.threads_ready) throw new Error('mt build missing threads_ready export');
        while (ex.threads_ready() < threads && performance.now() <= deadline) {
          // eslint-disable-next-line no-await-in-loop -- deliberately serial polling with a real wait between checks
          await new Promise((r) => setTimeout(r, 20));
        }

        // CLAMP, don't throw. Throwing would abandon the entire threads tier
        // when 7 of 8 workers booted, and pay a full ~125 MiB re-download to
        // fall back to relaxed. rust/urlcodec/src/lib.rs's `codec_init`
        // doc is explicit about the contract the loader owes it: "poll
        // `threads_ready()` until it equals W (to a deadline) and clamp W to
        // what actually booted", and it names the ordinary reasons a worker
        // does not arrive: memory pressure killing a `new Worker(...)`, CSP
        // blocking the worker script, a page torn down mid-instantiate.
        // Clamping is what the ABI was designed for; `codec_init` returns 4
        // if W still exceeds the registered workers, so an over-count can
        // never reach a job.
        //
        // Zero is the one case that cannot be clamped into: it means the mt
        // build produced no usable worker at all, so there is nothing for the
        // threads tier to be, and failing here degrades to relaxed/simd
        // exactly like every other threads-tier failure.
        //
        // `threads_ready()` is a count (or, in an older build, the highest id
        // registered); either way W must ALSO stay within the leading run of
        // workers that handshook, because participation is by id.
        // Taking the smaller of the two is correct under both readings.
        const leading = threadReadyById.indexOf(false);
        const usable = Math.min(leading < 0 ? threads : leading, ex.threads_ready());
        if (usable < 1) {
          throw new Error(
            `no usable compute worker within 5s (threads_ready()=${ex.threads_ready()} of ${threads}, ` +
              `first ${threads === 1 ? 'and only ' : ''}worker did not report ready), so the threads tier has nothing to run on`,
          );
        }
        if (usable < threads) {
          // eslint-disable-next-line no-console -- a tier running below its requested width must be visible, not silently slower
          console.warn(`nanourl: ${usable} of ${threads} compute workers usable — running the threads tier at W=${usable}`);
          threads = usable;
        }
      }
      const rc = ex.codec_init(modelPtr, modelLen, tokPtr, tokLen, shared ? threads : 0);
      ex.ufree(modelPtr, modelLen);
      ex.ufree(tokPtr, tokLen);
      if (rc !== 0) throw new Error('codec_init failed: ' + rc);
      self.postMessage({ id: m.id, r: read(memory, ex.codec_info()) });
      return;
    }
    // See POISONED_JSON: hand back the wasm's own answer for one call, without
    // touching the codec, so the client's recovery path can be exercised.
    codecCalls++;
    if (poisonNextCall && codecCalls > 1) {
      poisonNextCall = false;
      self.postMessage({ id: m.id, r: JSON.parse(POISONED_JSON) });
      return;
    }
    let packed: bigint;
    if (m.op === 'sample') {
      // seed/topK/maxTokens are wasm u32 params and temp an f32: plain JS
      // Numbers, not BigInt (only the packed u64 *return* value is a BigInt).
      const [p, l] = put(ex, memory, m.str);
      packed = ex.codec_sample(m.seed >>> 0, m.temp, m.topK, m.maxTokens, p, l);
      ex.ufree(p, l);
    } else {
      const [p, l] = put(ex, memory, m.str);
      packed =
        m.op === 'enc'
          ? ex.codec_encode(p, l, m.alpha)
          : m.op === 'dec'
            ? ex.codec_decode(p, l, m.alpha)
            : m.op === 'dist'
              ? ex.codec_dist(p, l, m.k, m.n)
              : ex.codec_trace(p, l, m.k);
      ex.ufree(p, l);
    }
    self.postMessage({ id: m.id, r: read(memory, packed) });
  } catch (err) {
    // 'chunk'/'tokenizer' have no id (nothing awaits a reply to them), so a
    // failure there is stashed and re-thrown from 'finish' instead of being
    // dropped on the floor.
    fatalError ??= String(err);
    if (m.id !== undefined) self.postMessage({ id: m.id, r: { ok: false, error: String(err) } });
  }
};
