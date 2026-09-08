// End-to-end smoke test of the wasm codec path, run directly under node (no
// Worker, no browser). The real coordinator (src/lib/codec/worker.ts) is
// exercised via Playwright's e2e suite instead. This test reuses the exact
// put/read byte-marshalling helpers worker.ts uses (src/lib/codec/abi.ts),
// so it verifies the same code the browser path relies on.
//
// Needs the packed dev assets (`task web:assets`, gitignored); skips with a
// clear reason when they are not present.
/// <reference types="node" />
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { put, read } from '../src/lib/codec/abi';
import { assemble } from '../src/lib/codec/loader';
import { numbers } from '../src/lib/numbers';
import { DEFAULT_ALPHABET } from '../src/lib/alphabet';
import type { Manifest } from '../src/lib/codec/manifest';
import { ASSETS_JSON, PUBLIC_DIR } from '../scripts/paths';


const assetsJsonPath = ASSETS_JSON;
const publicDir = PUBLIC_DIR;
const hasAssets = existsSync(assetsJsonPath);

if (!hasAssets) {
  // eslint-disable-next-line no-console
  console.warn(`worker-smoke: skipping — ${assetsJsonPath} not found; run \`task web:assets\` to pack the dev artifact first`);
}


describe.skipIf(!hasAssets)('worker smoke: real wasm + model + tokenizer (needs `task web:assets`)', () => {
  it(
    'codec_init, codec_info (vocab 8192), codec_encode over a real URL',
    async () => {
      const manifest: Manifest = JSON.parse(readFileSync(assetsJsonPath, 'utf-8'));

      const chunkBytes = manifest.model.chunks.map((c) => new Uint8Array(readFileSync(resolve(publicDir, c.name))));
      const model = assemble(chunkBytes, manifest.model.bytes);
      const tokenizer = new Uint8Array(readFileSync(resolve(publicDir, manifest.tokenizer.name)));
      const wasmBytes = new Uint8Array(readFileSync(resolve(publicDir, manifest.wasm.name)));

      const module = await WebAssembly.compile(wasmBytes);
      const imports = WebAssembly.Module.imports(module);
      const shared = imports.some((i) => i.module === 'env' && i.name === 'memory');
      expect(shared).toBe(false); // this branch only ships the single-thread build

      const instance = await WebAssembly.instantiate(module, {});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- hand-rolled C ABI has no generated types
      const ex: any = instance.exports;
      const memory = ex.memory as WebAssembly.Memory;

      const mp = ex.ualloc(model.length);
      new Uint8Array(memory.buffer, mp, model.length).set(model);
      const tp = ex.ualloc(tokenizer.length);
      new Uint8Array(memory.buffer, tp, tokenizer.length).set(tokenizer);
      const rc = ex.codec_init(mp, model.length, tp, tokenizer.length, 0);
      ex.ufree(mp, model.length);
      ex.ufree(tp, tokenizer.length);
      expect(rc).toBe(0);

      const info = read(memory, ex.codec_info()) as { ok: boolean; vocab: number };
      // eslint-disable-next-line no-console
      console.log('worker-smoke codec_info:', JSON.stringify(info));
      expect(info.ok).toBe(true);
      expect(info.vocab).toBe(numbers.vocab); // the generated figure, not a second copy of it

      const url = 'https://www.example.com/a?b=1';
      const [p, l] = put(ex, memory, url);
      const encoded = read(memory, ex.codec_encode(p, l, DEFAULT_ALPHABET)) as { ok: boolean; coded: string };
      ex.ufree(p, l);
      // eslint-disable-next-line no-console
      console.log('worker-smoke codec_encode:', JSON.stringify(encoded));
      expect(encoded.ok).toBe(true);
      expect(typeof encoded.coded).toBe('string');

      // Close the round trip: without this, a codec emitting a stable but
      // *wrong* bitstream would still pass the suite, and the codec has to be
      // lossless.
      const [dp, dl] = put(ex, memory, encoded.coded);
      const decoded = read(memory, ex.codec_decode(dp, dl, DEFAULT_ALPHABET)) as { ok: boolean; url: string };
      ex.ufree(dp, dl);
      expect(decoded.ok).toBe(true);
      expect(decoded.url).toBe(url);

      // The learn page's worked example, run against the artifact packed
      // into web/public. Catches numbers.ts generated from one run's
      // manifest while web/public is packed from another run's export, a
      // mismatch that identical artifact_bytes alone would hide.
      const [hp, hl] = put(ex, memory, numbers.hn.url);
      const hn = read(memory, ex.codec_encode(hp, hl, DEFAULT_ALPHABET)) as {
        ok: boolean;
        coded: string;
        canonical: string;
        coded_chars: number;
        coded_bits: number;
        model_bits: number;
      };
      ex.ufree(hp, hl);
      expect(hn.ok).toBe(true);
      expect(hn.coded, 'the shipped artifact must produce the code the learn page shows').toBe(numbers.hn.coded);
      expect(hn.canonical).toBe(numbers.hn.canonical);
      expect(hn.coded_chars).toBe(numbers.hn.coded_chars);
      expect(hn.coded_bits).toBe(numbers.hn.coded_bits);
      expect(hn.model_bits).toBeCloseTo(numbers.hn.model_bits, 2);

      // codec_info() and numbers.ts use different param-count conventions (the
      // wasm adds the 32,000 RMSNorm gains, training/model.py doesn't), so
      // cross-check the artifact length, which has exactly one meaning.
      const infoFull = read(memory, ex.codec_info()) as { artifact_bytes: number };
      expect(infoFull.artifact_bytes).toBe(numbers.artifactBytes);

      // codec_sample(seed: u32, temp: f32, top_k: u32, max_tokens: u32, p, l) -> u64;
      // an empty prefix (l = 0) samples unconditionally. Pins SampleResult's
      // real shape: { ok, url, canonical, pieces, terminated }, not
      // { ok, url, canonical, tokens }, which reads just as plausible.
      const [sp, sl] = put(ex, memory, '');
      const sampled = read(memory, ex.codec_sample(1, 1.0, 0, 16, sp, sl)) as {
        ok: boolean;
        pieces?: unknown;
        terminated?: unknown;
      };
      ex.ufree(sp, sl);
      // eslint-disable-next-line no-console
      console.log('worker-smoke codec_sample:', JSON.stringify(sampled));
      expect(sampled.ok).toBe(true);
      expect(Array.isArray(sampled.pieces)).toBe(true);
      expect(typeof sampled.terminated).toBe('boolean');
    },
    30_000,
  );
});
