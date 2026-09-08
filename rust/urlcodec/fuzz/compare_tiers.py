#!/usr/bin/env python3
"""Compare merged tier TSVs. First path is the reference (native, by
run_tiers.sh's TIERS order); every other must match it on:

  columns 1-5  idx, alphabet, status, coded-or-error, roundtrip flag
  column 7     dist_hash: fnv64 over the quantized cumulative table
                          cum[0..=vocab] (u64 LE) of EVERY step
  column 8     logit_hash: fnv64 over the raw f32 logits of EVERY step,
                           by bit pattern (f32::to_bits, u32 LE)

Column 6 (fnv64 of the whole encode+decode JSON) is INFORMATIONAL and not
compared: it also hashes `bits` fields computed through `f64::log2()`, which
differs in the last ulp between native's libm and wasm's libm even when every
stream byte is identical.

With --expect N it also refuses to pass a run that did not compare N cases,
or that contains no successfully coded case, or whose digest columns are not
hashes (the digests are a runtime toggle; two tiers both reporting "off"
agree on nothing).

Split out of run_tiers.sh so the same comparison can be run over a set of
already-merged tiers without rebuilding or refuzzing.

  fuzz/compare_tiers.py [--expect N] DIR/native.tsv DIR/simd.tsv ...
"""
import re
import sys

COLS = [0, 1, 2, 3, 4, 6, 7]
HASH_COLS = [6, 7]          # dist_hash, logit_hash
HEX16 = re.compile(r"^[0-9a-f]{16}$")


def name(p):
    return p.rsplit("/", 1)[-1][:-4]


def key(line):
    f = line.split("\t")
    return [f[c] if c < len(f) else "<missing>" for c in COLS]


def sanity(path, lines, expect):
    """Refuse a run that passed having compared nothing.

    Three ways a comparator says OK with no evidence: empty files (0 cases,
    0 mismatches, rc 0), an all-ERR run, and, with the digests a runtime
    toggle, a run where every digest column is the literal "off", which
    compares equal on both sides while proving nothing.
    """
    errs = []
    if expect is not None and len(lines) != expect:
        errs.append(f"{name(path)}: {len(lines)} cases, expected {expect}")
    ok = [l for l in lines if l.split("\t")[2:3] == ["OK"]]
    if not ok:
        errs.append(f"{name(path)}: no OK cases ({len(lines)} lines) -- nothing was actually coded")
    for line in ok:
        f = line.split("\t")
        for c in HASH_COLS:
            v = f[c] if c < len(f) else "<missing>"
            if not HEX16.match(v):
                errs.append(
                    f"{name(path)}: column {c + 1} is {v!r}, not a digest -- "
                    f"run the harness with DIGEST_BIT set")
                break
        else:
            continue
        break
    return errs


def main(paths, expect):
    ref_path, ref = paths[0], open(paths[0]).read().splitlines()
    fail = []
    fail += sanity(ref_path, ref, expect)
    for path in paths[1:]:
        lines = open(path).read().splitlines()
        fail += sanity(path, lines, expect)
        if len(lines) != len(ref):
            fail.append(f"{name(path)}: line counts differ: {name(ref_path)} {len(ref)} vs {len(lines)}")
            continue
        bad = 0
        for a, b in zip(ref, lines):
            if key(a) != key(b):
                bad += 1
                if bad <= 5:
                    print(f"{name(path)} MISMATCH\n  {name(ref_path)}: {a}\n  {name(path)}: {b}")
        print(f"{name(path)}: {len(lines)} cases, {bad} mismatches over "
              f"stream + dist_hash + logit_hash (column 6 -- fnv of stats JSON -- is informational)")
        if bad:
            fail.append(f"{name(path)}: {bad} mismatches")
    for e in fail:
        print(f"GATE FAILURE: {e}")
    return 1 if fail else 0


if __name__ == "__main__":
    args = sys.argv[1:]
    expect = None
    if len(args) >= 2 and args[0] == "--expect":
        expect, args = int(args[1]), args[2:]
    if len(args) < 2:
        sys.exit("usage: compare_tiers.py [--expect N] REFERENCE.tsv OTHER.tsv [OTHER.tsv ...]")
    sys.exit(main(args, expect))
