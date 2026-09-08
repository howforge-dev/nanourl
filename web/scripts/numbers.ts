// Generates src/lib/numbers.ts — the learn page's only source of numeric
// facts about the model, training run, and eval. Run after every production
// eval lands, via `pnpm exec tsx scripts/numbers.ts` (which passes the same NURL default as
// `task web:assets`, so the two can never describe different artifacts):
//
//   pnpm exec tsx scripts/numbers.ts \
//     --manifest scripts/fixtures/manifest.json \
//     --eval scripts/fixtures/eval-final.txt \
//     --hn-trace scripts/fixtures/hn-trace.json \
//     --nurl ../models/target-base/ptq.nurl
//
// Fails loudly (throws, nonzero exit) if manifest.json or eval-final.txt is
// missing a required field — see numbers-lib.ts's `required`/`num` — rather
// than silently writing a stale or placeholder number.
//
// `--nurl` closes the gap where `numbers.ts` could describe a different
// artifact than the one actually shipped: the artifact's own sha256 and
// byte length are recorded into numbers.ts, `tests/assets-sync.test.ts`
// fails when they don't match what `task web:assets` actually packed, and
// pack-assets.ts says so loudly at pack time. Without it, numbers.ts
// describing one production run while `web/public/*.bin` carries a
// different export would be invisible to every gate.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { deflateRawSync, gzipSync } from 'node:zlib';
import { ALPHABETS } from '../src/lib/alphabet';
import { WORKED_EXAMPLE_URL } from '../src/lib/examples';
import { fmtCount, fmtMiB } from '../src/lib/format';
import { arg } from './argv';
import { CHUNK } from './pack-lib';
import { buildNumbers, type HnTrace, type StaticFacts, type ZipSizes } from './numbers-lib';
import { NUMBERS_TS, SCRIPTS_DIR, WEB_ROOT } from './paths';

const fixture = (name: string) => resolve(SCRIPTS_DIR, 'fixtures', name);

const MIB = 1024 * 1024;

const manifestPath = resolve(process.cwd(), arg('--manifest', fixture('manifest.json')));
const evalPath = resolve(process.cwd(), arg('--eval', fixture('eval-final.txt')));
const hnTracePath = resolve(process.cwd(), arg('--hn-trace', fixture('hn-trace.json')));
// bzip2/xz sizes for the "why not just zip it" table (node has no stdlib
// implementation of either) plus the recorded deflate/gzip figures this box
// must reproduce — see the file's own _comment.
const zipSizesPath = fixture('zip-sizes.json');
// The packed artifact itself: hashed here so numbers.ts records WHICH weights
// it describes. Defaults to the same path Taskfile.yml's web:assets uses.
const nurlPath = resolve(process.cwd(), arg('--nurl', resolve(WEB_ROOT, '../models/target-base/ptq.nurl')));
const outPath = resolve(process.cwd(), arg('--out', NUMBERS_TS));

// The HN example URL: news.ycombinator.com's canonical "start of Sept 2023"
// story id, used throughout the learn page's worked examples (tokens, bits,
// whynotzip, coder). One constant, in src/lib/examples.ts beside the
// compressor's own list — see WORKED_EXAMPLE_URL for why the two HN URLs are
// deliberately different.
const HN_URL = WORKED_EXAMPLE_URL;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Measure classical compressors on the raw (uncanonicalised) URL — the "why
// not just zip it" section's whole point is that these arrive knowing nothing
// about URL structure.
//
// deflate and gzip come from node's OWN bundled zlib, not a `python3 -c`
// subprocess. That mattered: python3's zlib is whatever the interpreter is
// linked against, and two nominally-1.3.1 builds disagree on this exact input
// at the same level and window bits (42 bytes vs 43) — so `numbers.zip` was a
// property of the generating box, and a python linked against zlib-ng (common
// in distro and conda builds) silently regenerated a different WhyNotZip
// table. node ships one zlib per release, so this reproduces.
//
// bzip2 and xz have no node stdlib implementation, so they are vendored in
// scripts/fixtures/zip-sizes.json with their provenance. deflate/gzip are
// recorded there too and cross-checked here, so a node whose zlib disagrees
// fails the run loudly instead of rewriting the table behind your back.
interface ZipFixture extends ZipSizes {
  url: string;
  node_zlib: string;
}

