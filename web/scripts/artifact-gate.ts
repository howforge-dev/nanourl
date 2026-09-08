// Build-time gate ensuring `src/lib/numbers.ts` (every figure the learn page
// shows) and `src/lib/assets.json` (the bytes the browser downloads)
// describe the same artifact.
//
// `pnpm test` (tests/assets-sync.test.ts) and a warning in `pack-assets.ts`
// check this too, but neither blocks the actual deploy path: pack a new
// artifact, skip `pnpm exec tsx scripts/numbers.ts`, run `pnpm build` — the command
// Cloudflare Pages' own Vite detection suggests — and dist/ ships one run's
// numbers beside another run's weights, with a green build and only an
// easily-missed warning line from the pack step.
//
// So the same comparison also runs from `vite.config.ts`'s `buildStart`.
// Split out here as a pure function plus a tolerant reader, so the
// comparison is unit testable without a filesystem or a Vite build.
import { readFileSync } from 'node:fs';

/** The artifact a file claims to describe: its digest and its byte length.
 *  Both matter — the length is what the manifest carries natively, the digest
 *  is the only field that can tell two runs of one config apart (their
 *  artifacts are byte-for-byte the same *size*). */
export interface ArtifactIdentity {
  sha256: string;
  bytes: number;
}

/**
 * `null` when the two agree (or when nothing is packed yet), otherwise a
 * message explaining the mismatch and naming the command that fixes it.
 *
 * A missing `packed` is deliberately NOT an error: a fresh checkout has no
 * `src/lib/assets.json` (it is gitignored, written by `task web:assets`) and
 * must still build, the same way `preloadFirstChunk()` quietly injects nothing
 * there.
 */
export function artifactMismatch(packed: ArtifactIdentity | null, described: ArtifactIdentity): string | null {
  if (!packed) return null;
  if (packed.sha256 === described.sha256 && packed.bytes === described.bytes) return null;
  const short = (id: ArtifactIdentity) => `${id.sha256.slice(0, 16)}… (${id.bytes.toLocaleString()} bytes)`;
  return (
    `src/lib/assets.json and src/lib/numbers.ts describe DIFFERENT model artifacts.\n` +
    `  packed into web/public : ${short(packed)}\n` +
    `  described by numbers.ts: ${short(described)}\n` +
    `The learn page's headline figures and worked example would be about a model the\n` +
    `browser never runs — the site would contradict itself two clicks apart.\n` +
    `Fix: run BOTH \`task web:assets\` and \`pnpm exec tsx scripts/numbers.ts\` for the same .nurl.`
  );
}

/** Read the packed manifest's artifact identity, or `null` when there is no
 *  manifest yet / it cannot be parsed. Never throws: a build on a fresh
 *  checkout must not die here. */
export function readPackedArtifact(manifestPath: string): ArtifactIdentity | null {
  try {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as { model?: { sha256?: unknown; bytes?: unknown } };
    const sha256 = m.model?.sha256;
    const bytes = m.model?.bytes;
    if (typeof sha256 !== 'string' || typeof bytes !== 'number') return null;
    return { sha256, bytes };
  } catch {
    return null; // no assets.json yet — `task web:assets` has not run
  }
}
