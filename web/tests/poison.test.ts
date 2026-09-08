import { describe, it, expect } from 'vitest';
import {
  faultAction,
  FAULTED_TIER,
  infoThreadFault,
  isFailure,
  isPoisonReply,
  isThreadFault,
  JOIN_TIMEOUT,
  POISON_CODE,
  THREAD_FAULT_NOTE,
  THREAD_FAULT_UNRECOVERED,
} from '../src/lib/codec/poison';

// `rust/urlcodec/src/lib.rs`'s POISONED_JSON, byte for byte. Copied rather
// than imported because it lives in the wasm module's data section and there
// is nothing on this side to import it from, so this literal is the pin: if
// the Rust constant is reworded, the classifier must still key on `code` and
// this test says which field that is.
const POISONED_JSON =
  '{"ok":false,"code":"instance_poisoned",' +
  '"error":"a tier-3 compute worker was lost (codec_info().threads_error = 2). ' +
  'This instance is poisoned and will answer every call with this error: ' +
  'discard it - module, workers and memory - and rebuild at a lower tier."}';

describe('isPoisonReply', () => {
  it('recognises the wasm poison result verbatim', () => {
    expect(isPoisonReply(JSON.parse(POISONED_JSON))).toBe(true);
  });

  it('keys on `code`, not on the error prose', () => {
    // `code` is the documented machine-readable signal and the only error in
    // this ABI that carries one. A reworded `error` must not stop this
    // working, and a matching prose without the code must not start it.
    expect(isPoisonReply({ ok: false, code: POISON_CODE, error: 'anything at all' })).toBe(true);
    expect(isPoisonReply({ ok: false, error: 'This instance is poisoned and will answer every call' })).toBe(false);
  });

  it('is not fooled by an ordinary failure or by a success', () => {
    expect(isPoisonReply({ ok: false, error: 'codec_init failed: 4' })).toBe(false);
    expect(isPoisonReply({ ok: true, coded: 'abc' })).toBe(false);
    // A *successful* reply that happens to carry the string is still fine:
    // only `ok: false` plus the code is a fault.
    expect(isPoisonReply({ ok: true, code: POISON_CODE })).toBe(false);
  });

  it('survives anything that is not an object', () => {
    for (const v of [null, undefined, 'instance_poisoned', 42, []]) {
      expect(isPoisonReply(v)).toBe(false);
    }
  });
});

describe('infoThreadFault', () => {
  // codec_info is deliberately outside `with_codec`'s gate, so it answers on a
  // poisoned instance, which means a load can complete "successfully" against
  // a codec that will refuse the very first encode. This is the check that
  // stops that shipping as a working load.
  const healthy = {
    ok: true,
    kernel: 'threads:8',
    vocab: 8192,
    threads_poisoned: false,
    threads_degraded: false,
    threads_error: 0,
  };

  it('passes a healthy threads-tier instance', () => {
    expect(infoThreadFault(healthy)).toBe(false);
  });

  it('catches the boolean', () => {
    expect(infoThreadFault({ ...healthy, threads_poisoned: true })).toBe(true);
  });

  it('catches the legacy alias a build might still be reporting', () => {
    expect(infoThreadFault({ ...healthy, threads_degraded: true })).toBe(true);
  });

  it('catches a non-zero threads_error, not only the known code', () => {
    expect(infoThreadFault({ ...healthy, threads_error: JOIN_TIMEOUT })).toBe(true);
    // JOIN_TIMEOUT is the only non-zero code today, but the Rust documents
    // the field as a code space: a future fault must not read as healthy.
    expect(infoThreadFault({ ...healthy, threads_error: 7 })).toBe(true);
  });

  it('tolerates a build that reports neither field', () => {
    expect(infoThreadFault({ ok: true, kernel: 'simd' })).toBe(false);
    expect(infoThreadFault(null)).toBe(false);
  });
});

