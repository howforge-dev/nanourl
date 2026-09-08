import { cpus } from 'node:os';
import { defineConfig, devices } from 'playwright/test';
import { DEFAULT_PREVIEW_PORT } from './e2e/ports';
import { DESKTOP, MOBILE } from './e2e/viewports';

// The model is ~125 MiB, so every test that waits for "model ready" needs a
// generous timeout — this is a local static server, not a slow network, but
// wasm instantiation + first decode still takes real wall-clock time.
//
// Port: 4173 is `vite preview`'s default, so a sibling worktree's own
// `pnpm preview` (or a stale process from a prior run of this suite) can
// already be squatting on it — a long-running server on the wrong worktree's
// build is a silent, expensive mistake. reuseExistingServer therefore stays
// false unconditionally (never adopt a server this run didn't just start);
// PW_PORT picks a different port when 4173 is unavailable, e.g. from this
// worktree: `PW_PORT=4177 pnpm exec playwright test`.
const PORT = Number(process.env.PW_PORT ?? DEFAULT_PREVIEW_PORT);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  // Playwright's default worker count (host logical CPUs / 2) assumes each
  // test file is cheap to run concurrently with the others. That stops
  // holding once the threads tier is in play: any cross-origin-isolated
  // Chromium context auto-selects it, so nearly every spec's page load spins
  // up to MAX_WORKERS (4) extra compute-worker OS threads of its own, and that
  // cap does not shrink alongside Playwright's worker count. Playwright's own
  // default (half the cores) would oversubscribe a many-core box sharply, and
  // under that contention a single encode call blows past the assertion
  // timeout: not a hang, just starved. So one Playwright worker per four
  // cores, at most four. PW_WORKERS overrides it (CI runs 4 on 16 vCPUs, one
  // project per job).
  workers: Number(process.env.PW_WORKERS ?? Math.max(1, Math.min(4, Math.floor(cpus().length / 4)))),
  timeout: 240_000,
  // A UI assertion that follows an RPC round-trip (e.g. "code changes after
  // an alphabet toggle") clears the default 10s comfortably when a page load
  // means one synchronous, single-thread wasm call — but an isolated
  // Chromium page normally gets the threads tier, so that same round-trip
  // goes through postMessage to a coordinator that dispatches across several
  // compute workers. Plenty fast in isolation, but under the contention of
  // this very suite's own parallel workers (see the `workers` comment above)
  // it can occasionally exceed 10s and fail an otherwise-correct assertion.
  // 20s keeps headroom without materially slowing passing runs (assertions
  // still resolve the moment they're met).
  expect: { timeout: 20_000 },
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    // e2e/serve.ts, NOT `vite preview`. vite preview injects COOP/COEP itself
    // (vite.config.ts's `preview.headers`), so the suite would be blind to
    // the entire response-header surface: a dist/ that shipped no `_headers`
    // at all would still pass every spec with the threads tier active, while
    // the real Cloudflare/Netlify/nginx deploy has no cross-origin isolation
    // and runs ~2.4x slower with nothing surfaced anywhere. serve.ts reads
    // `dist/_headers` — the file the build actually copied — and applies it
    // with the same parser tests/headers.test.ts uses, so the E2E exercises
    // the deploy policy and fails loudly if the build stops shipping it.
    //
    // It binds the port itself and exits nonzero on EADDRINUSE, the same
    // fast, loud failure `--strictPort` buys from vite preview — a silent
    // port bump would no longer match `url` below, surfacing only as
    // "Timed out waiting ... from config.webServer" with no indication why.
    // PW_SKIP_BUILD=1 serves an existing dist/ (CI builds once in its own
    // job and hands the artifact to the test jobs).
    command: `${process.env.PW_SKIP_BUILD ? '' : 'pnpm build && '}pnpm exec tsx e2e/serve.ts --port ${PORT} --dir dist`,
    url: `http://localhost:${PORT}`,
    timeout: 120_000,
    reuseExistingServer: false,
  },
  // Every spec runs under both: a narrow, touch, high-DPR viewport (the
  // shape real phones report) and a plain desktop one. A spec assumes a
  // single fixed viewport otherwise, and toggles explicitly mid-test where
  // the assertion is viewport-dependent (see index.smoke.spec.ts), so it
  // holds under either starting project.
  projects: [
    {
      name: 'mobile',
      use: {
        browserName: 'chromium',
        viewport: { ...MOBILE },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { ...DESKTOP } },
    },
  ],
});
