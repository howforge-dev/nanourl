// Screenshot harness: what the pages look like. Serves `web/dist` with
// e2e/serve.ts (the same server, and the same dist/_headers policy, the
// Playwright suite runs against) and drives it, writing one full-page PNG per
// (page, state, viewport) triple into an output directory, so a before/after
// pair can be compared shot for shot.
//
//   pnpm build
//   pnpm exec tsx scripts/shots.ts ../shots/before --port 4398
//
// Deliberately NOT a Playwright spec: these aren't assertions, and running
// them under `playwright test` would tie the shot list to the e2e projects'
// viewports and to `webServer` rebuilding on every invocation. It is also
// deliberately in-process: an externally-launched preview process risks
// being reaped mid-run, which would silently truncate the shot matrix.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import { startServer } from '../e2e/serve';
import { BENCH_URL } from '../src/lib/examples';
// The same registry the app and the E2E specs use: a renamed testid is a
// TypeScript error here too, rather than a screenshot matrix of the wrong
// states.
import { TESTID, testIdSelector } from '../src/lib/testids';

// The same URL the bench page times and the observatory prefills.
const NYT = BENCH_URL;

interface Viewport {
  name: string;
  width: number;
  height: number;
  mobile: boolean;
}

const VIEWPORTS: Viewport[] = [
  { name: 'desktop', width: 1280, height: 800, mobile: false },
  { name: 'mobile', width: 375, height: 667, mobile: true },
];

/** One named still: navigate/drive the page, then the harness shoots it. */
interface Shot {
  name: string;
  run: (page: Page, out: (name: string) => Promise<void>, outDir: string, vpName: string) => Promise<void>;
}

const settle = (page: Page, ms = 400) => page.waitForTimeout(ms);

async function modelReady(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('model ready') === true, undefined, {
    timeout: 240_000,
  });
}

/** Open (or close) every <details> on the page, matching the browser's own
 * toggle semantics closely enough for a screenshot (no `toggle` listeners on
 * these pages depend on a trusted click). */
const setDetails = (page: Page, open: boolean) =>
  page.$$eval('details', (els, o) => els.forEach((d) => ((d as HTMLDetailsElement).open = o)), open);

async function encodeSomething(page: Page): Promise<void> {
  await modelReady(page);
  await page.locator('textarea').fill(NYT);
  await page.locator(testIdSelector(TESTID.redirectLink)).waitFor({ timeout: 120_000 });
  await page.locator(testIdSelector(TESTID.roundtrip)).waitFor({ state: 'attached', timeout: 120_000 });
  await settle(page, 800);
}

