// The shape of `src/lib/assets.json`: the packed asset manifest `task
// web:assets` writes and the browser loads from.
//
// One declaration, imported by the writer (`scripts/pack-assets.ts`) as its
// return type and by every reader. Without an annotation on the writer its
// object literal is structurally typed by inference, so dropping a field the
// loader reads is a runtime break in the browser rather than a compile error
// at the point that caused it. Deliberately in `lib/codec/` rather than
// `scripts/`: it describes an artifact the app consumes, and the app must not
// depend on the build tree.

/** One packed file: content-hashed name, exact byte length, sha256. The
 *  length is what `loader.ts` checks a Cache API hit against, and the digest
 *  what it verifies once on download. */
export interface AssetEntry {
  name: string;
  bytes: number;
  sha256: string;
}

export interface Manifest {
  /** The model, split into `chunkBytes`-sized pieces. `chunkBytes` records the
   *  chunking parameter the chunk NAMES were built from, so a reader never has
   *  to infer it from the first chunk's length. */
  model: { chunks: AssetEntry[]; bytes: number; sha256: string; chunkBytes: number };
  tokenizer: AssetEntry;
  /** The portable simd128 build every manifest has. */
  wasm: AssetEntry;
  /** Shared-memory (threads) build; null when it was not passed to the packer. */
  wasmMt: AssetEntry | null;
  /** Relaxed-SIMD build; null when it was not passed to the packer. */
  wasmRelaxed: AssetEntry | null;
  /** The token atlas the observatory's flagship panel needs; null renders a
   *  developer error message to end users, so `pack-assets.ts` refuses to drop
   *  one a previous pack had. */
  atlas: AssetEntry | null;
  builtAt: string;
  source: { nurl: string; tokenizer: string; git: string };
}
