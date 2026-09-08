import { test, expect } from 'playwright/test';
import { codeTestId } from '../src/lib/testids';
import {
  encodeFirstExample,
  EXAMPLE_NAMES,
  NETWORK_FAILURE,
  openBench,
  readNumber,
  TESTID,
  testIdSelector,
  waitForModelReady,
  watchErrors,
} from './helpers';

// End-to-end acceptance test for the threads tier: against a real
// build+preview (same webServer as index.smoke.spec.ts), so it's the actual
// mt wasm build + shared memory + compute-worker handshake running in a real
// Chromium, not a mock. The preview server sends COOP/COEP (vite.config.ts),
// so the page is cross-origin isolated and `detectTier()` picks the threads
// tier on any multi-core runner — this is the acceptance test for "the
// shared-memory path actually works end to end in Chromium", not just that
// it compiles.

const CODE_PATTERN = /^[A-Za-z0-9_-]+$/;

test('threads tier: status reports threads:N, encode + round-trip still pass', async ({ page }) => {
  const watch = watchErrors(page);

  await page.goto('/');
  await waitForModelReady(page);
  // crossOriginIsolated (preview's COOP/COEP) + Chromium + >1 logical core is
  // exactly the condition detectTier() requires for threads > 0 — a runner
  // that somehow reports 1 core would legitimately fall back to simd/relaxed
  // instead, so this also documents the assumption rather than only testing it.
  const cores = await page.evaluate(() => navigator.hardwareConcurrency);
  expect(cores).toBeGreaterThan(1);
  await expect(page.locator('#status')).toContainText('threads:');

  await encodeFirstExample(page);

  watch.expectClean();
});

test('threads tier: bit-identical to simd on all four example URLs (bench page)', async ({ page, context }) => {
  const watch = watchErrors(page);

  await expect(await openBench(page, 'simd')).toHaveText('simd');
  const simdCodes: Record<string, string> = {};
  for (const name of EXAMPLE_NAMES) {
    simdCodes[name] = (await page.locator(`${testIdSelector(codeTestId(name))} code`).textContent()) ?? '';
    // A real code, not just non-empty: codesFor() now throws (rather than
    // rendering "ERROR: …") on a failed encode, so this page reaching the
    // point of showing anything at all already means it encoded — but this
    // shape check is what stops two identical *failure strings* on both
    // tiers from passing the equality assertion below as if they were a
    // real, matching code (the point of this whole test).
    expect(simdCodes[name], `${name}: simd code doesn't look like a real code`).toMatch(CODE_PATTERN);
  }

  const page2 = await context.newPage();
  watch.also(page2);
  await expect(await openBench(page2, 'threads')).toContainText('threads:');
  for (const name of EXAMPLE_NAMES) {
    const code = await page2.locator(`${testIdSelector(codeTestId(name))} code`).textContent();
    expect(code, `${name}: threads code doesn't look like a real code`).toMatch(CODE_PATTERN);
    expect(code, `${name} code differs between simd and threads`).toBe(simdCodes[name]);
  }
  await page2.close();

  watch.expectClean();
});

test('threads tier failure degrades to a working fallback, never fails the whole app', async ({ page }) => {
  const watch = watchErrors(page);

  // Force the mt wasm asset's own request to fail — pack-assets.ts
  // content-hashes the filename, so match the stable prefix rather than a
  // specific hash. Codec.load's tier fallback (client.ts) must catch this
  // (thrown from inside loadStreaming's download retry loop) and retry on
  // relaxed/simd instead of leaving the page on "failed to load: …" forever.
  await page.route('**/urlcodec-mt.*', (route) => route.abort('failed'));

  const kernel = await (await openBench(page, 'threads', '&w=1')).textContent();
  // never stuck on (or silently reporting) the broken tier, and a real
  // working codec came out the other side — not just "didn't crash"
  expect(kernel).not.toMatch(/^threads:/);
  expect(['simd', 'relaxed']).toContain(kernel);
  await expect(page.locator(testIdSelector(TESTID.msPerToken))).toBeVisible();
  expect(await readNumber(page.locator(testIdSelector(TESTID.msPerToken)))).toBeGreaterThan(0);

  // The aborted request itself is logged by Chromium's own network stack as
  // a console-level "Failed to load resource" line (once per download()
  // retry attempt) — expected noise from deliberately breaking this one
  // request, not an app bug. Everything else — a pageerror (uncaught
  // exception), or any other logged error — must still be absent: the
  // failure was caught and degraded internally, never surfaced as a crash.
  watch.expectClean([NETWORK_FAILURE]);
});

