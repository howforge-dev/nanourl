# nanourl

Lossless URL compression with a neural language model, in your browser. A
246M-parameter transformer trained on web URLs predicts the next token; an
arithmetic coder turns those predictions into bits, so an unsurprising URL
costs very few of them. The shipped model scores **1.26 bits/char** on 100,000
held-out URLs and is quantised to 4 bits per weight, a 124.8 MiB download.

The code after the `#` in a link is the whole message: the URL is compressed
into it, not stored under it. There is no server side and no database, so
nothing can expire.

## The site

Every page is static. On first visit the browser downloads the weights, the
tokenizer and one of three WebAssembly kernel builds, verifies each chunk
against its content hash and keeps them in the Cache API; a service worker
precaches the page shell. After that the whole app works offline. Compression
and decompression run the same wasm model in a worker on your machine. The
fastest, multi-threaded kernel needs cross-origin isolation, which is why the
site sets `COOP` and `COEP` headers.

## The `nanourl` command line

```bash
nanourl encode https://example.com/some/long/url --link
nanourl decode https://qv.lc/#CODE
nanourl model info      # which weights this binary carries
```

`decode` takes a full link, a link without its scheme, or a bare code, and
works out the alphabet the way the site does. `--alphabet
base64url|base79|emoji` picks the output charset, `--json` prints one object
per invocation, and `--model PATH` (or `$NANOURL_MODEL`) runs other weights.
Exit codes: 0 success, 1 unusable input, 2 model unavailable.

The tokenizer and the weights are compiled into the binary, which is why it is
about 131 MB. The tool opens no socket, keeps no cache and carries no TLS
stack, so a link decodes on a machine that has never been online and keeps
decoding when nothing about this project is reachable any more. `nanourl
model verify` re-hashes the embedded weights against the published digest;
`nanourl model export FILE` writes them out (`--force` to overwrite).

### Install

Prebuilt binaries are attached to every `v*`
[release](https://github.com/howforge-dev/nanourl/releases). Each archive
holds the binary, the licence and a short README; `SHA256SUMS` covers them all.

| archive | platform |
|---|---|
| `nanourl-<version>-x86_64-unknown-linux-musl.tar.gz` | Linux x86-64, static |
| `nanourl-<version>-aarch64-unknown-linux-musl.tar.gz` | Linux ARM64, static |
| `nanourl-<version>-x86_64-apple-darwin.tar.gz` | macOS, Intel |
| `nanourl-<version>-aarch64-apple-darwin.tar.gz` | macOS, Apple silicon |
| `nanourl-<version>-x86_64-pc-windows-msvc.zip` | Windows x86-64 |
| `nanourl-<version>-aarch64-pc-windows-msvc.zip` | Windows ARM64 |

The Linux and Windows binaries are statically linked: no libc, no Visual C++
redistributable. The macOS binaries link only `libSystem` and run on macOS 11
and later.

From a checkout, with the weights at `models/target-base/ptq.nurl` (or named
by `$NANOURL_MODEL_FILE`):

```bash
cargo install --path rust/nanourl
```

### Verifying a download

`SHA256SUMS` lists every archive's digest. The binaries are also reproducible:
the compiler is pinned by `rust/rust-toolchain.toml`, the build flags come from
`rust/rustflags.sh`, and every release binary was built twice and required to
be byte-identical. To check one yourself, build the tag on the same
architecture and compare:

```bash
git checkout v<version>
cd rust/nanourl
RUSTFLAGS="$(../rustflags.sh <target>)" cargo build --release --locked --target <target>
sha256sum ../target/<target>/release/nanourl
```

On macOS the linker folds the checkout path into the binary's `LC_UUID`, so a
matching digest there needs the path the release was built at,
`/Users/runner/_work/nanourl/nanourl`.

## Repository layout

| path | what |
|---|---|
| `web/` | the Vite + Svelte 5 + TypeScript site, its build scripts and tests |
| `rust/` | a two-crate cargo workspace: one lock file, one `target/`, one toolchain pin |
| `rust/urlcodec/` | the codec: model inference, arithmetic coder, tokenizer, canonicaliser; native and three wasm tiers |
| `rust/nanourl/` | the CLI: the clap tree, link parsing, and the `build.rs` that embeds the weights |
| `models/url-bpe-8k-cap24-s0/` | the byte-level BPE tokenizer (8,192 tokens, max length 24) |
| `scripts/scrub-check.sh` | the publication gate CI runs on every push |

The training pipeline that produced the weights is not part of this repository.

## Build it locally

```bash
mise install                      # task, node, pnpm at the pinned versions
(cd rust && rustup show)          # rustup installs the compiler rust-toolchain.toml names
rustup toolchain install "$(cat rust/NIGHTLY)" --component rust-src --profile minimal
rustup target add wasm32-unknown-unknown
rustup target add wasm32-unknown-unknown --toolchain "$(cat rust/NIGHTLY)"

# the weights are a release asset, not a git object
mkdir -p models/target-base
curl -sSL -o models/target-base/ptq.nurl \
  https://github.com/howforge-dev/nanourl/releases/download/model-v0/nanourl-target-base.nurl

cd web && pnpm install --frozen-lockfile && cd ..
task web:build                    # wasm tiers -> packed assets -> web/dist
```

`web/dist/` is the deployable site. `task codec:test` runs the codec's gates;
from `web/`, `pnpm test`, `pnpm check` and `pnpm lint` cover the app, and
`pnpm exec playwright test` drives a real browser against a real build. The
nightly is needed only for the multi-threaded wasm tier; without it the other
two build and the loader falls back.

The three `.wasm` files the site serves are pinned by digest in
`rust/urlcodec/wasm.sha256`, and `task web:assets` packs nothing else. The pin
describes an `x86_64-unknown-linux-gnu` build; on another architecture, build
for development with `UNPINNED=1`.

## Kernel tiers

`web/src/lib/codec/tier.ts` picks a wasm build and a worker count at load
time: threads when the page is cross-origin isolated, then relaxed-simd, then
portable simd128. A tier that fails to load degrades to the next one down.
Speed depends on the device, so open `/bench.html` to measure every tier on
the machine you are using.

## Release assets

The weights ship as a GitHub release under the tag **`model-v0`**:

| asset | what |
|---|---|
| `nanourl-target-base.nurl` | the quantised model, 130,862,112 bytes, sha256 `5e37aad1f34c420f2a3f5ea5a273ec3bd95a99b48f0c3eaa29187b1d22039fd2` |
| `tokenizer.json` | the byte-level BPE tokenizer, identical to `models/url-bpe-8k-cap24-s0/tokenizer.json` |
| `manifest.json` | model config, artifact digest, training summary and eval scores |

`manifest.json` is also checked in at `web/scripts/fixtures/manifest.json`,
from which `web/src/lib/numbers.ts` is generated: the single source of every
numeric fact the explainer states. CI fetches the `.nurl`, verifies its sha256
and packs it, and the packed digest is checked against the one `numbers.ts`
records, so the site never quotes one model's figures beside another's weights.

## Licence

MIT, see [LICENSE](LICENSE). Copyright (c) 2026 howforge.dev.
