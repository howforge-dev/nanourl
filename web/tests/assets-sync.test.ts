// The staleness gate: `src/lib/numbers.ts` (every figure the learn page
// shows) and `src/lib/assets.json` (the bytes the browser downloads) must
// describe the SAME artifact, and byte count alone cannot tell that apart.
// Two different runs that share a config produce the same
// `model.artifact_bytes` (130,862,112) and the same
// architecture numbers by construction, even though the weights differ:
// numbers.ts could describe one run's worked example (HN URL compressing to
// `IDrqYQdZ`) while `web/public/*.bin` is the other run's export (producing
// `BAajQuI8c` instead), with every other gate green.
//
// The digest is the one field that can tell two runs of one config apart, so
// numbers.ts records it (`web/scripts/numbers.ts --nurl`) and this compares.
/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

import { numbers } from '../src/lib/numbers';
import { CHUNK, chunkName } from '../scripts/pack-lib';
import type { Manifest } from '../src/lib/codec/manifest';
import { ASSETS_JSON } from '../scripts/paths';

const assetsJsonPath = ASSETS_JSON;
const hasAssets = existsSync(assetsJsonPath);

if (!hasAssets) {
  // eslint-disable-next-line no-console
  console.warn(`assets-sync: skipping — ${assetsJsonPath} not found; run \`task web:assets\` to pack an artifact first`);
}


describe.skipIf(!hasAssets)('assets.json vs numbers.ts (needs `task web:assets`)', () => {
  const manifest = (): Manifest => JSON.parse(readFileSync(assetsJsonPath, 'utf-8')) as Manifest;

  it('ships the model numbers.ts describes (sha256)', () => {
    expect(manifest().model.sha256).toBe(numbers.artifactSha256);
  });

  it('ships the model numbers.ts describes (byte length)', () => {
    expect(manifest().model.bytes).toBe(numbers.artifactBytes);
  });

  it('numbers.ts artifactMiB agrees with the packed byte length', () => {
    expect(numbers.artifactBytes / 1048576).toBeCloseTo(numbers.artifactMiB, 3);
  });

  it('every chunk name carries the model digest AND the chunk size', () => {
    const m = manifest();
    expect(m.model.chunkBytes).toBe(CHUNK);
    m.model.chunks.forEach((c, i) => {
      expect(c.name).toBe(chunkName(m.model.sha256, m.model.chunkBytes, i));
    });
  });

  it('the chunks cover the model exactly once, in order', () => {
    const m = manifest();
    expect(m.model.chunks.reduce((a, c) => a + c.bytes, 0)).toBe(m.model.bytes);
    for (const c of m.model.chunks.slice(0, -1)) expect(c.bytes).toBe(m.model.chunkBytes);
  });
});
