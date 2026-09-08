// The `--flag value` reader the build scripts and the E2E server share.
//
// Three copies with two signatures: `pack-assets.ts`'s returned undefined for
// a missing flag, `numbers.ts`'s and `serve.ts`'s took a fallback and were
// byte-identical to each other. One function with an optional fallback covers
// both, and a flag whose value is missing (`--out` as the last argument) can
// never again mean "use the default" in one script and "undefined" in
// another.

/** The value after `--flag` in `process.argv`, or `fallback` when the flag is
 *  absent or trailing. */
export function arg(flag: string, fallback: string): string;
export function arg(flag: string): string | undefined;
export function arg(flag: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
