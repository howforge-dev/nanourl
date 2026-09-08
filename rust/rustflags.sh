#!/usr/bin/env bash
# The complete RUSTFLAGS for a build of this workspace. One place, because
# cargo gives you exactly one: RUSTFLAGS, `target.<triple>.rustflags` and
# `build.rustflags` are MUTUALLY EXCLUSIVE -- the first that applies wins
# outright and the others are ignored. A workflow that set RUSTFLAGS for the
# path remapping while `.cargo/config.toml` held `+crt-static` would silently
# ship a dynamically linked binary. So both live here and nothing relies on
# config rustflags.
#
#   rustflags.sh                      host build
#   rustflags.sh <triple>             cross build, with that target's link flags
#   rustflags.sh --toolchain N ...    take the sysroot from toolchain N
#
# WHAT THE REMAPS ARE FOR. rustc records the absolute path of every source file
# it compiles in panic locations, and those strings survive `strip`. Without
# remapping, the same commit gives different bytes under a different
# $CARGO_HOME or rustup directory -- 2 such paths in urlcodec.wasm, 19 in the
# threads tier, 25 in the nanourl binary. `task codec:repro`, `task cli:repro`
# and every release leg's double build are what check that this works.
#
# The release legs assert `+crt-static` on the artifact rather than trusting
# the flag, so a caller that forgets this script fails loudly rather than
# shipping a binary that needs a libc.
set -euo pipefail

toolchain=
if [ "${1:-}" = --toolchain ]; then toolchain="$2"; shift 2; fi
target="${1:-}"

flags=()

# Registry sources: $CARGO_HOME differs between a laptop, a build box and a CI
# runner, and every dependency's panic locations name it.
cargo_home="${CARGO_HOME:-$HOME/.cargo}"
flags+=("--remap-path-prefix=$cargo_home/registry/src=/cargo")

# Standard-library sources, for -Zbuild-std: the sysroot path carries the HOST
# triple, so it differs between an x86-64 builder and an arm64 one. A
# precompiled std is already remapped to /rustc/<hash> by the compiler itself.
sysroot="$(rustc ${toolchain:+"+$toolchain"} --print sysroot)"
flags+=("--remap-path-prefix=$sysroot=/rust")

# Link options for the platforms the CLI is released for. A released binary
# must run on a machine with nothing installed: no libc of a particular
# vintage, no Visual C++ redistributable, no TLS library. `+crt-static` is
# already the default for *-linux-musl and is spelled out anyway, because a
# default is not a guarantee. macOS has no static libSystem -- Apple ships none
# and linking it is unsupported -- so those two are dynamic against the system
# library and nothing else. `strip=symbols` on all six: what ships is the same
# shape everywhere, and a rebuild has no symbol table to differ in.
case "$target" in
  *-linux-musl)
    flags+=(-C target-feature=+crt-static -C strip=symbols) ;;
  *-pc-windows-msvc)
    # /Brepro replaces the PE timestamps with content hashes; /PDBALTPATH keeps
    # the build directory out of the debug directory entry. Without both, two
    # builds of one commit differ.
    flags+=(-C target-feature=+crt-static -C strip=symbols
            -C link-arg=/Brepro '-C' 'link-arg=/PDBALTPATH:%_PDB%') ;;
  *-apple-darwin)
    # ld derives LC_UUID from its inputs, which include the build directory,
    # so two builds of one commit differ in the UUID and in the ad-hoc
    # signature that covers it. No dSYM ships, so the UUID serves nothing.
    flags+=(-C strip=symbols -C link-arg=-Wl,-no_uuid) ;;
esac

# RUSTFLAGS is split on whitespace, so a path containing any would be read as
# two flags. Failing here beats a build that quietly drops the remap.
out="${flags[*]}"
case "$out" in
  *"$(printf '\t')"* | *"
"*) echo "rustflags: a path contains whitespace: $out" >&2; exit 1 ;;
esac
case "$cargo_home$sysroot" in
  *" "*) echo "rustflags: a path contains a space: $cargo_home $sysroot" >&2; exit 1 ;;
esac
printf '%s\n' "$out"
