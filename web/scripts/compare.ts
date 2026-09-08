// Side-by-side before/after composites for the visual-polish pass.
//
// Playwright is already a dependency and already knows how to rasterize a
// page, so the "image compositor" is an HTML page with two <img> tags and a
// full-page screenshot of it, with no canvas, no image library and no new
// dependency.
//
//   pnpm exec tsx scripts/compare.ts <beforeDir> <afterDir> <outDir> <name>...
//
// where <name> is a shot's base name, e.g. `index-expanded-desktop`.
import { mkdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { chromium } from 'playwright';

const dataUri = (file: string): string => `data:image/png;base64,${readFileSync(file).toString('base64')}`;

function pageHtml(title: string, before: string, after: string): string {
  return `<!doctype html><meta charset="utf-8"><style>
    :root { color-scheme: dark; }
    body { margin: 0; background: #05070a; color: #e6edf3; font: 14px/1.4 system-ui, sans-serif; }
    h1 { font-size: 15px; font-weight: 600; margin: 0; padding: 14px 18px; color: #8b949e; letter-spacing: .04em; }
    h1 b { color: #e6edf3; font-family: ui-monospace, monospace; font-weight: 600; }
    .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; padding: 0 18px 18px; align-items: start; }
    figure { margin: 0; }
    figcaption { font-size: 12px; letter-spacing: .1em; text-transform: uppercase; padding: 0 0 8px; }
    .b figcaption { color: #d29922; }
    .a figcaption { color: #3fb950; }
    img { display: block; width: 100%; height: auto; border: 1px solid #30363d; border-radius: 8px; }
  </style>
  <h1>nanourl · <b>${title}</b></h1>
  <div class="pair">
    <figure class="b"><figcaption>before</figcaption><img src="${before}" alt="before"></figure>
    <figure class="a"><figcaption>after</figcaption><img src="${after}" alt="after"></figure>
  </div>`;
}

async function main(): Promise<void> {
  const [, , beforeDir, afterDir, outDir, ...names] = process.argv;
  if (!beforeDir || !afterDir || !outDir || names.length === 0) {
    throw new Error('usage: tsx scripts/compare.ts <beforeDir> <afterDir> <outDir> <name>...');
  }
  mkdirSync(resolve(outDir), { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  try {
    for (const name of names) {
      const before = dataUri(resolve(beforeDir, `${name}.png`));
      const after = dataUri(resolve(afterDir, `${name}.png`));
      await page.setContent(pageHtml(name, before, after));
      await page.waitForLoadState('networkidle');
      const file = resolve(outDir, `compare-${basename(name)}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(file);
    }
  } finally {
    await browser.close();
  }
}

void main();