const SHOTS: Shot[] = [
  {
    name: 'index',
    run: async (page, out) => {
      await page.goto('/');
      await encodeSomething(page);
      await setDetails(page, false);
      await settle(page);
      await out('index-collapsed');
      await setDetails(page, true);
      await settle(page, 600);
      await out('index-expanded');
      // a selected token brings the distribution viewer into the section
      await page.locator('.toks .tok').nth(3).click();
      await settle(page, 1200);
      await out('index-dist');
    },
  },
  {
    name: 'index-decode',
    run: async (page, out) => {
      await page.goto('/');
      // Encode first and reuse the real code: a hand-typed one is only valid
      // for the model/alphabet it was produced under.
      await encodeSomething(page);
      // The decode pane accepts a full redirect link, so hand it the link the
      // encode pane just produced rather than re-deriving a bare code.
      const link = (await page.locator(testIdSelector(TESTID.redirectLink)).textContent()) ?? '';
      await page.locator('.tabs button', { hasText: 'Decode' }).click();
      await page.locator(`${testIdSelector(TESTID.paneDecode)} input[type=text]`).fill(link.trim());
      await page.locator(testIdSelector(TESTID.decodedUrl)).waitFor({ timeout: 120_000 });
      await setDetails(page, true);
      await settle(page, 600);
      await out('index-decode-expanded');
    },
  },
  {
    name: 'loading',
    run: async (page, out) => {
      // Throttle the model chunks so the loading line is on screen.
      await page.route('**/model.*.bin', async (route) => {
        await new Promise((r) => setTimeout(r, 2500));
        await route.continue();
      });
      const nav = page.goto('/');
      await page.waitForFunction(() => (document.querySelector('#status')?.textContent ?? '').length > 0, undefined, {
        timeout: 60_000,
      });
      await page.waitForTimeout(3000);
      await out('loading-network');
      await nav;
      await modelReady(page);
      await settle(page, 400);
      await out('loaded-network');
      // second visit: every asset is in the Cache API now
      await page.unroute('**/model.*.bin');
      await page.goto('/');
      await page.waitForTimeout(150);
      await out('loading-cache');
      await modelReady(page);
      await settle(page, 400);
      await out('loaded-cache');
    },
  },
  {
    // The redirect overlay: encode something, then open its own link so the
    // overlay is the page. There is no `?stop`: the countdown runs, so the
    // shot has to happen inside the two seconds before it fires.
    name: 'redirect',
    run: async (page, out) => {
      await page.goto('/');
      await encodeSomething(page);
      const link = (await page.locator(testIdSelector(TESTID.redirectLink)).textContent()) ?? '';
      const frag = link.slice(link.indexOf('#'));
      await page.route('**/model.*.bin', async (route) => {
        await new Promise((r) => setTimeout(r, 4000));
        await route.continue();
      });
      void page.goto('/' + frag).catch(() => {});
      await page.locator(testIdSelector(TESTID.redirectOverlay)).waitFor({ timeout: 60_000 });
      await settle(page, 2500);
      await out('redirect-loading');
    },
  },
  {
    // Just the header band of every page, both widths, the one piece of
    // chrome all five share.
    name: 'headers',
    run: async (page, out) => {
      for (const [path, name] of [
        ['/', 'index'],
        ['/model.html', 'model'],
        ['/learn.html', 'learn'],
        ['/dream.html', 'dream'],
        ['/bench.html?tier=simd', 'bench'],
      ] as [string, string][]) {
        await page.goto(path);
        await settle(page, 900);
        await out(`header-${name}`);
      }
    },
  },
  {
    name: 'model',
    run: async (page, out) => {
      await page.goto('/model.html');
      await modelReady(page);
      await settle(page, 3000);
      // as it loads: only `architecture` is open, the other seven panels are
      // lazy and start closed
      await out('model-default');
      await setDetails(page, false);
      await settle(page, 600);
      await out('model-collapsed');
      await setDetails(page, true);
      await settle(page, 4000);
      await out('model-expanded');
    },
  },
  {
    name: 'learn',
    run: async (page, out) => {
      await page.goto('/learn.html');
      await settle(page, 800);
      await setDetails(page, false);
      await out('learn-collapsed');
      await setDetails(page, true);
      await settle(page, 600);
      await out('learn-expanded');
    },
  },
  {
    // The learn page is ~15,000 px tall, so a full-page PNG is unreadable at
    // any sane zoom. These are viewport slices around the three key figures,
    // plus the head of the page.
    name: 'learn-slices',
    run: async (page, out, outDir, vpName) => {
      await page.goto('/learn.html');
      await settle(page, 800);
      for (const [id, label] of [
        ['', 'top'],
        ['bits', 's2-bits'],
        ['whynotzip', 's3-whynotzip'],
        ['transformer', 's6-transformer'],
        ['coder', 's7-coder'],
        ['small', 's10-small'],
      ] as [string, string][]) {
        if (id) {
          await page.evaluate((i) => document.getElementById(i)?.scrollIntoView({ block: 'start' }), id);
          await page.evaluate(() => scrollBy(0, -12));
        } else {
          await page.evaluate(() => scrollTo(0, 0));
        }
        await settle(page, 350);
        await out(`learn-${label}`);
        // one more screen of the same section, so a tall figure is not cut
        await page.evaluate(() => scrollBy(0, innerHeight - 40));
        await settle(page, 300);
        await out(`learn-${label}-b`);
      }
      // Every boxed figure on its own, cropped to the element: the only way
      // to judge a diagram on a 15,000-px page.
      const figs = page.locator('.fig');
      const n = await figs.count();
      for (let i = 0; i < n; i++) {
        const fig = figs.nth(i);
        await fig.scrollIntoViewIfNeeded();
        await settle(page, 200);
        await fig.screenshot({ path: resolve(outDir, `learn-fig${String(i).padStart(2, '0')}-${vpName}.png`) });
      }
      console.log(`  ${n} figures`);
    },
  },
  {
    name: 'dream',
    run: async (page, out) => {
      await page.goto('/dream.html');
      await modelReady(page);
      await page.locator('#count').fill('5');
      await page.getByRole('button', { name: 'Dream', exact: true }).click();
      await page.locator(testIdSelector(TESTID.dreamUrl)).first().waitFor({ timeout: 120_000 });
      await settle(page, 1500);
      await out('dream');
    },
  },
  {
    name: 'bench',
    run: async (page, out) => {
      await page.goto('/bench.html?tier=simd');
      await page.locator(testIdSelector(TESTID.exampleCodes)).waitFor({ timeout: 240_000 });
      await settle(page, 600);
      await out('bench');
    },
  },
];

