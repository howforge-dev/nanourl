// "Only the newest request counts."
//
// Six components hand-rolled the same counter — `const my = ++seq` before an
// `await`, `if (my !== seq) return` after it, and a bare `seq++` to cancel
// without starting anything. Every copy is a place to get the comparison
// backwards or to forget one of the checkpoints, and the failure is silent:
// a stale answer overwrites a fresh one, or a spinner never stops.
//
// The shapes genuinely differ — the compressor checks twice inside one call,
// the observatory hands its claim to a second function, the dream page uses it
// as a *loop* condition across many iterations and cancels from a Stop button
// — so this is a token, not a `run(fn)` wrapper. `begin()` claims the slot;
// the token tells you whether the claim still stands.

export interface Claim {
  /** True until a later `begin()` or a `cancel()` supersedes this claim. */
  readonly current: boolean;
}

export interface Latest {
  /** Claim the newest slot, superseding anything already in flight. */
  begin(): Claim;
  /** Supersede whatever is in flight without claiming the slot — "the user
   *  cleared the input" / "the user pressed Stop". Every outstanding claim
   *  stops being `current`, and nothing takes its place. */
  cancel(): void;
}

export function createLatest(): Latest {
  let seq = 0;
  return {
    begin(): Claim {
      const mine = ++seq;
      return {
        get current() {
          return mine === seq;
        },
      };
    },
    cancel(): void {
      seq++;
    },
  };
}
