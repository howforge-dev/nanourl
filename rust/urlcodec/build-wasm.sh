#!/usr/bin/env bash
# Build the three shipped wasm tiers into rust/target/, reproducibly, and check
# them against rust/urlcodec/wasm.sha256.
#
#   build-wasm.sh            build all three, then verify against the pin
#   build-wasm.sh --no-mt    the two single-thread tiers only (still verified)
#   build-wasm.sh --verify   verify the files already in rust/target/, no build
#   build-wasm.sh --no-verify build only, skip the pin check (repro.sh, kernel work)
#   build-wasm.sh --pin      build all three and REWRITE the pin
#
# Exit 1 is a mismatch. Exit 3 is "this host is not the architecture the
# pin describes", which is a different statement and callers distinguish it.
#
# ONE PLACE. `task codec:wasm`, `task codec:pin`, `fuzz/run_tiers.sh` and both
# CI workflows all come through here, so the bytes the parity gate proves, the
# bytes the site packs and the bytes the pin names are one set of bytes. A
# second build recipe anywhere makes them three.
#
# REPRODUCIBILITY, and its exact limit. ../rustflags.sh carries the path
# remapping and says why; with rust-toolchain.toml pinning the compiler the
# result is byte-identical from any directory on a given machine, which
# `task codec:repro` checks.
#
# It is NOT identical across host ARCHITECTURES. Cargo's -C metadata
# disambiguator is derived from rustc's verbose version, which names the host
# triple, so an arm64 builder and an x86-64 builder mangle the same symbols to
# different hashes and the linker then orders functions differently: measured,
# the function, elem and code sections all differ while producers and
# target_features are identical. The pin below is therefore an
# x86_64-unknown-linux-gnu fact, the architecture of both the parity-gate box
# and the CI runners that build what the site serves, which is the whole
# shipping path. On any other host, build for development and pass UNPINNED=1
# to `task web:assets`.
set -euo pipefail
cd "$(dirname "$0")"

TGT=../target
PIN=wasm.sha256
# rust/NIGHTLY is the one place the date lives: this script, run_tiers.sh,
# the Taskfile and both CI workflows all read it.
NIGHTLY="${NIGHTLY:-$(cat ../NIGHTLY)}"
mode=build
want_mt=1
check=1
while [ $# -gt 0 ]; do
  case "$1" in
    --no-mt) want_mt=0; shift ;;
    --no-verify) check=0; shift ;;
    --verify) mode=verify; shift ;;
    --pin) mode=pin; shift ;;
    -h | --help) sed -n '2,8p' "$0" >&2; exit 0 ;;
    *) echo "build-wasm: unknown argument $1" >&2; exit 2 ;;
  esac
done

# ../rustflags.sh is the one place that knows what a reproducible build of this
# workspace needs; the wasm feature flags below are all this script adds. The
# mt set is computed where it is used, because it asks the NIGHTLY toolchain
# for its sysroot and `--verify` must work on a machine that has no nightly.
remap() { ../rustflags.sh; }
remap_mt() { ../rustflags.sh --toolchain "$NIGHTLY"; }

PIN_ARCH=x86_64-unknown-linux-gnu
# A pattern `grep -v` drops from the pin. With every tier built it matches
# nothing, so all three lines are checked.
SKIP_MT='$^'
[ "$want_mt" = 1 ] || SKIP_MT=urlcodec-mt.wasm

host_matches_pin() {
  [ "$(rustc -vV | sed -n 's/^host: //p')" = "$PIN_ARCH" ]
}

# The pin lists all three tiers; `--no-mt` checks the two it built. The host
# check applies to files this host built: files fetched from the gate box are
# the pinned bytes wherever they are checked, so `--verify` skips it.
verify() {
  local want="$PWD/$PIN"
  [ "${1:-built}" = fetched ] || host_matches_pin || {
    echo "$PIN is an $PIN_ARCH fact, and this host is" >&2
    echo "  $(rustc -vV | sed -n 's/^host: //p')." >&2
    echo "Cargo's -C metadata disambiguator names the host triple, so the" >&2
    echo "same source links to a different function order here. Build for" >&2
    echo "development with 'task web:assets UNPINNED=1'; the gate box and CI" >&2
    echo "are both $PIN_ARCH and are what the pin describes." >&2
    exit 3
  }
  # cd into the artifact directory: the pin names bare files, so it reads the
  # same whatever path the target directory has.
  ( cd "$TGT" && grep -v "$SKIP_MT" "$want" | sha256sum -c - ) || {
    echo "" >&2
    echo "FAIL: the wasm tiers do not match $PWD/$PIN." >&2
    echo "A kernel change moves these bytes, and the pin is only updated by" >&2
    echo "'task codec:pin' AFTER fuzz/run_tiers.sh has gated the new files." >&2
    echo "A change with no kernel edit means the toolchain drifted: check" >&2
    echo "rust-toolchain.toml is being honoured (rustc --version)." >&2
    exit 1
  }
}

if [ "$mode" = verify ]; then
  verify fetched
  exit 0
fi

echo "== wasm: simd128 + relaxed-simd =="
RUSTFLAGS="-C target-feature=+simd128,+relaxed-simd $(remap)" \
  cargo build --release -q --target wasm32-unknown-unknown --lib
cp "$TGT/wasm32-unknown-unknown/release/urlcodec.wasm" "$TGT/urlcodec-relaxed.wasm"

echo "== wasm: simd128 only =="
RUSTFLAGS="-C target-feature=+simd128 $(remap)" \
  cargo build --release -q --target wasm32-unknown-unknown --lib
cp "$TGT/wasm32-unknown-unknown/release/urlcodec.wasm" "$TGT/urlcodec.wasm"

if [ "$want_mt" = 1 ]; then
  # Its own --target-dir: -Zbuild-std rebuilds std with +atomics, and sharing a
  # target dir with the stable builds would thrash both caches on every run.
  echo "== wasm: +atomics, shared memory ($NIGHTLY) =="
  RUSTFLAGS="-C target-feature=+simd128,+relaxed-simd,+atomics,+bulk-memory,+mutable-globals \
-C panic=abort \
-C link-arg=--shared-memory -C link-arg=--import-memory -C link-arg=--max-memory=1073741824 \
-C link-arg=--export=__wasm_init_tls -C link-arg=--export=__tls_size -C link-arg=--export=__stack_pointer \
$(remap_mt)" \
    cargo "+$NIGHTLY" build --release -q --target wasm32-unknown-unknown --lib \
      -Zbuild-std=std,panic_abort --target-dir "$TGT/mt"
  cp "$TGT/mt/wasm32-unknown-unknown/release/urlcodec.wasm" "$TGT/urlcodec-mt.wasm"
fi

if [ "$mode" = pin ]; then
  [ "$want_mt" = 1 ] || { echo "build-wasm: --pin needs all three tiers" >&2; exit 2; }
  host_matches_pin || {
    echo "build-wasm: --pin must run on $PIN_ARCH (see the header); this is" >&2
    echo "  $(rustc -vV | sed -n 's/^host: //p')" >&2
    exit 2
  }
  ( cd "$TGT" && sha256sum urlcodec.wasm urlcodec-relaxed.wasm urlcodec-mt.wasm ) >"$PIN"
  echo "wrote $PWD/$PIN:"
  cat "$PIN"
  exit 0
fi

[ "$check" = 1 ] || exit 0
verify
