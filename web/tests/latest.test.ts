import { describe, it, expect } from 'vitest';
import { createLatest } from '../src/lib/latest';

describe('createLatest', () => {
  it('keeps the newest claim and supersedes the older ones', () => {
    const latest = createLatest();
    const a = latest.begin();
    expect(a.current).toBe(true);
    const b = latest.begin();
    expect(a.current).toBe(false);
    expect(b.current).toBe(true);
  });

  it('cancel supersedes everything and claims nothing', () => {
    const latest = createLatest();
    const a = latest.begin();
    latest.cancel();
    expect(a.current).toBe(false);
    // ...and the next claim is still valid — cancel is not a latch.
    expect(latest.begin().current).toBe(true);
  });

  it('a claim can be handed to another function and stay valid', () => {
    // The observatory's shape: `run()` claims, then passes the claim to
    // `traceSel()`, which checks it after its own await.
    const latest = createLatest();
    const claim = latest.begin();
    const check = (c: { current: boolean }) => c.current;
    expect(check(claim)).toBe(true);
    latest.begin();
    expect(check(claim)).toBe(false);
  });

  it('works as a loop condition across many iterations', () => {
    // The dream page's shape: sample n URLs, stopping the moment a newer run
    // (or the Stop button) supersedes this one.
    const latest = createLatest();
    const run = latest.begin();
    let done = 0;
    for (let i = 0; i < 5 && run.current; i++) {
      done++;
      if (i === 2) latest.cancel(); // "Stop" pressed mid-batch
    }
    expect(done).toBe(3);
  });

  it('two independent Latests do not interfere', () => {
    const a = createLatest();
    const b = createLatest();
    const ca = a.begin();
    b.begin();
    b.cancel();
    expect(ca.current).toBe(true);
  });
});
