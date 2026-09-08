// Injects `self.__SHELL__` / `self.__BUILD__` into dist/sw.js as two plain
// assignments prepended ahead of the bundle scripts/build-sw.ts already
// wrote there. Run by `pnpm build`, strictly after both `vite build` (the
// page shell) and build-sw.ts (dist/sw.js itself must already exist) — see
// package.json's `build` script.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildId, shellFiles } from './sw-manifest-lib';
import { DIST_DIR as distDir } from './paths';

function walk(dir: string, base: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(relative(base, full).split('\\').join('/'));
  }
  return out;
}

const shell = shellFiles(walk(distDir, distDir));
const build = buildId(shell);

const swPath = join(distDir, 'sw.js');
const bundle = readFileSync(swPath, 'utf8');
const banner = `self.__SHELL__ = ${JSON.stringify(shell)};\nself.__BUILD__ = ${JSON.stringify(build)};\n`;
writeFileSync(swPath, banner + bundle);

console.log(`sw: precaching ${shell.length} shell files, build ${build}`);
