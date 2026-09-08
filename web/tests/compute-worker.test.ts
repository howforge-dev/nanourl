// Unit test for compute-worker.ts's setupThread: thread_setup's return value
// must be treated as a thrown error, not ignored, since a build that can't
// validate its own stack handoff must fail this worker's handshake loudly
// (see compute-worker.ts for why the wasm side can't just fix the stack
// pointer itself).
// Exercises the pure function directly against a fake `ex`, so it needs no
// real wasm module, Worker global, or self.postMessage — the module's own
// self.onmessage wrapper (real WebAssembly.instantiate + postMessage, plus
// the failHandshake test hook) is covered instead by the browser E2E in
// e2e/threads.smoke.spec.ts, the only place a module worker's ready/error
// message can actually be observed.
import { describe, it, expect } from 'vitest';
import { setupThread } from '../src/lib/codec/compute-worker';

function fakeEx(threadSetup: (stackTop: number, tlsBase: number) => number) {
  return {
    __stack_pointer: { value: 0 },
    thread_setup: threadSetup,
  };
}

describe('setupThread', () => {
  it('writes stackTop into __stack_pointer before calling thread_setup', () => {
    const calls: [number, number][] = [];
    const ex = fakeEx((stackTop, tlsBase) => {
      calls.push([stackTop, tlsBase]);
      return 0;
    });
    setupThread(ex, 4096, 128);
    expect(ex.__stack_pointer.value).toBe(4096);
    expect(calls).toEqual([[4096, 128]]);
  });

  it('throws when the __stack_pointer export is missing', () => {
    const ex = { thread_setup: () => 0 };
    expect(() => setupThread(ex, 4096, 0)).toThrow(/__stack_pointer/);
  });

  it('throws when thread_setup returns non-zero (stack pointer not set into the handed stack)', () => {
    const ex = fakeEx(() => 1);
    expect(() => setupThread(ex, 4096, 0)).toThrow(/rc=1/);
  });

  it('does not throw when thread_setup returns 0', () => {
    const ex = fakeEx(() => 0);
    expect(() => setupThread(ex, 4096, 0)).not.toThrow();
  });
});
