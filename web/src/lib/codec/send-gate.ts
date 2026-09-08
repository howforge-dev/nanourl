// A tiny queue/ready state machine used while `client.ts`'s load handshake
// waits on the coordinator worker's 'setup' reply: actions posted before the
// gate opens are queued in arrival order; opening the gate flushes them once,
// in order, and lets any later action through immediately. A gate that never
// opens — 'setup' failed — discards whatever was queued instead of ever
// flushing it, so a broken worker never receives a chunk/tokenizer send.
//
// Deliberately has no Worker/DOM dependency (an "action" is just a closure
// the caller supplies, e.g. `() => worker.postMessage(...)`), so this is the
// one piece of the load handshake that's unit-testable without a real Worker.
export interface SendGate {
  readonly ready: boolean;
  /** True once `discard()` has been called: the gate is permanently closed
   * and every `send` is dropped. */
  readonly discarded: boolean;
  /** Run `action` now if the gate is open, drop it if the gate has been
   * discarded, otherwise queue it. */
  send(action: () => void): void;
  /** Open the gate: flush everything queued so far (in order), then let
   * every later `send` through immediately. Ignored after `discard()`. */
  open(): void;
  /** Permanently close the gate: drop whatever is queued without running it,
   * and drop every later `send` too. */
  discard(): void;
}

export function createSendGate(): SendGate {
  let ready = false;
  let discarded = false;
  let queued: Array<() => void> = [];
  return {
    get ready() {
      return ready;
    },
    get discarded() {
      return discarded;
    },
    send(action) {
      // `discarded` is the latch, and it must exist: without it `discard()` clears
      // the queue once and left `ready === false`, so every chunk that
      // arrived *after* a failed 'setup' was re-queued and never drained —
      // the whole 130,862,112-byte model accumulating as closures for a
      // worker that had already been given up on, on top of the failed
      // tier's shared memory and the loader's own transients

      if (discarded) return;
      if (ready) action();
      else queued.push(action);
    },
    open() {
      if (discarded) return;
      ready = true;
      const flush = queued;
      queued = [];
      for (const action of flush) action();
    },
    discard() {
      discarded = true;
      queued = [];
    },
  };
}
