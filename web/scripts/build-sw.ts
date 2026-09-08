// Bundles src/sw.ts to dist/sw.js as a single classic (non-module) script.
// `navigator.serviceWorker.register('/sw.js')` in registerSw.ts registers it
// without `{ type: 'module' }` (the default), which requires a plain script,
// not an ES module. Uses Vite's own library-mode build (already a
// devDependency, so it adds no workbox and no new dependency) rather than the
// main `vite build` in package.json's `build` script, which is configured for
// the page entries (rollupOptions.input, code-split ES modules) and would be
// the wrong shape for a single self-contained worker file.
//
// Run by `pnpm build`, after the main `vite build` (so dist/ already holds
// the page shell this needs to leave untouched; emptyOutDir: false) and
// before scripts/sw-manifest.ts (which injects self.__SHELL__/self.__BUILD__
// into the dist/sw.js this step produces).
import { resolve } from 'node:path';
import { build } from 'vite';
import { WEB_ROOT as root } from './paths';

await build({
  configFile: false,
  root,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2022',
    minify: true,
    lib: {
      entry: resolve(root, 'src/sw.ts'),
      formats: ['iife'],
      // Unused at runtime (sw.ts has no exports), but rollup's iife format
      // still requires a name to bind the (empty) export object to.
      name: '__nanourlSw',
      fileName: () => 'sw.js',
    },
  },
});
