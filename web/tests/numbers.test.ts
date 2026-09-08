import { describe, it, expect } from 'vitest';
import { buildNumbers, parseEvalText, required } from '../scripts/numbers-lib';
import type { ArtifactFacts, HnTrace, StaticFacts, ZipSizes } from '../scripts/numbers-lib';
import { CHUNK } from '../scripts/pack-lib';
import { ALPHABETS } from '../src/lib/alphabet';

const zip: ZipSizes = { raw: 45, deflate: 42, gzip: 60, bzip2: 83, xz: 104 };
const hn: HnTrace = {
  url: 'https://news.ycombinator.com/item?id=38000000',
  canonical: 'https://com.ycombinator.news/item?id=38000000',
  coded: 'IDrqYQdZ',
  url_chars: 45,
  coded_chars: 8,
  coded_bits: 43,
  model_bits: 41.79,
  bits_per_char: 0.9556,
  ratio: 0.1778,
  tokens: [{ piece: 'https://', bits: 0.73, clo: 0.000016, chi: 0.60434 }],
};
const staticFacts: StaticFacts = {
  rfcDelimiters: 29,
  groupSize: 64,
  probGridBits: 24,
  streamVersion: 0,
  chainCarry: 256,
  maxTokenLength: 24,
  chunkMiB: CHUNK / (1024 * 1024),
  quantBits: 4,
  quantLevels: 15,
  quantHalfRange: 7,
  gpuCount: 8,
  alphabets: ALPHABETS.map((a) => a.key),
  alphabetSizes: { base64url: 64, base79: 79, 'emoji-1k': 1024 },
  int4RoundingNoTailPct: 8.3,
  int4TailGapPct: 1.3,
};
// stands in for the hashed .nurl scripts/numbers.ts passes in — the length
// must agree with validManifest()'s model.artifact_bytes
const artifact: ArtifactFacts = { sha256: 'a'.repeat(64), bytes: 130862112 };

function validManifest() {
  return {
    model: { n_params: 246087680, artifact_bytes: 130862112, artifact_mib: 124.8 },
    config: { model: { n_layer: 12, d_model: 1280, n_head: 20 }, train: { iters: 76000, final_eval_urls: 100000 } },
    model_config: { head_dim: 64, d_mlp: 3392, vocab: 8192, block: 512 },
    schedule: { tokens_per_iter: 262144 },
    data: {
      total_tokens: 12981925526,
      total_urls: 365779523,
      eval_shard: 512,
      eval_source: 'owner/urls part-00512.parquet, even stride',
      tokenizer_sha256: '6e4f2b4fa9de153b27adaee016dc3f2586ac886423f0153858b89e13f31be374',
    },
  };
}
const validEval = 'fp32: 1.2629 bits/char over 99926 URLs (74 skipped)\nkernel_sim(int4): 1.26372 bits/char\n';

