// Build-time gate: `vite.config.ts`'s `checkNumbersMatchArtifact` plugin
// calls `artifactMismatch` from `buildStart`, so a plain `pnpm build` fails
// when src/lib/assets.json and src/lib/numbers.ts describe different model
// artifacts.
//
// tests/assets-sync.test.ts asserts the two agree *on this checkout*; this
// asserts the check itself rejects a mismatch, which is the part that has to
// keep working when someone edits the plugin.
/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { artifactMismatch, readPackedArtifact, type ArtifactIdentity } from '../scripts/artifact-gate';

const SHIPPED: ArtifactIdentity = {
  sha256: '5e37aad1f34c420f2a3f5ea5a273ec3bd95a99b48f0c3eaa29187b1d22039fd2',
  bytes: 130862112,
};
// Another run of the same config: byte-for-byte the same
// SIZE and a completely different digest. That identical length is exactly
// what hid C1: a length-only check would pass here.
const OTHER_RUN: ArtifactIdentity = {
  sha256: '76d483b39ee024d7df27cf24dfbd41226373312ccf52debab8319ee5bf2e45eb',
  bytes: 130862112,
};

describe('artifactMismatch', () => {
  it('passes when the packed artifact is the one numbers.ts describes', () => {
    expect(artifactMismatch({ ...SHIPPED }, { ...SHIPPED })).toBeNull();
  });

  it('REJECTS two runs of the same config — same byte length, different digest', () => {
    const problem = artifactMismatch(OTHER_RUN, SHIPPED);
    expect(problem).not.toBeNull();
    expect(problem).toContain('DIFFERENT model artifacts');
    // names both sides, so the message alone says which way round it is
    expect(problem).toContain('76d483b39ee024d7');
    expect(problem).toContain('5e37aad1f34c420f');
    expect(problem).toContain('pnpm exec tsx scripts/numbers.ts');
  });

  it('rejects a byte-length mismatch too', () => {
    expect(artifactMismatch({ sha256: SHIPPED.sha256, bytes: SHIPPED.bytes + 1 }, SHIPPED)).toContain('DIFFERENT model artifacts');
  });

  it('passes when nothing is packed yet — a fresh checkout must still build', () => {
    expect(artifactMismatch(null, SHIPPED)).toBeNull();
  });
});

describe('readPackedArtifact', () => {
  const dir = mkdtempSync(join(tmpdir(), 'artifact-gate-'));
  const write = (name: string, body: string) => {
    const p = join(dir, name);
    writeFileSync(p, body);
    return p;
  };

  it('reads model.sha256 and model.bytes out of a manifest', () => {
    const p = write('good.json', JSON.stringify({ model: { sha256: SHIPPED.sha256, bytes: SHIPPED.bytes, chunks: [] } }));
    expect(readPackedArtifact(p)).toEqual(SHIPPED);
  });

  it('returns null (never throws) for a missing, unparseable or shapeless manifest', () => {
    expect(readPackedArtifact(join(dir, 'does-not-exist.json'))).toBeNull();
    expect(readPackedArtifact(write('bad.json', '{ not json'))).toBeNull();
    expect(readPackedArtifact(write('empty.json', '{}'))).toBeNull();
    expect(readPackedArtifact(write('wrongtype.json', JSON.stringify({ model: { sha256: 1, bytes: '2' } })))).toBeNull();
  });
});
