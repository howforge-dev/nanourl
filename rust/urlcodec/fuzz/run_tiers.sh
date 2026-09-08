#!/usr/bin/env bash
# Kernel tier parity gate. Every kernel tier must produce the same STREAM and
# the same PER-STEP MODEL STATE on every fuzz case. Tiers:
#
#   native   the CLI, best ISA the host has (scalar / avx2 / vnni) -- reference
#   simd     urlcodec.wasm          (simd128)
#   relaxed  urlcodec-relaxed.wasm  (simd128 + relaxed-simd)
#   mt1/mt4  urlcodec-mt.wasm       (simd128 + relaxed-simd + atomics, shared
#            memory) with W = 1 and W = 4 compute workers
#
# TWO worker counts, not three. Rows are owned whole by one participant, so
# each W is simply a different partition of the same arithmetic; two
# different partitions already demonstrate that the partition does not enter
# it, and a third costs ~40 minutes on a shared 8-core box for no new
# information. `mt7` is still a recognised tier for a box with cores to
# spare: TIERS="native simd relaxed mt1 mt4 mt7".
#
# A module containing relaxed-simd opcodes fails validation on an engine
# without the feature even if never executed, so the tiers are separate files
# rather than one runtime-toggled module -- the web loader picks the file;
# here we just point plain `node` at each.
#
# COMPARED COLUMNS: 1-5 (idx, alphabet, status, coded-or-error, roundtrip
# flag), 7 (dist_hash) and 8 (logit_hash).
#
#   dist_hash   fnv64 over the quantized cumulative table cum[0..=vocab] (u64
#               LE) of EVERY step of the URL. This is the exact table the
#               arithmetic coder charges against, so it asserts the whole
#               distribution at every step, not just the symbol that got
#               coded.
#   logit_hash  fnv64 over the raw f32 logits of EVERY step, by bit pattern
#               (f32::to_bits, u32 LE). One layer earlier than dist_hash: it
#               fails on a single-ulp kernel difference that softmax + 24-bit
#               quantization would have rounded away. This is the column that
#               actually proves the int4 gemv is bit-identical -- fixed-order
#               f32 accumulation, no FMA contraction anywhere in the kernel.
#
# Column 6 (fnv64 of the raw encode+decode JSON) is INFORMATIONAL only, same
# as fuzz/run_fuzz.sh: it also hashes the "bits"/"bits_cost" fields, which go
# through f64::log2(), and that differs in the last ulp between native's libm
# and wasm's libm even when every stream byte is identical. A blind `cmp` of
# whole files fails on that column alone with zero real divergence, so this
# script parses out the compared columns instead.
#
# SCHEDULING. The three single-thread tiers run CONCURRENTLY, each itself
# sharded (native's --shard/--shards and the node drivers' matching args
# partition cases identically: idx == shard (mod shards)). The mt tiers run
# one tier at a time AFTER them, because each mt process already occupies
# W+1 cores; their shard counts are chosen so W+1 times shards stays around
# the core count. Shard counts are coprime with 8 where it matters:
# fuzzgen::gen_url cycles 8 modes on idx % 8, and mode 7 is the deliberately
# oversize (context-chaining) case, so any even shard count aliases and dumps
# every expensive case on one shard.
#
# RESUMABLE. Shard TSVs live in $TIERS_DIR (default /tmp; point it somewhere
# durable -- outside any tree a mirroring sync deletes -- to survive a
# killed/timed-out run). A shard already at its expected line
# count is skipped rather than rerun. That reuse is gated on a freshness key
# that covers, EXACTLY AND ONLY, these things -- if any of them moved, all old
# output is DISCARDED rather than resumed into:
#
#   N, SEED, TIERS and the per-tier shard/worker spec
#   sha256 of $MODEL and $TOK
#   sha256 of fuzz/*.js  (driver_common.js decides the case loop, the alphabet
#                         mapping and which JSON field becomes which column)
#   sha256 of fuzz/*.py  (compare_tiers.py decides what counts as passing)
#   sha256 of THIS SCRIPT (it owns the tier -> .wasm mapping and each driver's
#                         positional argv order -- swap which file the
#                         `relaxed` tier loads and the rows change with no
#                         other file touched)
#   the bytes of every freshly built binary it is about to run
#
# It does NOT cover the toolchain, the OS or node's version. A stale shard
# from a since-fixed bug, a different seed, or a reordered column silently
# "passing" would be exactly the kind of wrong-but-plausible result this gate
# exists to catch.
#
# PREFLIGHT. When the tier list includes an mt tier, the tier-3 glue is
# clippy'd on the pinned nightly BEFORE the four builds -- it is the only code
# path no other check compiles, and finding it broken after three builds is
# ~20 wasted minutes. A missing toolchain is a hard failure there, not a skip:
# an mt tier was asked for.
#
#   fuzz/run_tiers.sh [n=100] [seed=1] [model] [tokenizer]
# env: TIERS_DIR, FUZZ_SHARDS (single-thread tiers), TIERS (tier list),
#      NIGHTLY (toolchain for the mt build), ALLOW_SKIP (see below)
#
# ACROSS MACHINES. The mt tiers own W+1 cores each and run one at a time, so a
# whole-gate run is mostly serial; splitting it by TIER over several machines
# turns it into the length of its slowest leg. Same n, seed and model
# everywhere -- the case list is a function of (n, seed), and the comparison is
# against `native`, which is why every leg includes it:
#
#   TIERS="native simd relaxed" fuzz/run_tiers.sh 100 1 "$MODEL"
#   TIERS="native mt1"          fuzz/run_tiers.sh 100 1 "$MODEL"
#   TIERS="native mt4"          fuzz/run_tiers.sh 100 1 "$MODEL"
#
# Each leg prints TIER PARITY OK for the tiers it ran; all of them must. The
# `native` rows are recomputed per machine rather than shared, which is the
# point: independent CPUs agreeing on the reference is a stronger statement
# than one. A leg with no mt tier needs no nightly (see the preflight below).
set -euo pipefail
cd "$(dirname "$0")/.."
N="${1:-100}"; SEED="${2:-1}"
MODEL="${3:-../../models/target-base/ptq.nurl}"; TOK="${4:-../../models/url-bpe-8k-cap24-s0/tokenizer.json}"
# The workspace target directory. `rust/` holds two crates (urlcodec and
# nanourl) and cargo puts every artifact under rust/target, one level above the
# crate this script cd's into.
TGT=../target
SHARDS="${FUZZ_SHARDS:-3}" # per single-thread tier; 3*SHARDS run concurrently
TIERS="${TIERS:-native simd relaxed mt1 mt4}"
NIGHTLY="${NIGHTLY:-$(cat ../NIGHTLY)}"
DIR="${TIERS_DIR:-/tmp}"

