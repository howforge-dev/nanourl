// Recognising a tier-3 (threads) fault in what the wasm sends back.
//
// The contract is `rust/urlcodec/src/threads.rs`'s module header and
// `lib.rs`'s `with_codec` gate. In short: a compute worker that never reports
// `done` within the bounded join is presumed dead, and giving up on it does
// NOT stop it — a merely descheduled worker is still inside `compute(r0, r1)`
// and will finish that block whenever the OS runs it again. Nothing in wasm
// can revoke that write and nothing in JS can wait for it (`terminate()`
// returns immediately and gives no completion signal), so the codec does not
// try to keep working: it POISONS itself.
//
// After that:
//
//   - every entry point returns `POISONED_JSON` verbatim instead of running
//     the model — a static string in the module's data section, so the one
//     message the client must receive intact cannot be sitting in memory a
//     straggler is still writing;
//   - `codec_init` returns 6 for ANY `threads` value, checked first, so the
//     instance cannot even be rebuilt single-threaded over the same memory;
//   - `codec_info` keeps working — it is deliberately outside the gate,
//     because it is what tells the client WHY its call failed.
//
// The client's obligation is therefore not "retry": it is discard the module,
// the workers and the `WebAssembly.Memory` together, and build a new instance
// off the shared-memory path. `client.ts` does exactly that; this module is
// the pure half — what a fault looks like — so it can be tested without a
// wasm instance, a worker or a browser.

/** The `code` field of `POISONED_JSON`. The only error in this ABI that
 *  carries a `code` at all, and the documented machine-readable signal — so
 *  it is matched on, never the prose in `error`. */
export const POISON_CODE = 'instance_poisoned';

/** `threads.rs`'s `JOIN_TIMEOUT`: a participant never reported `done` within
 *  the bound. Currently the only non-zero `threads_error`, but the check
 *  below is "non-zero", not "== 2", because the Rust side documents the field
 *  as a code space and a future fault must not read as healthy here. */
export const JOIN_TIMEOUT = 2;

/** Anything the worker relays back from a codec entry point. */
interface Reply {
  ok?: unknown;
  code?: unknown;
  threads_poisoned?: unknown;
  threads_error?: unknown;
}

const asReply = (r: unknown): Reply => (typeof r === 'object' && r !== null ? (r as Reply) : {});

/**
 * Is this RPC reply the poison answer?
 *
 * Matches the `code` discriminator only. The `error` prose is documentation
 * for a human reading a bug report, and matching on it would break the moment
 * anyone reworded it.
 */
export function isPoisonReply(r: unknown): boolean {
  const reply = asReply(r);
  return reply.ok === false && reply.code === POISON_CODE;
}

/**
 * Does this `codec_info()` describe a faulted instance?
 *
 * `codec_info` answers on a poisoned instance (that is its whole job after a
 * fault), so a load can complete "successfully" against a codec that will
 * refuse the very first encode. Both fields are checked: `threads_poisoned`
 * is the boolean the Rust exposes, `threads_error` the code behind it, and
 * an older build that reports only one of them must still be caught.
 * `threads_degraded` is a legacy alias for `threads_poisoned` and is read too
 * for the same reason.
 */
export function infoThreadFault(info: unknown): boolean {
  const i = asReply(info) as Reply & { threads_degraded?: unknown };
  if (i.threads_poisoned === true || i.threads_degraded === true) return true;
  return typeof i.threads_error === 'number' && i.threads_error !== 0;
}

/** True for either shape — an RPC reply or a `codec_info` result. */
export const isThreadFault = (r: unknown): boolean => isPoisonReply(r) || infoThreadFault(r);

/** Any `{ ok: false, … }` — a poison reply, a codec error, or the sentinel a
 *  terminated worker's pending calls are settled with. */
export const isFailure = (r: unknown): boolean => asReply(r).ok === false;

/** What the client should do with a reply it just received. */
export type FaultAction =
  /** Hand it to the caller unchanged. */
  | 'return'
  /** This call hit the fault: discard the instance, rebuild, replay once. */
  | 'recover'
  /** A SIBLING call hit the fault and the rebuild is already in flight; this
   *  reply is the wreckage of our own teardown, not an answer. Wait for the
   *  replacement and replay on it. */
  | 'replay';

/**
 * The whole fault policy for one reply, as a decision.
 *
 * Pure, so the concurrent case can be exercised without a worker: two calls
 * are in flight, the first comes back poisoned (`recover`), and the second —
 * already posted, never answered, settled `{ok:false,error:'terminated'}` by
 * the teardown the first one triggered — comes back while `recovering` is
 * true (`replay`). Returning that second reply verbatim showed the visitor a
 * bogus "terminated" error beside an otherwise successful recovery
 *
 * A reply that SUCCEEDED during the recovery window is kept, not replayed:
 * the codec's calls are pure, so a replay would be correct but would throw
 * away an answer that already arrived.
 */
export function faultAction(reply: unknown, recovering: boolean): FaultAction {
  if (isPoisonReply(reply)) return 'recover';
  if (recovering && isFailure(reply)) return 'replay';
  return 'return';
}

/** The tier a poison always implicates. Only the shared-memory build has a
 *  join to time out, so a fault means exactly one thing about which tier to
 *  drop. */
export const FAULTED_TIER = 'threads';

/** What the status line says after recovering. Deliberately different from
 *  the load-time degrade wording ("threads tier failed to load"): this tier
 *  loaded fine and ran, and then a worker was lost mid-session. */
export const THREAD_FAULT_NOTE = 'threads tier faulted mid-session; reloaded without it';

/** What a page shows when recovery itself failed and there is no codec left. */
export const THREAD_FAULT_UNRECOVERED = 'the threads kernel faulted and no fallback could be loaded; reload the page';
