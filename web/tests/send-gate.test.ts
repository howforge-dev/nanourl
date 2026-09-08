import { describe, expect, it } from 'vitest';
import { createSendGate } from '../src/lib/codec/send-gate';

// Pure part of client.ts's load handshake (no Worker/DOM involved): actions
// queue until the gate opens, then flush in order; a gate that never opens
// (the 'setup' RPC came back ok:false) discards the queue instead — `ready`
// must track the setup reply's `ok`, not flip true regardless of it, or
// queued chunk/tokenizer sends would flush at a worker that already failed
// to compile/instantiate.
describe('createSendGate', () => {
  it('starts closed and not ready', () => {
    const gate = createSendGate();
    expect(gate.ready).toBe(false);
  });

  it('queues actions until opened, then flushes them once, in order', () => {
    const gate = createSendGate();
    const calls: number[] = [];
    gate.send(() => calls.push(1));
    gate.send(() => calls.push(2));
    expect(calls).toEqual([]);

    gate.open();
    expect(gate.ready).toBe(true);
    expect(calls).toEqual([1, 2]);
  });

  it('runs actions immediately once open', () => {
    const gate = createSendGate();
    gate.open();
    const calls: number[] = [];
    gate.send(() => calls.push(1));
    expect(calls).toEqual([1]);
  });

  it('discard drops queued actions without running them and without opening', () => {
    const gate = createSendGate();
    const calls: number[] = [];
    gate.send(() => calls.push(1));
    gate.discard();
    expect(gate.ready).toBe(false);
    expect(calls).toEqual([]);
  });

  it('discard LATCHES: every later send is dropped, not re-queued', () => {
    const gate = createSendGate();
    const calls: number[] = [];
    gate.send(() => calls.push(1));
    gate.discard();
    expect(gate.discarded).toBe(true);

    // discard() must latch, not just clear the queue once — otherwise every
    // chunk arriving after a failed 'setup' would be re-queued and never
    // drained, accumulating the whole ~125 MiB model as closures for a
    // worker that has already given up.
    for (let i = 2; i <= 9; i++) gate.send(() => calls.push(i));
    expect(calls).toEqual([]);
    expect(gate.ready).toBe(false);

    // and a late open() can never resurrect them
    gate.open();
    gate.send(() => calls.push(10));
    expect(calls).toEqual([]);
    expect(gate.ready).toBe(false);
  });

  it('discarded is false until discard() is called', () => {
    const gate = createSendGate();
    expect(gate.discarded).toBe(false);
    gate.open();
    expect(gate.discarded).toBe(false);
  });
});