# A gate that reports success for its own absence is worse than no gate. The
# model is a 125 MiB artifact outside git (models/target-base is a symlink),
# so a fresh clone, CI, or a machine the artifacts have not been fetched onto
# has neither it nor -- if the tokenizer is absent too -- anything to compare.
# This fails
# loudly rather than skipping silently; ALLOW_SKIP=1 is the deliberate
# opt-out for a caller that knows it has no artifacts.
missing=""
[ -f "$MODEL" ] || missing="$missing\n  model:     $MODEL"
[ -f "$TOK" ]   || missing="$missing\n  tokenizer: $TOK"
if [ -n "$missing" ]; then
  if [ "${ALLOW_SKIP:-0}" = 1 ]; then
    printf 'SKIPPED (ALLOW_SKIP=1): tier parity compared NOTHING; missing:%b\n' "$missing" >&2
    exit 0
  fi
  printf 'FAIL: cannot run the tier parity gate, missing:%b\n' "$missing" >&2
  printf 'Fetch them into models/, pass explicit paths as the 3rd and 4th\n' >&2
  printf 'arguments, or set ALLOW_SKIP=1 to accept comparing nothing.\n' >&2
  exit 1
fi
mkdir -p "$DIR"
# Anything cargo-driven from this gate must treat a missing artifact as a
# failure, not as the loud skip a developer's bare `cargo test` gets.
export URLCODEC_REQUIRE_ARTIFACTS=1

# Workers per mt tier, and how many such processes to run at once. mt1 gets 3
# shards (3 x 2 = 6 threads); mt4 and mt7 run a single process (5 and 8
# threads) because a second would oversubscribe an 8-core box.
tier_workers() { case "$1" in mt1) echo 1;; mt4) echo 4;; mt7) echo 7;; *) echo 0;; esac; }
tier_shards()  { case "$1" in mt1) echo 3;; mt4|mt7) echo 1;; *) echo "$SHARDS";; esac; }
is_mt()        { case "$1" in mt*) return 0;; *) return 1;; esac; }

