#!/usr/bin/env python3
"""Full-vocab distribution diff: native CLI vs every wasm kernel tier.

The tier gate (fuzz/run_tiers.sh) proves the *coded stream* and two per-step
digests agree.  This is the human-readable version of the same claim: for N
URLs it dumps `codec_dist(url, k, n=0)` (the model's probability for EVERY
one of the 8192 vocabulary entries at step k, through the codec's own
quantized tables) from the native binary and from each wasm build, and prints
the maximum absolute probability difference.

Because both sides run integer kernels over identical weights, the expected
answer is exactly **0.0**, not "small".  Anything else is a divergence, not
float noise.

Not covered: PyTorch.  Comparing the Rust forward pass against the training
checkpoint needs the .pt (only the exported .nurl is on this box) and a GPU
job to be worth running; that comparison is deferred and is a different
question (quantization error), not this one (kernel identity).

  uv run python rust/urlcodec/fuzz/dist_compare.py \
      --model models/target-base/ptq.nurl \
      --tokenizer models/url-bpe-8k-cap24-s0/tokenizer.json
"""
import argparse
import json
import os
import pathlib
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
CRATE = HERE.parent
# rust/, the cargo workspace root: urlcodec and nanourl share one target dir.
WORKSPACE = CRATE.parent


def urls_from_goldens(path, n):
    """N URLs from the tokenizer goldens (one JSON object per line)."""
    out = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            out.append(json.loads(line)["url"])
            if len(out) == n:
                break
    return out


def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        sys.exit(f"FAILED: {' '.join(map(str, cmd))}\n{p.stderr[-4000:]}")
    return [json.loads(l) for l in p.stdout.splitlines() if l.strip()]


def compare(ref, other, name):
    """Max |p_ref - p_other| over every vocabulary entry of every URL."""
    if len(ref) != len(other):
        sys.exit(f"{name}: {len(other)} dumps vs native {len(ref)}")
    worst, worst_where, order_bad = 0.0, None, 0
    for i, (a, b) in enumerate(zip(ref, other)):
        if not (a.get("ok") and b.get("ok")):
            sys.exit(f"{name}: codec_dist failed on URL {i}: {a.get('error')} / {b.get('error')}")
        ta, tb = a["top"], b["top"]
        if len(ta) != len(tb):
            sys.exit(f"{name}: vocab length {len(tb)} vs native {len(ta)} on URL {i}")
        for j, (ea, eb) in enumerate(zip(ta, tb)):
            # `top` is sorted by probability with a STABLE sort, so identical
            # distributions must also agree on the ordering of ties.
            if ea["piece"] != eb["piece"]:
                order_bad += 1
            d = abs(ea["prob"] - eb["prob"])
            if d > worst:
                worst, worst_where = d, (i, j, ea["piece"])
    return worst, worst_where, order_bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="models/target-base/ptq.nurl")
    ap.add_argument("--tokenizer", default="models/url-bpe-8k-cap24-s0/tokenizer.json")
    ap.add_argument("--goldens", default=str(CRATE / "tests/goldens/tok.jsonl"))
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--k", type=int, default=5, help="context length: <eos> + k URL tokens")
    ap.add_argument("--workers", type=int, default=4, help="W for the mt tier (0 skips it)")
    a = ap.parse_args()

    model = str(pathlib.Path(a.model).resolve())
    tok = str(pathlib.Path(a.tokenizer).resolve())
    urls = urls_from_goldens(a.goldens, a.n)
    print(f"{len(urls)} URLs, k={a.k}, full vocab per step")

    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
        f.write("\n".join(urls) + "\n")
        urls_file = f.name
    try:
        fail = compare_all(a, urls_file, model, tok, native_urls=len(urls))
    finally:
        os.unlink(urls_file)
    sys.exit(1 if fail else 0)


def compare_all(a, urls_file, model, tok, native_urls):
    native = run([str(WORKSPACE / "target/release/urlcodec"), "dist",
                  "--model", model, "--tokenizer", tok,
                  "--urls", urls_file, "--n", str(native_urls), "--k", str(a.k)])

    tiers = [("simd", WORKSPACE / "target/urlcodec.wasm", 0),
             ("relaxed", WORKSPACE / "target/urlcodec-relaxed.wasm", 0)]
    if a.workers > 0:
        tiers.append((f"threads:{a.workers}", WORKSPACE / "target/urlcodec-mt.wasm", a.workers))

    fail = False
    for name, wasm, w in tiers:
        if not wasm.exists():
            # Not a pass: the header says which tiers this run covers, and
            # exiting 0 having silently compared fewer is how a missing build
            # turns into "everything agrees".
            print(f"{name:12s} MISSING {wasm} -- build it first")
            fail = True
            continue
        got = run(["node", str(HERE / "dist_dump.js"), str(wasm), model, tok,
                   urls_file, str(native_urls), str(a.k), str(w)])
        worst, where, order_bad = compare(native, got, name)
        status = "OK" if (worst == 0.0 and order_bad == 0) else "DIVERGED"
        extra = "" if where is None else f"  (worst at url {where[0]}, rank {where[1]}, piece {where[2]!r})"
        print(f"{name:12s} max |dprob| = {worst!r}   rank-order mismatches = {order_bad}   {status}{extra}")
        fail = fail or worst != 0.0 or order_bad
    return fail


if __name__ == "__main__":
    main()
