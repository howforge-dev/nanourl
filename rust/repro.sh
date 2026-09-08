#!/usr/bin/env bash
# Prove the shipped artifacts are reproducible: same commit, same pinned
# toolchain, two source trees at DIFFERENT paths, identical bytes.
#
#   repro.sh          both
#   repro.sh wasm     the three .wasm tiers only
#   repro.sh cli      the nanourl binary only (needs the model artifact)
#
# Two directories whose names differ in length, because that is the failure
# this catches: rustc records the path of every file it compiles in panic
# locations, so an un-remapped prefix makes the same source produce different
# bytes on every machine.
#
# What it does NOT vary is $CARGO_HOME or the rustup directory. Those are
# remapped by rustflags.sh, which every build here goes through, so the check
# below is the direct one: the artifacts must contain no absolute path from
# this machine at all.
set -euo pipefail
cd "$(dirname "$0")/.."
repo="$PWD"
what="${1:-all}"
case "$what" in wasm | cli | all) ;; *) echo "repro: wasm | cli | all" >&2; exit 2 ;; esac

nurl="${NANOURL_MODEL_FILE:-$repo/models/target-base/ptq.nurl}"
if [ "$what" != wasm ] && [ ! -f "$nurl" ]; then
  echo "repro: no model artifact at $nurl; the CLI embeds it." >&2
  echo "Set NANOURL_MODEL_FILE, or run 'repro.sh wasm'." >&2
  exit 1
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/nanourl-repro.XXXXXX")"
trap 'rm -rf "$work"' EXIT
# Deliberately different lengths.
A="$work/a"
B="$work/bbbbbbbbbbbbbbbb"

# The workspace and nothing else: rust/target is hundreds of megabytes and
# rust/fuzzpair and rust/urltok are separate crates this does not build.
copy() {
  local d="$1"
  mkdir -p "$d/rust" "$d/models"
  cp -a "$repo"/rust/Cargo.toml "$repo"/rust/Cargo.lock \
        "$repo"/rust/rust-toolchain.toml "$repo"/rust/rustflags.sh \
        "$repo"/rust/NIGHTLY "$d/rust/"
  cp -a "$repo/rust/urlcodec" "$repo/rust/nanourl" "$d/rust/"
  rm -rf "$d/rust/urlcodec/target" "$d/rust/nanourl/target"
  # include_str! of the tokenizer reaches out of the crate, so the copy needs it.
  cp -a "$repo/models/url-bpe-8k-cap24-s0" "$d/models/"
}

build() {
  local d="$1"
  copy "$d"
  if [ "$what" != cli ]; then
    ( cd "$d/rust/urlcodec" && ./build-wasm.sh --no-verify >/dev/null 2>&1 )
  fi
  if [ "$what" != wasm ]; then
    ( cd "$d/rust/nanourl" \
        && RUSTFLAGS="$(../rustflags.sh)" NANOURL_MODEL_FILE="$nurl" \
           cargo build --release -q )
  fi
}

echo "building in $A"; build "$A"
echo "building in $B"; build "$B"

files=()
[ "$what" = cli ] || files+=(target/urlcodec.wasm target/urlcodec-relaxed.wasm target/urlcodec-mt.wasm)
[ "$what" = wasm ] || files+=(target/release/nanourl)

fail=0
printf '\n%-34s %-64s %s\n' ARTIFACT SHA256 MATCH
for f in "${files[@]}"; do
  a=$(sha256sum "$A/rust/$f" | cut -d' ' -f1)
  b=$(sha256sum "$B/rust/$f" | cut -d' ' -f1)
  if [ "$a" = "$b" ]; then
    printf '%-34s %-64s ok\n' "${f##*/}" "$a"
  else
    fail=1
    printf '%-34s %-64s DIFFERS\n' "${f##*/}" "$a"
    printf '%-34s %-64s\n' '' "$b"
    # Say WHERE, rather than leaving "not reproducible" as the whole finding.
    case "$f" in
      *.wasm)
        if command -v wasm-objdump >/dev/null 2>&1; then
          diff <(wasm-objdump -h "$A/rust/$f") <(wasm-objdump -h "$B/rust/$f") || true
        else
          echo "  (install wabt for a section-level diff: wasm-objdump -h)" >&2
        fi ;;
    esac
  fi
done

# Identical from two paths is necessary, not sufficient: both builds ran under
# the same $CARGO_HOME, so a missing remap would agree with itself. The direct
# check is that no absolute path from this machine survives into the artifact.
for f in "${files[@]}"; do
  leaked=$(grep -a -c -e "$HOME" -e "${CARGO_HOME:-$HOME/.cargo}" "$A/rust/$f" || true)
  if [ "$leaked" != 0 ]; then
    fail=1
    echo "${f##*/}: $leaked build-machine path(s) baked in -- rustflags.sh's" >&2
    echo "  --remap-path-prefix did not reach this build:" >&2
    grep -a -o -m 3 -e "${HOME}[^\"]*" "$A/rust/$f" | sort -u | head -3 >&2
  fi
done

# Reproducibility is settled above. The pin is a SECOND question -- are these
# the bytes a parity gate proved? -- and it is only answerable on the
# architecture the pin describes, so on any other host it is reported and not
# counted against the run. build-wasm.sh exits 3 to say exactly that.
if [ "$what" != cli ]; then
  echo
  ( cd "$A/rust/urlcodec" && ./build-wasm.sh --verify ) && rc=0 || rc=$?
  case "$rc" in
    0) ;;
    3) echo "(the pin describes another architecture; reproducibility above stands)" ;;
    *) fail=1 ;;
  esac
fi

[ "$fail" = 0 ] || { echo; echo "NOT REPRODUCIBLE" >&2; exit 1; }
echo; echo "reproducible: every artifact is byte-identical from two paths"