want_mt=0
for t in $TIERS; do is_mt "$t" && want_mt=1; done

# TIER-3 GLUE FIRST, before any of the four builds below.
#
# Everything behind cfg(target_feature = "atomics") -- threads.rs's wasm glue,
# gemv_wasm's parallel branch, thread_setup/worker_main/threads_ready -- is
# compiled by NOTHING else: not cargo fmt, not clippy --all-targets, not cargo
# test, not either single-thread wasm clippy run. A symbol dropped from that
# region can pass all five and only be caught 18 s into a gate run, AFTER a
# native build and two wasm builds have already been paid for. Checking
# it first turns that into seconds. The toolchain is required here, not
# optional: an mt tier was asked for, so there is nothing to skip to.
if [ "$want_mt" = 1 ]; then
  if ! rustup toolchain list | grep -q "^$NIGHTLY"; then
    echo "FAIL: the mt tiers need $NIGHTLY, which is not installed." >&2
    echo "  rustup toolchain install $NIGHTLY --component rust-src --profile minimal" >&2
    echo "  rustup target add wasm32-unknown-unknown --toolchain $NIGHTLY" >&2
    echo "Or drop the mt tiers: TIERS='native simd relaxed'" >&2
    exit 1
  fi
  echo "== checking the tier-3 glue ($NIGHTLY) before anything is built =="
  RUSTFLAGS="-C target-feature=+simd128,+relaxed-simd,+atomics,+bulk-memory,+mutable-globals \
-C panic=abort" \
    cargo "+$NIGHTLY" clippy --release -q --target wasm32-unknown-unknown --lib \
      -Zbuild-std=std,panic_abort --target-dir "$TGT/mtcheck" -- -D warnings
fi

# The urlcodec package only: `nanourl` lives in its own crate, embeds a 124.8
# MiB model this gate never runs, and its build script would demand that file.
echo "== building native =="
cargo build --release -q

# The wasm tiers come from build-wasm.sh, the same script `task codec:wasm`
# and both CI workflows run: the bytes this gate proves have to be the bytes
# the site packs, and two build recipes for one artifact is how they stopped
# being the same.
#
# --no-verify: this gate is what MAKES bytes pinnable, so it cannot require
# them to be pinned already. It prints their digests at the end instead; `task
# codec:pin` writes them once this run has passed.
BW=(./build-wasm.sh --no-verify)
[ "$want_mt" = 1 ] || BW+=(--no-mt)
NIGHTLY="$NIGHTLY" "${BW[@]}"

WASM=$TGT/urlcodec.wasm
WASM_RELAXED=$TGT/urlcodec-relaxed.wasm
WASM_MT=$TGT/urlcodec-mt.wasm
ARTIFACTS=("$TGT/release/urlcodec" "$WASM" "$WASM_RELAXED")
[ "$want_mt" = 0 ] || ARTIFACTS+=("$WASM_MT")

