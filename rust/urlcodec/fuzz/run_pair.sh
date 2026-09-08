#!/usr/bin/env bash
# THE cross-runtime fuzz gate: rust-only, single-process per shard —
# fuzzpair embeds the wasm build via wasmtime next to the native
# x86 codec and asserts per-case equality, fail-fast. No node involved.
# (fuzz/run_fuzz.sh remains for occasional V8/browser-engine validation.)
#
#   ./run_pair.sh [seconds=600] [seed=1] [model] [tokenizer]
#   FUZZ_WORKERS=50 ./run_pair.sh 600 ...     # 10-minute gate
set -euo pipefail
cd "$(dirname "$0")/.."
SECS="${1:-600}"; SEED="${2:-1}"
MODEL="${3:-./webassets/model.nurl}"
TOK="${4:-./webassets/tokenizer.json}"
K="${FUZZ_WORKERS:-}"
if [ -z "$K" ]; then K=$(( $(nproc) / 3 )); K=$(( K < 1 ? 1 : (K > 16 ? 16 : K) )); fi

echo "== building wasm (simd128) =="
RUSTFLAGS="-C target-feature=+simd128" \
  cargo build --release --target wasm32-unknown-unknown --lib 2>&1 | tail -1
echo "== building fuzzpair =="
( cd ../fuzzpair && cargo build --release 2>&1 | tail -1 )

WASM=../target/wasm32-unknown-unknown/release/urlcodec.wasm
BIN=../fuzzpair/target/release/fuzzpair
echo "== paired fuzz: ${SECS}s budget, seed $SEED, $K shards =="
pids=()
for i in $(seq 0 $((K - 1))); do
  "$BIN" "$WASM" "$MODEL" "$TOK" "$SECS" "$SEED" "$i" "$K" 2>&1 &
  pids+=($!)
done
fail=0
for p in "${pids[@]}"; do
  wait "$p" || fail=1
done
if [ "$fail" -ne 0 ]; then
  echo "FUZZ GATE FAILED — divergence above"
  exit 1
fi
echo "FUZZ GATE PASSED: native x86 == wasm on every case (${SECS}s budget; per-shard counts above)"
