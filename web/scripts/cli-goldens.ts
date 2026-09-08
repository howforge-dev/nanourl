// Regenerate the goldens that pin the Rust CLI to src/lib/alphabet.ts and
// src/lib/links.ts. Run it after changing either:
//
//     pnpm exec tsx scripts/cli-goldens.ts
//
// `tests/cli-goldens.test.ts` fails when the checked-in files are stale, so
// this is never something the build runs on its own.
import { writeFileSync } from 'node:fs';
import { cliConstantsJson, linkCasesJsonl } from './cli-goldens-lib';
import { CLI_CONSTANTS_GOLDEN, CLI_LINK_GOLDEN } from './paths';

writeFileSync(CLI_LINK_GOLDEN, linkCasesJsonl());
writeFileSync(CLI_CONSTANTS_GOLDEN, cliConstantsJson());
console.log(`wrote ${CLI_LINK_GOLDEN}\nwrote ${CLI_CONSTANTS_GOLDEN}`);