function measureZip(url: string, fixture: ZipFixture): ZipSizes {
  if (fixture.url !== url) {
    throw new Error(`scripts/fixtures/zip-sizes.json is for a different URL (${fixture.url}), expected ${url}`);
  }
  const u = Buffer.from(url, 'utf8');
  // level 9, raw deflate (no zlib header) — the same shape zip's engine emits
  const measured = { raw: u.length, deflate: deflateRawSync(u, { level: 9 }).length, gzip: gzipSync(u, { level: 9 }).length };
  for (const k of ['raw', 'deflate', 'gzip'] as const) {
    if (measured[k] !== fixture[k]) {
      throw new Error(
        `zip-sizes.json records ${k}=${fixture[k]} but this node's zlib ` +
          `(${process.versions.zlib}) measures ${measured[k]}. The fixture was recorded with ` +
          `${fixture.node_zlib}. Re-record the fixture deliberately (and say which node did it) ` +
          `rather than letting the learn page's table drift silently.`,
      );
    }
  }
  return { ...measured, bzip2: fixture.bzip2, xz: fixture.xz };
}

const manifest = readJson(manifestPath);
const evalText = readFileSync(evalPath, 'utf8');
const hnTraceRaw = readJson(hnTracePath) as {
  url: string;
  canonical: string;
  coded: string;
  url_chars: number;
  coded_chars: number;
  coded_bits: number;
  model_bits: number;
  bits_per_char: number;
  ratio: number;
  tokens: { piece: string; bits: number; clo?: number; chi?: number }[];
};
if (hnTraceRaw.url !== HN_URL) {
  throw new Error(`scripts/fixtures/hn-trace.json is for a different URL (${hnTraceRaw.url}), expected ${HN_URL}`);
}
// pick only the declared HnTrace fields — the fixture also carries "ok",
// "version", "bitstr" and a "source" provenance note that aren't page facts
const hn: HnTrace = {
  url: hnTraceRaw.url,
  canonical: hnTraceRaw.canonical,
  coded: hnTraceRaw.coded,
  url_chars: hnTraceRaw.url_chars,
  coded_chars: hnTraceRaw.coded_chars,
  coded_bits: hnTraceRaw.coded_bits,
  model_bits: hnTraceRaw.model_bits,
  bits_per_char: hnTraceRaw.bits_per_char,
  ratio: hnTraceRaw.ratio,
  tokens: hnTraceRaw.tokens.map((t) => ({ piece: t.piece, bits: t.bits, clo: t.clo, chi: t.chi })),
};
const zip = measureZip(HN_URL, readJson(zipSizesPath) as ZipFixture);
// Hash the real artifact. Streaming would be tidier, but 125 MiB read once by
// a build script is not worth the ceremony.
const nurlBytes = readFileSync(nurlPath);
const artifact = { sha256: createHash('sha256').update(nurlBytes).digest('hex'), bytes: nurlBytes.length };

// Static design facts — true by construction (rust/urlcodec, docs/tokenization.md),
// plus one figure not yet backed by a committed experiment file (see the
// StaticFacts doc comment in numbers-lib.ts): the int4-without-QAT-tail
// regression. No timing figure belongs here: speed is a property of the
// visitor's own device, and /bench.html measures it there.
const staticFacts: StaticFacts = {
  rfcDelimiters: 29,
  groupSize: 64,
  probGridBits: 24,
  streamVersion: 0,
  chainCarry: 256, // rust/urlcodec/src/model.rs CHAIN_CARRY — the over-length fallback's carry window
  maxTokenLength: 24, // settled tokenizer cap
  chunkMiB: CHUNK / MIB, // the model's download chunk size, from the packer itself
  quantBits: 4,
  quantLevels: 15, // 2^4 - 1: signed steps, zero included, one code point unused
  quantHalfRange: 7, // steps run -7..+7
  gpuCount: 8, // training node: 8x RTX 5090
  // Derived from lib/alphabet.ts's ALPHABETS (which mirrors
  // rust/urlcodec/src/coder.rs) rather than hand-written a second time — the
  // learn page's bits/char figures are log2 of these sizes.
  alphabets: ALPHABETS.map((a) => a.key),
  alphabetSizes: Object.fromEntries(ALPHABETS.map((a) => [a.key, a.size])),
  int4RoundingNoTailPct: 8.3,
  int4TailGapPct: 1.3,
};

