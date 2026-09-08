import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cliConstantsJson, linkCases, linkCasesJsonl } from '../scripts/cli-goldens-lib';
import { CLI_CONSTANTS_GOLDEN, CLI_LINK_GOLDEN } from '../scripts/paths';

// Half of a cross-language pin. The Rust CLI reimplements `parseLink` in
// `rust/nanourl/src/link.rs` and reads these same two files in
// `rust/nanourl/tests/link_test.rs`; this side fails when the checked-in
// goldens no longer describe the TypeScript, that side fails when the port no
// longer matches the goldens. Neither implementation can move alone.
describe('the CLI goldens describe the current alphabet and link modules', () => {
  it('link.jsonl is not stale', () => {
    expect(readFileSync(CLI_LINK_GOLDEN, 'utf8')).toBe(linkCasesJsonl());
  });

  it('cli.json is not stale', () => {
    expect(readFileSync(CLI_CONSTANTS_GOLDEN, 'utf8')).toBe(cliConstantsJson());
  });

  // A golden file is only worth what its cases cover: the shapes below are
  // the ones a wrong port gets wrong *quietly*, so their presence is asserted
  // rather than left to whoever edits the case list next.
  it('covers a dozen codes per alphabet, including the ones that decode silently wrong', () => {
    const cases = linkCases();
    for (const alpha of [0, 1, 2] as const) {
      expect(cases.filter((c) => c.kind === 'code' && c.alpha === alpha).length).toBeGreaterThanOrEqual(12);
    }
    const codes = cases.filter((c) => c.kind === 'code');
    // a base79 code beginning with '~' (the marker that must NOT be stripped
    // from a bare code) and one carrying no base79-only character (so
    // fragmentFor has to add the marker)
    expect(codes.some((c) => c.alpha === 0 && c.code.startsWith('~'))).toBe(true);
    expect(codes.some((c) => c.alpha === 0 && c.fragment === '~' + c.code)).toBe(true);
    // and both ways percent-decoding can fail
    expect(cases.filter((c) => c.kind === 'parse' && c.error !== null).length).toBeGreaterThanOrEqual(2);
  });
});