describe('buildNumbers', () => {
  it('builds from a complete manifest + eval file', () => {
    const data = buildNumbers(validManifest(), validEval, zip, hn, staticFacts, artifact);
    expect(data.params).toBe(246087680);
    expect(data.layers).toBe(12);
    expect(data.trainTokens).toBe(76000 * 262144);
    expect(data.evalUrls).toBe(100000);
    expect(data.evalUrlsSkipped).toBe(74);
    expect(data.evalSource).toBe('part-00512.parquet, even stride');
    expect(data.bitsPerChar).toBeCloseTo(1.2629);
    expect(data.bitsPerCharKernel).toBeCloseTo(1.26372);
    // The manifest lists the ten shards the QAT tail re-read; training drew
    // from forty, so both corpus totals are the manifest's scaled by 4 — and
    // training covered a FRACTION of that corpus, never a whole pass.
    expect(data.datasetUrls).toBe(365_779_523 * 4);
    expect(data.datasetTokens).toBe(12_981_925_526 * 4);
    expect(data.trainPasses).toBeCloseTo((76000 * 262144) / (12_981_925_526 * 4), 2);
    expect(data.trainPasses).toBeLessThan(1);
    expect(data.ratio).toBeGreaterThan(1);
  });

  it('refuses a manifest whose scaled corpus totals drift from the recorded ones', () => {
    // The scale factor is only valid for the ten-shard tail manifest. A
    // manifest listing some other slice must fail loudly, not silently
    // publish a corpus figure four times the wrong size.
    const bad = validManifest();
    (bad as { data: { total_urls: number } }).data.total_urls = 100_000_000;
    expect(() => buildNumbers(bad, validEval, zip, hn, staticFacts, artifact)).toThrow(/data\.total_urls/);
  });

  it('throws loudly when a required manifest field is missing', () => {
    const bad = validManifest();
    delete (bad as Record<string, unknown>).model;
    expect(() => buildNumbers(bad, validEval, zip, hn, staticFacts, artifact)).toThrow(/model\.n_params/);
  });

  it('throws when a nested field is missing (config.model.n_layer)', () => {
    const bad = validManifest();
    delete (bad.config.model as Record<string, unknown>).n_layer;
    expect(() => buildNumbers(bad, validEval, zip, hn, staticFacts, artifact)).toThrow(/config\.model\.n_layer/);
  });

  it('throws when the eval file has no fp32 line', () => {
    expect(() =>
      buildNumbers(validManifest(), 'kernel_sim(int4): 1.26372 bits/char\n', zip, hn, staticFacts, artifact),
    ).toThrow(/fp32/);
  });

  it('throws when the eval file has no kernel_sim line', () => {
    expect(() =>
      buildNumbers(
        validManifest(),
        'fp32: 1.2629 bits/char over 99926 URLs (74 skipped)\n',
        zip,
        hn,
        staticFacts,
        artifact,
      ),
    ).toThrow(/kernel_sim/);
  });

  it('throws when eval-final.txt and manifest.json disagree on eval set size', () => {
    const bad = validManifest();
    bad.config.train.final_eval_urls = 5000;
    expect(() => buildNumbers(bad, validEval, zip, hn, staticFacts, artifact)).toThrow(/disagree/);
  });

  it('throws when data.eval_shard is missing', () => {
    const bad = validManifest();
    delete (bad.data as Record<string, unknown>).eval_shard;
    expect(() => buildNumbers(bad, validEval, zip, hn, staticFacts, artifact)).toThrow(/data\.eval_shard/);
  });

  it('records the artifact sha256 the numbers describe', () => {
    const data = buildNumbers(validManifest(), validEval, zip, hn, staticFacts, artifact);
    expect(data.artifactSha256).toBe('a'.repeat(64));
    expect(data.artifactBytes).toBe(130862112);
  });

  it('throws when the --nurl artifact length disagrees with manifest.model.artifact_bytes', () => {
    const wrongLength: ArtifactFacts = { sha256: 'b'.repeat(64), bytes: 130862113 };
    expect(() => buildNumbers(validManifest(), validEval, zip, hn, staticFacts, wrongLength)).toThrow(
      /different runs/,
    );
  });

  it('throws when the artifact sha256 is not 64 hex characters', () => {
    const badSha: ArtifactFacts = { sha256: 'not-a-digest', bytes: 130862112 };
    expect(() => buildNumbers(validManifest(), validEval, zip, hn, staticFacts, badSha)).toThrow(
      /64 lowercase hex/,
    );
  });

  it('required() names the manifest and the exact missing path', () => {
    expect(() => required({}, 'a.b.c', 'manifest.json')).toThrow('manifest.json: missing required field "a.b.c"');
  });
});

describe('parseEvalText', () => {
  it('parses all three lines when present', () => {
    const text =
      'fp32: 1.2629 bits/char over 99926 URLs (74 skipped)\n' +
      'kernel_sim(int4): 1.26372 bits/char\n' +
      'kernel: 1.2952 bits/char (rust/nurlcheck) over 500 URLs, artifact 124.8 MiB\n';
    const ev = parseEvalText(text, 'eval-final.txt');
    expect(ev.bitsPerChar).toBeCloseTo(1.2629);
    expect(ev.evalUrlsScored).toBe(99926);
    expect(ev.evalUrlsSkipped).toBe(74);
    expect(ev.bitsPerCharKernel).toBeCloseTo(1.26372);
    expect(ev.bitsPerCharKernelReal).toBeCloseTo(1.2952);
  });

  it('leaves bitsPerCharKernelReal null when the rust/nurlcheck line is absent', () => {
    const ev = parseEvalText(validEval, 'eval-final.txt');
    expect(ev.bitsPerCharKernelReal).toBeNull();
  });
});
