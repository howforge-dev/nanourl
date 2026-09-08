import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';
import { copyFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { artifactMismatch, readPackedArtifact } from './scripts/artifact-gate';
import { ASSETS_JSON, DIST_DIR, HEADERS_FILE } from './scripts/paths';
import { numbers } from './src/lib/numbers';
import { PAGES, pageHtmlFile } from './src/lib/pages';
import { renderPage } from './scripts/page-html';
import { logoSvg } from './src/lib/ui/logo';

// The wordmark's mark, as a file. A URL-encoded `data:` URI in each entry
// document is one copy of the mark per page that no build step can keep in
// step with the header's own SVG, plus ~430 bytes of unshared, uncacheable
// markup in every document.
//
// SVG, and only SVG: Chromium, Firefox and Safari 17+ all take an SVG
// favicon, and a raster fallback would mean a rasterizer in the build.
// Deliberately NOT content-hashed, so the name in the HTML is stable and
// `_headers` serves it under the site-wide `no-cache` rule rather than the
// immutable one, which is only correct for a hashed name.
const FAVICON = 'favicon.svg';

function favicon(): Plugin {
  return {
    name: 'favicon',
    // Dev serves it from the same function the build writes, so `pnpm dev`
    // shows the tab icon a deploy will.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if ((req.url ?? '').split('?')[0] !== `/${FAVICON}`) return next();
        res.setHeader('Content-Type', 'image/svg+xml');
        res.end(logoSvg());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: FAVICON, source: logoSvg() });
    },
  };
}

// Every page is declared once, in src/lib/pages.ts, and this generates the
// rest: one entry HTML per row (scripts/page-html.ts's single template, filled
// from that row's title, description and column width) and the build's entry
// list from the same rows.
//
// The generated files are written into `web/` and gitignored, because Vite
// derives an HTML entry's output path from its path relative to the project
// root — a file generated into a subdirectory would ship as
// `dist/<subdir>/model.html`, at a URL nothing links.
//
// Adding a page is a `PAGES` row plus a `src/pages/<id>/` directory, and
// nothing else: no `rollupOptions.input` entry, no hand-written `<id>.html`,
// and no second statement of the page's <head>.
function pages(): Plugin {
  return {
    name: 'pages',
    // `config`, not `buildStart`: the entry files must exist before Vite
    // resolves `rollupOptions.input`, and the dev server serves them off disk.
    config() {
      const input: Record<string, string> = {};
      // vitest loads this config too, and a unit-test run has no business
      // writing (or deleting) files in the working tree.
      if (process.env.VITEST) return {};
      const generated = new Set<string>();
      for (const p of PAGES) {
        const name = pageHtmlFile(p.id);
        generated.add(name);
        const file = resolve(__dirname, name);
        writeFileSync(file, renderPage(p.id));
        input[p.id] = file;
      }
      // A page removed from PAGES leaves its entry behind, and a stale file in
      // the root is still served by the dev server — so it would keep working
      // locally and 404 on the next deploy.
      for (const name of readdirSync(__dirname)) {
        if (name.endsWith('.html') && !generated.has(name)) rmSync(resolve(__dirname, name));
      }
      return { build: { rollupOptions: { input } } };
    },
  };
}


// Copies web/_headers into dist/ as part of `vite build` itself.
//
// `_headers` lives at web/_headers, not in Vite's publicDir, so without this,
// `pnpm build` — the build command Cloudflare Pages' own Vite detection
// suggests — would produce a dist/ with no COOP/COEP rules at all. The
// deploy would still be green and the site would still work, but the
// threads tier would never activate, and nothing surfaces that anywhere.
// Making the copy part of the build means every path that produces a dist/
// ships the headers.
function copyHeaders(): Plugin {
  return {
    name: 'copy-headers',
    apply: 'build',
    closeBundle() {
      copyFileSync(HEADERS_FILE, resolve(DIST_DIR, '_headers'));
      // `_redirects` maps `/` to `/index.html` on Cloudflare Workers, which
      // serves `.html` paths verbatim and otherwise 404s the bare root.
      copyFileSync(resolve(HEADERS_FILE, '..', '_redirects'), resolve(DIST_DIR, '_redirects'));
    },
  };
}

// Fails the build when src/lib/assets.json and src/lib/numbers.ts describe
// different model artifacts, on the path a deploy actually takes. `pnpm
// build` is what Cloudflare Pages' own Vite detection suggests, and it runs
// neither `pnpm test` (where tests/assets-sync.test.ts lives) nor `task
// web:numbers`, so without this check a stale numbers.ts could still ship
// with a green build.
//
// `buildStart`, so it fails before any bundling work. `apply: 'build'` keeps
// `pnpm dev` iterable, and a missing assets.json is not an error — see
// artifactMismatch's doc comment.
function checkNumbersMatchArtifact(): Plugin {
  return {
    name: 'check-numbers-match-artifact',
    apply: 'build',
    buildStart() {
      const problem = artifactMismatch(readPackedArtifact(ASSETS_JSON), {
        sha256: numbers.artifactSha256,
        bytes: numbers.artifactBytes,
      });
      if (problem) this.error(problem);
    },
  };
}

export default defineConfig({
  plugins: [pages(), svelte(), favicon(), copyHeaders(), checkNumbersMatchArtifact()],
  // No console output in the shipped site: every status the visitor needs is
  // on the page, and the E2E collects console errors as failures.
  esbuild: { drop: ['console', 'debugger'] },
  build: {
    target: 'es2022',
    // The service worker precaches the shell, so Vite's modulepreload links
    // only produce "preloaded but not used" warnings on every warm load.
    modulePreload: false,
    // `rollupOptions.input` comes from the `pages` plugin, which derives it
    // from src/lib/pages.ts — the entry list and the page record cannot
    // disagree because there is only one of them.
  },
  worker: { format: 'es' },
  // dev server must be cross-origin isolated for the threads tier
  server: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
  preview: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
  // Svelte ships both a browser and a server build behind export conditions,
  // and under vitest node's own conditions win — so `mount()` resolves to the
  // server entry and throws `lifecycle_function_unavailable`. The component
  // tests run in jsdom, which IS a browser environment, so say so. Scoped to
  // the vitest run: forcing `browser` on a real node build would be wrong.
  resolve: process.env.VITEST ? { conditions: ['browser'] } : {},
  test: { environment: 'jsdom', include: ['tests/**/*.test.ts'], passWithNoTests: true },
});
