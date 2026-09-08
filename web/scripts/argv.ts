// The `--flag value` reader the build scripts and the E2E server share.
//
// One function with an optional fallback covers both call signatures: with a
// fallback it returns the default for a missing flag, without one it returns
// undefined. A flag whose value is missing (`--out` as the last argument)
// therefore means the same thing in every script.

/** The value after `--flag` in `process.argv`, or `fallback` when the flag is
 *  absent or trailing. */
export function arg(flag: string, fallback: string): string;
export function arg(flag: string): string | undefined;
export function arg(flag: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