# Freshness gate. Exactly the list in the RESUMABLE section of the header:
# change the seed, the model, the tokenizer, the case count, the tier list, a
# shard count, a harness source, THIS SCRIPT, or a built binary, and the old
# output is discarded rather than resumed into.
SHARD_SPEC=""
for t in $TIERS; do SHARD_SPEC="$SHARD_SPEC $t:$(tier_shards "$t"):$(tier_workers "$t")"; done
BUILD_HASH=$( { printf 'n=%s seed=%s tiers=%s shards=%s\n' "$N" "$SEED" "$TIERS" "$SHARD_SPEC"
                sha256sum "$MODEL" "$TOK"
                # the harness itself: it decides what a row contains.
                # run_tiers.sh is IN here -- it owns the tier -> .wasm mapping
                # and each driver's argv order, so leaving it out let a
                # remapped tier resume shards produced by the old mapping and
                # report TIER PARITY OK. `cd` above guarantees this path.
                sha256sum fuzz/*.js fuzz/*.py fuzz/run_tiers.sh
                cat "${ARTIFACTS[@]}"; } | sha256sum | cut -d' ' -f1)
HASH_FILE="$DIR/BUILD_HASH"
if [ -f "$HASH_FILE" ] && [ "$(cat "$HASH_FILE")" = "$BUILD_HASH" ]; then
  echo "== inputs+build unchanged since last run in $DIR -- resuming any complete shards =="
else
  echo "== inputs or build changed (or first run) -- clearing $DIR/*.tsv =="
  rm -f "$DIR"/*.tsv
  echo "$BUILD_HASH" > "$HASH_FILE"
fi

# Launch one wave of shards for one tier; caller waits.
pids=(); labels=()
launch_tier() {
  local tier="$1" shards workers f expect i
  shards=$(tier_shards "$tier"); workers=$(tier_workers "$tier")
  for ((i = 0; i < shards; i++)); do
    expect=$(( (N - i + shards - 1) / shards )) # cases with idx % shards == i
    f="$DIR/$tier.$i.tsv"
    if [ -f "$f" ] && [ "$(wc -l < "$f")" -eq "$expect" ]; then
      echo "  $tier shard $i already complete ($expect lines), skipping"
      continue
    fi
    case "$tier" in
      native)
        nice -n 10 "$TGT/release/urlcodec" fuzz --n "$N" --seed "$SEED" --shard "$i" --shards "$shards" \
          --model "$MODEL" --tokenizer "$TOK" > "$f" &
        ;;
      simd)
        nice -n 10 node fuzz/driver.js "$WASM" "$MODEL" "$TOK" "$N" "$SEED" "$i" "$shards" > "$f" &
        ;;
      relaxed)
        nice -n 10 node fuzz/driver.js "$WASM_RELAXED" "$MODEL" "$TOK" "$N" "$SEED" "$i" "$shards" > "$f" &
        ;;
      mt*)
        nice -n 10 node fuzz/threads_driver.js "$WASM_MT" "$MODEL" "$TOK" "$N" "$SEED" \
          "$workers" "$i" "$shards" > "$f" &
        ;;
      *) echo "unknown tier: $tier" >&2; exit 2;;
    esac
    pids+=($!); labels+=("$tier shard $i")
  done
}

# Wait on each pid individually so a failure names its shard instead of
# collapsing into one anonymous non-zero exit.
wait_wave() {
  local rc=0 k
  for k in "${!pids[@]}"; do
    if ! wait "${pids[$k]}"; then
      echo "FAILED: ${labels[$k]} (see $DIR)" >&2
      rc=1
    fi
  done
  pids=(); labels=()
  return $rc
}

echo "== fuzzing $N cases: $TIERS =="
for t in $TIERS; do is_mt "$t" || launch_tier "$t"; done
wait_wave
for t in $TIERS; do
  if is_mt "$t"; then
    echo "-- $t ($(tier_workers "$t") workers, $(tier_shards "$t") shards) --"
    launch_tier "$t"
    wait_wave
  fi
done

# Merge only the shard files this run's shard counts call for, and delete any
# left over from a previous run with a larger count -- an orphan
# native.4.tsv merged into a 3-shard run would duplicate cases and compare
# against nothing.
for t in $TIERS; do
  shards=$(tier_shards "$t")
  for f in "$DIR/$t".*.tsv; do
    [ -e "$f" ] || continue
    idx="${f##*/"$t".}"; idx="${idx%.tsv}"
    case "$idx" in
      ''|*[!0-9]*) continue;;                      # $t.tsv itself, not a shard
      *) [ "$idx" -ge "$shards" ] && rm -f "$f";;
    esac
  done
  expected=(); for ((i = 0; i < shards; i++)); do expected+=("$DIR/$t.$i.tsv"); done
  sort -n -m "${expected[@]}" -o "$DIR/$t.tsv"
done

merged=(); for t in $TIERS; do merged+=("$DIR/$t.tsv"); done
python3 fuzz/compare_tiers.py --expect "$N" "${merged[@]}"
echo "TIER PARITY OK ($N cases; tiers: $TIERS)"

# The digests of exactly what was gated. `task codec:pin` writes these into
# rust/urlcodec/wasm.sha256, and CI then refuses to pack anything else -- so
# the bytes the browser runs are the bytes this run proved, rather than
# whatever a CI runner's toolchain happened to produce.
echo
echo "gated wasm ($(rustc -vV | sed -n 's/^host: //p'), $(rustc --version)):"
gated=(urlcodec.wasm urlcodec-relaxed.wasm)
[ "$want_mt" = 0 ] || gated+=(urlcodec-mt.wasm)
( cd "$TGT" && sha256sum "${gated[@]}" )
echo "Pin them with: task codec:pin"
