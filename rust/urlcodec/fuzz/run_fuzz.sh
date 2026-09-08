#!/usr/bin/env bash
# Cross-runtime fuzz gate: N generated URLs through the x86 build and the
# wasm build; every stream, roundtrip, and error string must match. The
# JSON-hash column is compared separately (informational: it would surface
# stats-level wobble such as libm log2 ulp differences without failing the
# stream contract).
#   ./run_fuzz.sh [n=500] [seed=1] [model] [tokenizer]
set -euo pipefail
cd "$(dirname "$0")/.."
N="${1:-500}"; SEED="${2:-1}"
MODEL="${3:-./webassets/model.nurl}"
TOK="${4:-./webassets/tokenizer.json}"
OUT=fuzz/out; mkdir -p "$OUT"

echo "== building native =="
cargo build --release --bin urlcodec 2>&1 | tail -1
echo "== building wasm (simd128) =="
RUSTFLAGS="-C target-feature=+simd128" \
  cargo build --release --target wasm32-unknown-unknown --lib 2>&1 | tail -1

# both sides run simultaneously, each sharded across workers
K="${FUZZ_WORKERS:-}"
if [ -z "$K" ]; then K=$(( $(nproc) / 3 )); K=$(( K < 1 ? 1 : (K > 16 ? 16 : K) )); fi
echo "== fuzz: $N cases, seed $SEED, $K native + $K wasm workers in parallel =="
rm -f "$OUT"/native-*.txt "$OUT"/wasm-*.txt
pids=()
for i in $(seq 0 $((K - 1))); do
  ../target/release/urlcodec fuzz --n "$N" --seed "$SEED" --shard "$i" --shards "$K" \
    --model "$MODEL" --tokenizer "$TOK" > "$OUT/native-$i.txt" &
  pids+=($!)
  node fuzz/driver.js ../target/wasm32-unknown-unknown/release/urlcodec.wasm \
    "$MODEL" "$TOK" "$N" "$SEED" "$i" "$K" > "$OUT/wasm-$i.txt" &
  pids+=($!)
done
for p in "${pids[@]}"; do wait "$p"; done
sort -n -m "$OUT"/native-*.txt -o "$OUT/native.txt" 2>/dev/null || sort -n "$OUT"/native-*.txt > "$OUT/native.txt"
sort -n "$OUT"/wasm-*.txt > "$OUT/wasm.txt"
sort -n -o "$OUT/native.txt" "$OUT/native.txt"

python3 - "$OUT/native.txt" "$OUT/wasm.txt" <<'PYEOF'
import sys
nat = open(sys.argv[1]).read().splitlines()
was = open(sys.argv[2]).read().splitlines()
assert len(nat) == len(was), f"line counts differ: {len(nat)} vs {len(was)}"
stream_bad = stats_bad = rt_bad = 0
for a, b in zip(nat, was):
    fa, fb = a.split("\t"), b.split("\t")
    if fa[:5] != fb[:5]:
        stream_bad += 1
        if stream_bad <= 5:
            print(f"STREAM MISMATCH\n  native: {a}\n  wasm:   {b}")
    elif fa[5] != fb[5]:
        stats_bad += 1
        if stats_bad <= 3:
            print(f"stats-json hash differs (streams identical): case {fa[0]}")
    if "RT_FAIL" in a or "RT_FAIL" in b:
        rt_bad += 1
n = len(nat)
ok = n - stream_bad
errs = sum(1 for l in nat if "\tERR\t" in l)
print(f"{n} cases: {ok} stream-identical, {errs} identical error-path, "
      f"{stats_bad} stats-only hash diffs, {rt_bad} roundtrip failures")
sys.exit(1 if stream_bad or rt_bad else 0)
PYEOF
