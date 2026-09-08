import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cliConstantsJson, linkCases, linkCasesJsonl } from '../scripts/cli-goldens-lib';
import { CLI_CONSTANTS_GOLDEN, CLI_LINK_GOLDEN } from '../scripts/paths';
import { ALPHABETS, B79_MARK, B79_ONLY, BASE79, DEFAULT_ALPHABET, QR_ALPHA, QR_MARK, QR_ONLY, QR_SHAPE } from '../src/lib/alphabet';

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
    for (const { id } of ALPHABETS) {
      expect(cases.filter((c) => c.kind === 'code' && c.alpha === id).length).toBeGreaterThanOrEqual(12);
    }
    const codes = cases.filter((c) => c.kind === 'code');
    // every spelling reads back as itself, bare and in a fragment, with its
    // alphabet (null for base64url), and is the code or one marker then it
    for (const c of codes) {
      expect(c.fragment).toBe(c.bare);
      const want = c.alpha === DEFAULT_ALPHABET ? null : c.alpha;
      expect(c.fromBare).toEqual({ code: c.bare, alpha: want });
      expect(c.fromLink).toEqual({ code: c.bare, alpha: want });
      expect([c.code, (c.alpha === BASE79 ? B79_MARK : c.alpha === QR_ALPHA ? QR_MARK : '') + c.code]).toContain(c.bare);
    }
    // base79 codes carrying no base79-only character, and codes of the
    // qr-alpha shape with and without `$*+.:`: marked; codes already holding
    // '~' as a digit: not marked again
    const b79 = codes.filter((c) => c.alpha === BASE79);
    expect(b79.some((c) => !B79_ONLY.test(c.code))).toBe(true);
    expect(b79.some((c) => QR_SHAPE.test(c.code) && QR_ONLY.test(c.code))).toBe(true);
    expect(b79.some((c) => QR_SHAPE.test(c.code) && !QR_ONLY.test(c.code))).toBe(true);
    expect(b79.some((c) => c.code.includes(B79_MARK))).toBe(true);
    for (const c of b79) {
      const marked = !B79_ONLY.test(c.code) || QR_SHAPE.test(c.code);
      expect(c.bare).toBe(marked ? B79_MARK + c.code : c.code);
    }
    // qr-alpha codes of both kinds: the base64url lookalikes, which take the
    // marker, and the self-identifying ones (a `$*+.:` digit or a '/'), which
    // do not
    const qr = codes.filter((c) => c.alpha === QR_ALPHA);
    expect(qr.some((c) => !QR_ONLY.test(c.code) && !c.code.includes(QR_MARK))).toBe(true);
    expect(qr.some((c) => QR_ONLY.test(c.code))).toBe(true);
    expect(qr.some((c) => c.code.includes(QR_MARK))).toBe(true);
    for (const c of qr) {
      expect(c.bare).toBe(QR_ONLY.test(c.code) || c.code.includes(QR_MARK) ? c.code : QR_MARK + c.code);
    }
    // an all-uppercase base64url code stays ambiguous rather than becoming
    // qr-alpha
    const upper = codes.filter((c) => c.alpha === DEFAULT_ALPHABET && /^[A-Z]+$/.test(c.code));
    expect(upper.length).toBeGreaterThan(0);
    // and both ways percent-decoding can fail
    expect(cases.filter((c) => c.kind === 'parse' && c.error !== null).length).toBeGreaterThanOrEqual(2);
  });
});