describe('isThreadFault', () => {
  it('accepts either shape — an RPC reply or a codec_info result', () => {
    expect(isThreadFault(JSON.parse(POISONED_JSON))).toBe(true);
    expect(isThreadFault({ ok: true, threads_error: JOIN_TIMEOUT })).toBe(true);
    expect(isThreadFault({ ok: true, kernel: 'simd', threads_error: 0 })).toBe(false);
  });
});

describe('the wording the status line uses', () => {
  it('says the tier faulted, not that it failed to load', () => {
    // The two are different things to tell a visitor: this tier loaded fine
    // and ran, and then a compute worker was lost.
    expect(THREAD_FAULT_NOTE).toContain('faulted');
    expect(THREAD_FAULT_NOTE).not.toContain('failed to load');
    expect(THREAD_FAULT_UNRECOVERED).toContain('reload');
    expect(FAULTED_TIER).toBe('threads');
  });
});

describe('faultAction — two concurrent RPCs across one fault', () => {
  // The scenario the observatory and the compressor both reach: two codec
  // calls are in flight at once (the observatory's `run` and `traceSel`; the
  // compressor's encode and `Dist`'s distribution fetch). One of them hits the
  // tier-3 fault. `client.ts` tears the instance down to recover, which
  // settles the OTHER call's pending promise with the terminate sentinel, an
  // answer it never got. Returning that verbatim would show the visitor a
  // bogus "terminated" error beside an otherwise successful recovery.
  const TERMINATED = { ok: false, error: 'terminated' };
  const POISON = JSON.parse(POISONED_JSON) as unknown;
  const ENCODED = { ok: true, coded: 'g44sQkgwH9ruzM5' };

  it('call A receives the poison and drives the recovery', () => {
    // No recovery in flight yet: A is the one that discovers the fault.
    expect(faultAction(POISON, false)).toBe('recover');
  });

  it('call B, torn down by A recovery, is replayed rather than returned', () => {
    expect(faultAction(TERMINATED, true)).toBe('replay');
  });

  it('call B is returned unchanged when no recovery is in flight', () => {
    // Same reply, no fault: a caller did call terminate(), and
    // "terminated" is the honest answer.
    expect(faultAction(TERMINATED, false)).toBe('return');
  });

  it('a reply that SUCCEEDED during the recovery window is kept, not replayed', () => {
    // The codec's calls are pure, so replaying would be correct, but it would
    // discard an answer that already arrived and pay for it twice.
    expect(faultAction(ENCODED, true)).toBe('return');
    expect(faultAction(ENCODED, false)).toBe('return');
  });

  it('a poison reply recovers even while a recovery is already in flight', () => {
    // `recoverFromThreadFault` is memoized, so this joins the existing rebuild
    // rather than starting a second one.
    expect(faultAction(POISON, true)).toBe('recover');
  });

  it('isFailure covers every ok:false shape the worker can send', () => {
    expect(isFailure(TERMINATED)).toBe(true);
    expect(isFailure(POISON)).toBe(true);
    expect(isFailure({ ok: false, error: 'codec_init failed: 4' })).toBe(true);
    expect(isFailure(ENCODED)).toBe(false);
    expect(isFailure(null)).toBe(false);
  });
});

// The `code` string has to match across two languages that never compile
// together. Rust asserts it (lib.rs's `a_poisoned_instance_refuses_every_call`)
// and so does this file, but neither reads the other, so read the Rust here.
describe('cross-language pin', () => {
  it('POISON_CODE is the code the wasm actually emits', async () => {
    const { readFileSync } = await import('node:fs');
    const { WEB_ROOT } = await import('../scripts/paths');
    const { resolve } = await import('node:path');
    const lib = readFileSync(resolve(WEB_ROOT, '../rust/urlcodec/src/lib.rs'), 'utf8');
    expect(lib, 'rust/urlcodec/src/lib.rs no longer emits this code').toContain(`"code":"${POISON_CODE}"`);
  });
});
