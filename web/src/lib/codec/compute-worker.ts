/// <reference lib="webworker" />
// Compute worker: instantiates the same compiled module over the shared
// memory the coordinator created, then hands control to the wasm side
// (`worker_main`) which polls for work and never returns. Only exists in the
// multi-thread build (shared memory import); unreachable on this branch since
// the single-thread wasm exports its own memory and `worker.ts` never spawns
// these.
//
// Posts `{ type: 'ready', id }` right after `thread_setup`. The coordinator
// (worker.ts) waits for this from every spawned compute worker before it
// calls codec_init, so the first job is never handed to a worker whose
// stack/TLS aren't set up yet. This is the last message this worker can ever
// send: `worker_main` below never returns, so nothing posted after it would
// be seen. A failure before that point posts `{ type: 'error', id, error }`
// instead, so a broken compute worker fails the load loudly rather than
// leaving the coordinator waiting on a promise that never resolves.

/** Writes the JS-computed stack top into the module's exported
 * `__stack_pointer` global, then calls `thread_setup`.
 *
 * `thread_setup`'s own `stack_top` parameter is not what moves the stack:
 * this build's `thread_setup` ignores it and runs on whatever
 * `__stack_pointer` already holds, which after a fresh `instantiate()` is
 * this module's default (the main thread's stack), not this worker's own
 * region. So the JS side must set the global itself, before calling
 * `thread_setup` (which needs a valid stack to run its own Rust code at all,
 * including whatever it does internally with `tls_base`). LLVM's own
 * asm!-based attempt to do this write *inside* wasm gets silently undone by
 * its shadow-stack save/restore prologue/epilogue (disassembled at both -O0
 * and -O: always two `global.set`s, the second restoring the old value),
 * which is why this JS-side write cannot be replaced by a wasm-side one.
 *
 * `thread_setup` independently confirms the write took (it returns non-zero
 * unless a local variable's own address falls inside the stack region it was
 * handed), and that return value is treated here as a thrown
 * error: a missing or ignored `__stack_pointer` export must fail this
 * worker's handshake loudly, not let `worker_main` run real jobs on a stack
 * it never got (every compute worker silently sharing the
 * coordinator's stack, corrupting each other's frames in a way that's
 * timing-dependent enough to pass a small fuzz run and still produce wrong
 * codes under load). Exported so `tests/compute-worker.test.ts` can exercise
 * it directly against a fake `ex`, with no real wasm module or Worker
 * global needed. */
export function setupThread(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- hand-rolled C ABI has no generated types
  ex: any,
  stackTop: number,
  tlsBase: number,
): void {
  if (!ex.__stack_pointer) throw new Error('mt build missing __stack_pointer export');
  ex.__stack_pointer.value = stackTop;
  const rc = ex.thread_setup(stackTop, tlsBase);
  if (rc !== 0) throw new Error(`thread_setup rejected the handed stack (rc=${rc}): __stack_pointer was not set into it`);
}

self.onmessage = async (e: MessageEvent) => {
  const { module, memory, id, stackTop, tlsBase, failHandshake } = e.data as {
    module: WebAssembly.Module;
    memory: WebAssembly.Memory;
    id: number;
    stackTop: number;
    tlsBase: number;
    /** Dev/bench-only test hook (see client.ts's
     * `mtFailHandshakeRequested`): when set, this worker sets up its stack
     * correctly and would work fine, but never posts 'ready', simulating a
     * compute worker whose readiness message is lost or that dies right
     * after registering, the scenario worker.ts's bounded 'finish' wait
     * exists to catch. */
    failHandshake?: boolean;
  };
  try {
    const inst = await WebAssembly.instantiate(module, { env: { memory } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- hand-rolled C ABI has no generated types
    const ex: any = inst.exports;
    setupThread(ex, stackTop, tlsBase);
    if (failHandshake) {
      ex.worker_main(id); // never returns; deliberately no 'ready' message first
      return;
    }
    self.postMessage({ type: 'ready', id });
    ex.worker_main(id); // never returns
  } catch (err) {
    self.postMessage({ type: 'error', id, error: err instanceof Error ? err.message : String(err) });
  }
};