const data = buildNumbers(manifest, evalText, zip, hn, staticFacts, artifact);

// relative to web/, so the emitted header is identical on every machine
const rel = (p: string) => relative(process.cwd(), p);
const header = `// GENERATED by web/scripts/numbers.ts — do not hand-edit. Regenerate: \`pnpm exec tsx scripts/numbers.ts\`
// Source manifest:     ${rel(manifestPath)}
// Source eval:         ${rel(evalPath)}
// Source hn trace:     ${rel(hnTracePath)}
// Source zip sizes:    ${rel(zipSizesPath)} (deflate/gzip re-measured with node zlib ${process.versions.zlib})
// Source artifact:     ${rel(nurlPath)} sha256 ${artifact.sha256}
// Generated:           ${new Date().toISOString()}
//
// Every numeric fact the learn page shows comes from here.
// \`artifactSha256\` is the gate: tests/assets-sync.test.ts fails if the model
// \`task web:assets\` packed into web/public isn't the one described here.
`;

const body = `export interface HnTraceToken {
  piece: string;
  bits: number;
  clo?: number;
  chi?: number;
}

export interface Numbers {
  params: number;
  layers: number;
  dModel: number;
  heads: number;
  headDim: number;
  dMlp: number;
  vocab: number;
  block: number;
  trainTokens: number;
  datasetUrls: number;
  datasetTokens: number;
  trainPasses: number;
  meanTokensPerUrl: number;
  bitsPerChar: number;
  bitsPerCharKernel: number;
  bitsPerCharKernelReal: number | null;
  evalUrls: number;
  evalUrlsSkipped: number;
  artifactBytes: number;
  artifactMiB: number;
  /** sha256 of the .nurl artifact these numbers describe — the anchor
   *  tests/assets-sync.test.ts checks web/src/lib/assets.json against. */
  artifactSha256: string;
  f32MiB: number;
  ratio: number;
  evalShard: number;
  evalSource: string;
  tokenizerSha256: string;
  zip: { raw: number; deflate: number; gzip: number; bzip2: number; xz: number };
  hn: {
    url: string;
    canonical: string;
    coded: string;
    url_chars: number;
    coded_chars: number;
    coded_bits: number;
    model_bits: number;
    bits_per_char: number;
    ratio: number;
    tokens: HnTraceToken[];
  };
  static: {
    rfcDelimiters: number;
    groupSize: number;
    probGridBits: number;
    streamVersion: number;
    chainCarry: number;
    maxTokenLength: number;
    chunkMiB: number;
    quantBits: number;
    quantLevels: number;
    quantHalfRange: number;
    gpuCount: number;
    alphabets: readonly string[];
    alphabetSizes: Readonly<Record<string, number>>;
    int4RoundingNoTailPct: number;
    int4TailGapPct: number;
  };
}

export const numbers: Numbers = ${JSON.stringify(data, null, 2)} as const;
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, header + '\n' + body);
console.log(`wrote ${outPath.replace(process.cwd() + '/', '')}`);
console.log(`  params ${fmtCount(data.params)}, ${data.layers}x${data.dModel}, ${data.heads} heads`);
console.log(`  bits/char fp32 ${data.bitsPerChar}, int4 kernel_sim ${data.bitsPerCharKernel}`);
console.log(`  artifact ${fmtMiB(data.artifactMiB)} (${data.ratio.toFixed(2)}x smaller than f32), sha256 ${data.artifactSha256}`);
