import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fmtBytes } from '../src/lib/format';
import type { AssetEntry, Manifest } from '../src/lib/codec/manifest';
import { arg } from './argv';
import { CHUNK, chunkName, chunkPlan, hashName } from './pack-lib';
import { ASSETS_JSON, PUBLIC_DIR } from './paths';

// The commit the pack ran from, recorded in assets.json for provenance only.
// A tree with no git history still has to pack — an export directory, an
// unpacked tarball, a shallow copy into a container image — so an informational
// stamp must never be the thing that fails the build.
const gitRev = (): string => {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
};

const nurl = arg('--nurl')!,
  tok = arg('--tokenizer')!,
  wasm = arg('--wasm')!,
  wasmMt = arg('--wasm-mt'),
  wasmRelaxed = arg('--wasm-relaxed'),
  atlas = arg('--atlas');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const MANIFEST_PATH = ASSETS_JSON;

function readPriorManifest(): Manifest | null {
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
  } catch {
    return null; // first pack on this checkout
  }
}

// Refuse to silently drop an atlas the previous pack had. `task web:build`
// re-runs `web:assets` with its own defaults, so without this check, an
// operator who correctly ran `task web:assets ATLAS=atlas/atlas.bin` first
// would have it overwritten by the very next command the README tells them
// to run — and the observatory's flagship panel would then show end users a
// developer error message telling them to run a `task` command.
const prior = readPriorManifest();
if (!atlas && prior?.atlas) {
  throw new Error(
    `refusing to drop the token atlas: the current ${MANIFEST_PATH} has ${prior.atlas.name} but no --atlas was passed.\n` +
      `  Pass ATLAS=atlas/atlas.bin (task web:assets auto-detects web/atlas/atlas.bin when it exists), or delete\n` +
      `  ${MANIFEST_PATH} first if dropping the atlas panel is genuinely what you want.`,
  );
}

mkdirSync(PUBLIC_DIR, { recursive: true });
for (const f of readdirSync(PUBLIC_DIR)) if (f.endsWith('.bin')) unlinkSync(join(PUBLIC_DIR, f)); // one artifact set at a time

const model = readFileSync(nurl);
const modelSha = sha(model);
const chunks = chunkPlan(model.length).map((c) => {
  const buf = model.subarray(c.offset, c.offset + c.bytes);
  const name = chunkName(modelSha, CHUNK, c.index);
  writeFileSync(join(PUBLIC_DIR, name), buf);
  return { name, bytes: c.bytes, sha256: sha(buf) };
});

const one = (base: string, path: string, ext: string): AssetEntry => {
  const b = readFileSync(path);
  const h = sha(b);
  const name = hashName(base, h, ext);
  writeFileSync(join(PUBLIC_DIR, name), b);
  return { name, bytes: b.length, sha256: h };
};

const manifest: Manifest = {
  // `chunkBytes` records the chunking parameter the names above were built
  // from, so a future reader (or a debugging session) never has to infer it
  // from the first chunk's length.
  model: { chunks, bytes: model.length, sha256: modelSha, chunkBytes: CHUNK },
  tokenizer: one('tokenizer', tok, 'json.bin'),
  wasm: one('urlcodec', wasm, 'wasm.bin'),
  wasmMt: wasmMt ? one('urlcodec-mt', wasmMt, 'wasm.bin') : null,
  wasmRelaxed: wasmRelaxed ? one('urlcodec-relaxed', wasmRelaxed, 'wasm.bin') : null,
  atlas: atlas ? one('atlas', atlas, 'bin') : null,
  builtAt: new Date().toISOString(),
  source: { nurl, tokenizer: tok, git: gitRev() },
};

mkdirSync('src/lib', { recursive: true });
writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 1));

const assetCount = [manifest.tokenizer, manifest.wasm, manifest.wasmMt, manifest.wasmRelaxed, manifest.atlas].filter(
  Boolean,
).length;
console.log(`packed ${chunks.length} model chunks (${fmtBytes(model.length)}) + ${assetCount} assets`);
console.log(`  model sha256 ${modelSha}`);

if (!manifest.atlas) {
  console.warn(
    `\n  WARNING: no token atlas packed — the model observatory's atlas panel will render a developer\n` +
      `  error message to end users. Build one with the training pipeline's atlas exporter.\n` +
      `  and re-run with ATLAS=atlas/atlas.bin before deploying.\n`,
  );
}

// The staleness trap this guards against: numbers.ts could describe one run
// while web/public ships another, with identical
// artifact_bytes hiding it — artifact size is a pure function of the config,
// and two runs can share a config. numbers.ts records the artifact's digest,
// so the two can be compared directly. Warn here — the pack legitimately
// runs before `pnpm exec tsx scripts/numbers.ts` when a new artifact lands — and fail in
// tests/assets-sync.test.ts, which is what actually gates a commit.
const numbersPath = 'src/lib/numbers.ts';
if (existsSync(numbersPath)) {
  const m = /"artifactSha256":\s*"([0-9a-f]{64})"/.exec(readFileSync(numbersPath, 'utf8'));
  if (!m) {
    console.warn(`  WARNING: ${numbersPath} has no artifactSha256 — regenerate it with \`pnpm exec tsx scripts/numbers.ts\`.`);
  } else if (m[1] !== modelSha) {
    console.warn(
      `\n  WARNING: ${numbersPath} describes artifact ${m[1].slice(0, 16)}… but this pack shipped ${modelSha.slice(0, 16)}….\n` +
        `  The learn page's headline figures and worked example are about a DIFFERENT model than the one\n` +
        `  the browser will run. Run \`pnpm exec tsx scripts/numbers.ts --nurl ${nurl}\` (tests/assets-sync.test.ts fails until you do).\n`,
    );
  }
}