async function main(): Promise<void> {
  const [, , outArg, ...rest] = process.argv;
  if (!outArg) throw new Error('usage: tsx scripts/shots.ts <outDir> [--port N] [--only name,name]');
  const portIdx = rest.indexOf('--port');
  const port = portIdx >= 0 ? Number(rest[portIdx + 1]) : 4398;
  const onlyIdx = rest.indexOf('--only');
  const only = onlyIdx >= 0 ? new Set(rest[onlyIdx + 1].split(',')) : null;
  const outDir = resolve(outArg);
  mkdirSync(outDir, { recursive: true });
  // e2e/serve.ts, the same server the suite runs against: it applies the
  // real dist/_headers policy, so a shot is taken under the same
  // cross-origin isolation (and therefore the same kernel tier) the E2E
  // suite asserts, rather than under a weaker server of the harness's own.
  const server = await startServer(port);

  for (const vp of VIEWPORTS) {
    for (const shot of SHOTS) {
      if (only && !only.has(shot.name)) continue;
      // One browser per shot: each page holds the ~125 MiB model plus a
      // shared-memory wasm heap and up to 8 compute-worker threads, and
      // reusing one browser across the whole matrix reliably kills it.
      const browser: Browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
      try {
        const ctx = await browser.newContext({
          baseURL: `http://localhost:${port}`,
          viewport: { width: vp.width, height: vp.height },
          deviceScaleFactor: vp.mobile ? 2 : 1,
          isMobile: vp.mobile,
          hasTouch: vp.mobile,
          // CSS animations (the busy dot, card flash) would otherwise make
          // every shot differ from the last for no reason.
          reducedMotion: 'reduce',
        });
        const page = await ctx.newPage();
        page.on('pageerror', (e) => console.error(`  ! pageerror on ${shot.name}/${vp.name}: ${e.message}`));
        const out = async (name: string) => {
          const file = resolve(outDir, `${name}-${vp.name}.png`);
          // `-s2-`/`-top`-style slice names are viewport shots by design
          const viewportOnly = name.startsWith('learn-s') || name.startsWith('learn-top') || name.startsWith('header-');
          await page.screenshot({
            path: file,
            fullPage: !viewportOnly,
            ...(name.startsWith('header-') ? { clip: { x: 0, y: 0, width: vp.width, height: vp.mobile ? 260 : 200 } } : {}),
          });
          console.log(`  ${file}`);
        };
        console.log(`[${vp.name}] ${shot.name}`);
        await shot.run(page, out, outDir, vp.name);
      } catch (e) {
        console.error(`  ! failed ${shot.name}/${vp.name}: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        await browser.close();
      }
    }
  }
  server.close();
}

void main();