// The test above breaks the mt wasm's own *download*, which fails before
// `worker.ts`'s 'setup' handler ever runs, so no compute worker is ever
// spawned — that leaves the cleanup path for compute workers already
// spawned and spinning when the threads tier gets abandoned with no
// regression test. `?mtfail=handshake` closes that gap: real compute
// workers spawn and (all but one) register for real, and only the
// *handshake* fails.
test('post-spawn compute-worker handshake failure degrades to a working fallback, reports degradedFrom, and leaves no compute worker running', async ({
  page,
}) => {
  const watch = watchErrors(page);

  // Dev/bench-only test hook (client.ts's mtFailHandshakeRequested): the
  // first spawned compute worker sets up its stack correctly (so it really
  // does spin up and start spinning in worker_main) but never posts 'ready'.
  // worker.ts's 'finish' handler waits up to 5s for every spawned worker's
  // ready message before giving up, so this test is a real (if bounded)
  // 5-second wait, not a mock.
  const kernel = await (await openBench(page, 'threads', '&w=3&mtfail=handshake')).textContent();
  // never stuck on (or silently reporting) the broken tier
  expect(kernel).not.toMatch(/^threads:/);
  expect(['simd', 'relaxed']).toContain(kernel);

  // The degrade is reported, not silent (client.ts's `degradedFrom`; see
  // bench/App.svelte).
  await expect(page.locator(testIdSelector(TESTID.degradedFrom))).toContainText('threads');

  // Still a real, working codec: the bench pass actually completed and encoded.
  await expect(page.locator(testIdSelector(TESTID.msPerToken))).toBeVisible();
  expect(await readNumber(page.locator(testIdSelector(TESTID.msPerToken)))).toBeGreaterThan(0);

  // No compute worker survives: the failed threads-tier coordinator is
  // terminated (client.ts's attemptOnce catch), which per the HTML spec's
  // "terminate a worker" algorithm cascades to every compute worker it
  // spawned off shared memory — including the two that had already
  // registered and were spinning in worker_main, not just the one that
  // never sent 'ready'. compute-worker.ts's own build output is named
  // `compute-worker-<hash>.js` (distinct from the coordinator's own
  // `worker-<hash>.js`), so this filter targets exactly the nested workers.
  const computeWorkers = page.workers().filter((w) => w.url().includes('compute-worker'));
  expect(computeWorkers).toEqual([]);

  watch.expectClean([NETWORK_FAILURE]);
});

// The codec POISONS its instance on a tier-3 fault — a compute
// worker lost past the bounded join means a straggler may still be writing
// into the shared memory, so `codec_init` refuses to rebuild over it at any
// width and every entry point answers `{"ok":false,"code":"instance_poisoned"}`
// until the module, the workers and the memory are thrown away together
// (rust/urlcodec/src/threads.rs's header, lib.rs's `with_codec` gate).
//
// The client's obligation is therefore recovery, not retry, and the visitor
// should see a slower answer rather than an error. `?mtfail=poison` makes the
// coordinator hand back that exact reply for the first codec call after the
// load's own self-test (see worker.ts) — the mid-session case. A real fault
// cannot be provoked from JS: it needs a compute worker descheduled past the
// join, and a page cannot stall or terminate a worker it did not spawn.
test('a mid-session thread fault is recovered from: the page reloads without threads and still encodes', async ({
  page,
}) => {
  const watch = watchErrors(page);

  // w=3 rather than the default: a real threads-tier load, small enough to be
  // quick, and the tier the poison actually implicates.
  const kernel = await (await openBench(page, 'threads', '&w=3&mtfail=poison'));
  // The bench page re-reads `info.kernel` after its encode pass precisely
  // because a fault swaps the instance underneath it — so this is the kernel
  // the numbers below were produced on, not the one the load reported.
  await expect(kernel).not.toHaveText(/^threads:/);
  expect(['simd', 'relaxed']).toContain(await kernel.textContent());

  // The fault is surfaced, and worded as a fault rather than as a failed load.
  const degraded = page.locator(testIdSelector(TESTID.degradedFrom));
  await expect(degraded).toContainText('threads');
  await expect(degraded).toContainText('faulted mid-session');

  // And a real, working codec came out the other side: `benchOnce` ran ten
  // encodes (the first of which is the one that hit the poison and was
  // replayed), then `codesFor` encoded all four examples.
  await expect(page.locator(testIdSelector(TESTID.msPerToken))).toBeVisible();
  expect(await readNumber(page.locator(testIdSelector(TESTID.msPerToken)))).toBeGreaterThan(0);
  for (const name of EXAMPLE_NAMES) {
    await expect(page.locator(`${testIdSelector(codeTestId(name))} code`)).toHaveText(CODE_PATTERN);
  }

  // The poisoned instance was genuinely discarded, not merely stopped being
  // used: terminating the coordinator cascades to every compute worker it
  // spawned off the shared memory, which is what releases the memory a
  // straggler may still be writing into. (The bench page terminates its own
  // codec after the pass too, so this holds for the replacement as well.)
  expect(page.workers().filter((w) => w.url().includes('compute-worker'))).toEqual([]);

  // The recovery logs one console.warn (a kernel swapped underneath the page
  // is exactly what a bug report needs to say), not an error — nothing here
  // is an uncaught exception or a console.error.
  watch.expectClean([NETWORK_FAILURE]);
});
