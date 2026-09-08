<script lang="ts">
  // Kernel bench page: loads the codec with a chosen tier — feature-detected
  // as normal, or forced by the controls (and by `?tier=…&w=N`) — and
  // times encoding the nytimes example (see src/lib/examples.ts) 10 times to
  // report median ms/token and ms/URL, plus the live kernel string and a few
  // browser facts relevant to tier selection. "run all tiers" repeats this
  // for all three tiers in turn (terminating each Codec before loading the
  // next) and fills a table — a manual, in-browser companion to the node-side
  // bench harness. Also encodes the four example URLs once per load, exposed via
  // `data-testid="code-<name>"`, so an E2E spec can assert bit-identity
  // across tiers by diffing the codes from two page loads. Deliberately not
  // linked from any other page's subtitle row — this is a dev/bench tool,
  // reached directly at /bench.html.
  import { onMount } from 'svelte';
  import { Codec } from '../../lib/codec/client';
  import { createCodecLoader } from '../../lib/codec/codecState.svelte';
  import { workerCount, kernelShort, describeKernel } from '../../lib/codec/tier';
  import { DEFAULT_ALPHABET } from '../../lib/alphabet';
  import { BENCH_URL, EXAMPLE_URLS } from '../../lib/examples';
  import PageHeader from '../../lib/ui/PageHeader.svelte';
  import Status from '../../lib/ui/Status.svelte';
  import Button from '../../lib/ui/Button.svelte';
  import Card from '../../lib/ui/Card.svelte';
  import FactsGrid from '../../lib/ui/FactsGrid.svelte';
  import Segmented from '../../lib/ui/Segmented.svelte';
  import TextField from '../../lib/ui/TextField.svelte';
  import { codeTestId, rowTestId, TESTID } from '../../lib/testids';

  type TierOverride = { relaxed: boolean; threads: number };
  interface TierSpec {
    label: string;
    tier: TierOverride;
  }
  interface BenchResult {
    msPerToken: number;
    msPerUrl: number;
    tokenCount: number;
  }
  interface TierRow extends BenchResult {
    label: string;
    kernel: string;
  }


  /** Decimals for a bench figure. Three, unlike everywhere else on the site:
   *  this page exists to resolve differences between kernels that are a few
   *  hundred microseconds per token apart. The unit is the column header, so
   *  these are bare numbers rather than `fmtMs` strings — e2e/helpers.ts's
   *  `readNumber` reads them back. */
  const BENCH_DP = 3;

  function median(xs: number[]): number {
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 1;
  // Reuse tier.ts's own formula rather than re-deriving "cores - 1, capped at
  // 8" here, so this page's default cannot drift from production's: a
  // `Math.max(1, …)` here against production's `Math.max(0, …)` would report
  // a "threads:1" row on a single-core browser that production correctly
  // never picks threads on at all. `true` assumes cross-origin isolation,
  // which every environment this page is reachable from (vite dev/preview,
  // `_headers` in prod) already sends.
  const defaultThreads = workerCount(true, cores);

  /** `w` clamped to [1, 16] — wide enough to
   * deliberately explore oversubscription past production's own 8-worker
   * cap (an 11-worker sweep row needed exactly that), narrow enough that a
   * mistyped or hostile query string (`w=400`) can't spawn hundreds of
   * workers and wedge the tab. A non-finite input (`w=abc`, missing `w`)
   * falls back to `defaultThreads` rather than silently landing on simd. */
  function clampWorkers(raw: string | null): number {
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? Math.min(16, Math.max(1, Math.trunc(n))) : defaultThreads;
  }

  /** What the tier control offers. `auto` leaves `detectTier()` in charge,
   *  which is what every other page does. */
  type TierChoice = 'auto' | 'simd' | 'relaxed' | 'threads';
  const TIER_OPTIONS = (['auto', 'simd', 'relaxed', 'threads'] as const).map((t) => ({ value: t, label: t }));
  const isTierChoice = (t: string | null): t is TierChoice =>
    t === 'auto' || t === 'simd' || t === 'relaxed' || t === 'threads';

  const query = new URLSearchParams(location.search);
  const queryTier = query.get('tier');
  /** The controls start where the query string points, so `?tier=…&w=N` is a
   *  deep link into a configuration rather than a separate mechanism. Any
   *  other value (or none) means feature detection, same as every other page. */
  let tierChoice: TierChoice = $state(isTierChoice(queryTier) ? queryTier : 'auto');
  let workers = $state(clampWorkers(query.get('w')));

  /** Clamp the field itself, not just the run. A field showing 400 beside a
   *  measurement taken at 16 is a control that disagrees with its own result. */
  function onWorkersInput(): void {
    workers = clampWorkers(String(workers));
    syncQuery();
  }

  /** What the controls currently ask `Codec.load` for. `undefined` is the
   *  `auto` choice: no override, normal feature detection. */
  function tierOverride(): TierOverride | undefined {
    if (tierChoice === 'auto') return undefined;
    if (tierChoice === 'simd') return { relaxed: false, threads: 0 };
    if (tierChoice === 'relaxed') return { relaxed: true, threads: 0 };
    return { relaxed: false, threads: workers };
  }

  /** The tier the result on screen was actually produced with — not the
   *  current control position, which the visitor may have moved since. */
  let ranTier: string = $state(isTierChoice(queryTier) ? queryTier : 'auto');
  let ranWorkers = $state(clampWorkers(query.get('w')));

  /** The controls ARE the query string: changing one rewrites the address so
   *  a measurement can be shared as a link, and `?tier=…&w=N` keeps working as
   *  a deep link. `replaceState`, not `pushState` — moving a control is not a
   *  place in history to go Back to. Other parameters are preserved, which is
   *  what keeps `?mtfail=…` (e2e/threads.smoke.spec.ts) working beside it. */
  function syncQuery(): void {
    const p = new URLSearchParams(location.search);
    if (tierChoice === 'auto') {
      p.delete('tier');
      p.delete('w');
    } else {
      p.set('tier', tierChoice);
      if (tierChoice === 'threads') p.set('w', String(workers));
      else p.delete('w');
    }
    const q = p.toString();
    history.replaceState(null, '', q ? `${location.pathname}?${q}` : location.pathname);
  }

  // "run all tiers" sweeps the worker count too: on a phone the default W
  // measured slower than single-thread relaxed, so the best W is a
  // per-device question the sweep answers.
  const SWEEP_W = [1, 2, 3, 4, 6, 8].filter((w) => w <= Math.max(1, cores - 1));
  if (defaultThreads > 0 && !SWEEP_W.includes(defaultThreads)) SWEEP_W.push(defaultThreads);
  const ALL_TIERS: TierSpec[] = [
    { label: 'simd', tier: { relaxed: false, threads: 0 } },
    { label: 'relaxed', tier: { relaxed: true, threads: 0 } },
    ...SWEEP_W.map((w) => ({ label: `threads:${w}`, tier: { relaxed: false, threads: w } })),
  ];

  // The load itself is the shared loader's job (state, the fraction-only
  // tick rule, the "failed to load: …" wording) — this page only adds what is
  // genuinely its own: a forced tier, and a lifecycle that terminates the
  // codec the moment the measurement is over.
  let loader = $state(createCodecLoader({ tier: tierOverride() }));
  /** Set by benchOnce/codesFor throwing — a *measurement* failure, distinct
   * from `loader.error`, which is a load failure. */
  let benchError: string | null = $state(null);
  let kernelLabel: string | null = $state(null);
  // Set when Codec.load() degraded past the tier it first attempted (see
  // client.ts's `degradedFrom` doc comment) — names the tier that failed
  // ("threads" or "relaxed"), so a degrade is visible on this diagnostic page
  // too, not just on index/dream/model. Exercised by
  // e2e/threads.smoke.spec.ts's `?mtfail=handshake` test.
  let degradedFrom: string | null = $state(null);
  /** True when `degradedFrom` names a tier that loaded and ran and then
   *  faulted, rather than one that failed to load — the two need different
   *  wording. Exercised by e2e/threads.smoke.spec.ts's `?mtfail=poison` test. */
  let degradedAfterFault = $state(false);
  let bench: BenchResult | null = $state(null);
  let codes: Record<string, string> = $state({});

  /** A single measurement is in flight: the run button is the only way to
   *  start one, and starting a second alongside it would have two codecs (up
   *  to 16 compute workers and two shared heaps) competing for the CPU this
   *  page exists to measure. */
  let running = $state(false);
  let allRunning = $state(false);
  let allError: string | null = $state(null);
  let allRows: TierRow[] = $state([]);
  /** Set only in `onMount`'s `finally`, i.e. after the auto-loaded codec has
   * actually been terminated. Gating "run all tiers" on `!bench` instead is
   * not enough: `bench` is assigned *before* `codesFor()`'s four sequential
   * wasm encodes and well before the `finally` that terminates — each `await`
   * yields, Svelte flushes, and the button is clickable for 1-4 s while a
   * threads-tier codec (up to 8 compute workers, 151 MiB committed / 1 GiB
   * reserved) is still alive. Clicking it then starts a second codec beside
   * the first: ~400 MiB committed and 11 workers at worst, and — worse than
   * the memory — the second shared `WebAssembly.Memory` can fail to allocate
   * and silently degrade the threads row to simd, writing a wrong number into
   * the very table this page exists to produce. */
  let autoLoadDone = $state(false);

  // This page's ready line is its own: it terminates the codec as soon as the
  // measurement is done, so `loader.codec` is null again by then and the
  // shared "model ready — …" line would be wrong.
  let statusText = $derived.by(() =>
    kernelLabel && !loader.error ? `loaded: ${kernelShort(kernelLabel)}` : loader.statusText,
  );
  let statusParts = $derived(kernelLabel || loader.error ? undefined : loader.statusParts);
  let statusFraction = $derived(kernelLabel ? 1 : loader.statusFraction);

  /** Encode BENCH_URL 10x on an already-loaded codec; token count comes
   * from the first (== every) run's token list, since the same URL always
   * tokenizes the same way. */
  async function benchOnce(codec: Codec): Promise<BenchResult> {
    const times: number[] = [];
    let tokenCount = 0;
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      // eslint-disable-next-line no-await-in-loop -- deliberately serial: each encode's wall time is the measurement
      const r = await codec.encode(BENCH_URL, DEFAULT_ALPHABET);
      const dt = performance.now() - t0;
      if (!r.ok) throw new Error(r.error);
      tokenCount = r.tokens.length;
      times.push(dt);
    }
    const msPerUrl = median(times);
    return { msPerUrl, msPerToken: msPerUrl / tokenCount, tokenCount };
  }

  /** Throws on a failed encode rather than folding the error into the
   * displayed string: this is the acceptance test for the threaded build's
   * bit-identity with simd (see threads.smoke.spec.ts), so a build that
   * fails to encode at all must fail loudly here, not render two "ERROR: …"
   * strings that then compare equal to each other. */
  async function codesFor(codec: Codec): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const [name, url] of EXAMPLE_URLS) {
      // eslint-disable-next-line no-await-in-loop -- small, fixed list; sequential is plenty fast and simpler than Promise.all here
      const r = await codec.encode(url, DEFAULT_ALPHABET);
      if (!r.ok) throw new Error(`${name}: ${r.error}`);
      out[name] = r.coded;
    }
    return out;
  }

  /** Load exactly the tier the controls ask for, time it once, show the row
   *  and the kernel string, then terminate the codec. Runs on mount and on
   *  every press of the run button; a fresh loader each time, because a
   *  loader carries the tier it was created with. */
  async function runSelected(): Promise<void> {
    if (running || allRunning) return;
    running = true;
    autoLoadDone = false;
    benchError = null;
    bench = null;
    codes = {};
    kernelLabel = null;
    degradedFrom = null;
    degradedAfterFault = false;
    ranTier = tierChoice;
    ranWorkers = workers;
    loader = createCodecLoader({ tier: tierOverride() });
    const c = await loader.load();
    if (!c) {
      // the load failed; nothing is left running
      running = false;
      autoLoadDone = true;
      return;
    }
    // finally, not a trailing statement: benchOnce/codesFor throwing must
    // not leak this codec's coordinator + up to 16 spinning compute workers
    // + shared memory — the catch below only reports the error.
    try {
      bench = await benchOnce(c);
      // A mid-session tier-3 fault swaps the instance underneath us
      // (client.ts terminates the poisoned one, loads a replacement without
      // threads and replays the failed call on it), so the kernel that
      // produced these numbers may not be the one the load reported. Read
      // after the measurement rather than report the tier that faulted.
      kernelLabel = c.info.kernel;
      degradedFrom = c.degradedFrom;
      degradedAfterFault = c.degradedAfterFault;
      codes = await codesFor(c);
    } catch (e) {
      benchError = e instanceof Error ? e.message : String(e);
    } finally {
      loader.terminate();
      running = false;
      autoLoadDone = true;
    }
  }

  onMount(() => {
    void runSelected();
  });

  async function runAllTiers() {
    allRunning = true;
    allError = null;
    allRows = [];
    for (const spec of ALL_TIERS) {
      let c: Codec | null = null;
      try {
        // eslint-disable-next-line no-await-in-loop -- each tier's own model load must finish (and be timed) before the next tier's load starts
        c = await Codec.load(() => {}, { tier: spec.tier });
        // eslint-disable-next-line no-await-in-loop -- see above
        const b = await benchOnce(c);
        allRows = [...allRows, { label: spec.label, kernel: c.info.kernel, ...b }];
      } catch (e) {
        allError = `${spec.label}: ${e instanceof Error ? e.message : String(e)}`;
        break;
      } finally {
        // free this tier's memory/workers before loading the next, whether
        // the encode above succeeded or threw
        c?.terminate();
      }
    }
    allRunning = false;
  }
</script>

<PageHeader here="bench" />


{#if loader.error}<div class="err" role="alert">{loader.errorText}</div>{/if}
{#if benchError}<div class="err" role="alert">bench failed: {benchError}</div>{/if}

<Card>
  <!-- The tier is chosen here, not typed into the address bar. The address
       bar still carries the choice (syncQuery), so a measurement is a link. -->
  <div class="pick">
    <div class="field">
      <span class="lbl" id="tier-lbl">wasm tier</span>
      <Segmented
        look="switch"
        label="wasm tier"
        options={TIER_OPTIONS}
        value={tierChoice}
        onchange={(t) => {
          tierChoice = t as TierChoice;
          syncQuery();
        }}
      />
    </div>
    {#if tierChoice === 'threads'}
      <div class="field workers">
        <label class="lbl" for="w">workers</label>
        <TextField id="w" type="number" min={1} max={16} bind:value={workers} oninput={onWorkersInput} />
      </div>
    {/if}
    <Button variant="primary" onclick={() => void runSelected()} disabled={running || allRunning}>
      {running ? 'running…' : 'run'}
    </Button>
  </div>
  <p class="caption">
    one load, ten encodes of the same URL, then the codec is terminated. Going past production's 8-worker
    cap is deliberate, because oversubscription is measurable on some devices.
  </p>
</Card>

<Card>
  <div>hardwareConcurrency: <b>{cores}</b></div>
  <div>crossOriginIsolated: <b>{String(globalThis.crossOriginIsolated === true)}</b></div>
  <div class="mono ua">{navigator.userAgent}</div>
</Card>

{#if bench}
  <Card>
    <FactsGrid>
      <dt>requested</dt>
      <dd><b>{ranTier}{ranTier === 'threads' ? `:${ranWorkers}` : ''}</b></dd>
      <dt>build</dt>
      <dd><b data-testid={TESTID.kernel}>{kernelLabel}</b></dd>
      <dt>features</dt>
      <dd class="dim">{describeKernel(kernelLabel ?? '').features.join(' + ') || 'unknown'}</dd>
    </FactsGrid>
    {#if degradedFrom}
      <div class="err" data-testid={TESTID.degradedFrom}>
        degraded from the {degradedFrom} tier ({degradedAfterFault
          ? 'it faulted mid-session and the instance was discarded'
          : 'it failed to load'}), running on {kernelLabel} instead
      </div>
    {/if}
    <div class="dim">{bench.tokenCount} tokens, median of 10 encodes</div>
    <div class="stat" data-testid={TESTID.msPerToken}><b>{bench.msPerToken.toFixed(BENCH_DP)}</b> ms/token</div>
    <div class="stat" data-testid={TESTID.msPerUrl}><b>{bench.msPerUrl.toFixed(BENCH_DP)}</b> ms/url</div>
  </Card>
{/if}

<Card>
  <Button
    variant="primary"
    size="lg"
    testid={TESTID.runAllTiers}
    onclick={runAllTiers}
    disabled={allRunning || running || !autoLoadDone}
  >
    {allRunning ? 'running…' : 'run all tiers and worker counts'}
  </Button>
  {#if allError}<div class="err" role="alert">{allError}</div>{/if}
  {#if allRows.length}
    <table class="benchtable">
      <thead>
        <tr>
          <th>tier</th>
          <th>kernel</th>
          <th>ms/token</th>
          <th>ms/url</th>
        </tr>
      </thead>
      <tbody>
        {#each allRows as row (row.label)}
          <tr data-testid={rowTestId(row.label)}>
            <td>{row.label}</td>
            <td>{row.kernel}</td>
            <td>{row.msPerToken.toFixed(BENCH_DP)}</td>
            <td>{row.msPerUrl.toFixed(BENCH_DP)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</Card>

{#if Object.keys(codes).length}
  <Card testid={TESTID.exampleCodes}>
    {#each Object.entries(codes) as [name, code] (name)}
      <div data-testid={codeTestId(name)}><span class="dim">{name}</span> <code class="mono">{code}</code></div>
    {/each}
  </Card>
{/if}

<Status text={statusText} parts={statusParts} fraction={statusFraction} />

<style>
  /* Colour, family and wrapping come from app.css's `.dim`/`.mono`; the only
     thing this page adds is the smaller type its diagnostic dump wants. */
  .dim,
  .mono { font-size: var(--fs-xs); }
  .ua { color: var(--dim); }
  .pick { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--s-3); }
  .field { display: flex; flex-direction: column; gap: var(--s-1); }
  .lbl { font-size: var(--fs-xs); color: var(--dim); }
  /* Wide enough for two digits and the browser's own spinner, and no wider —
     in a flex row a text field otherwise takes the whole remaining line. */
  .workers { width: 7rem; }
  .benchtable { width: 100%; border-collapse: collapse; margin-top: var(--s-3); font-size: var(--fs-sm); }
  .benchtable th, .benchtable td { text-align: left; padding: var(--s-1) var(--s-3) var(--s-1) 0; border-bottom: var(--border); }
  .benchtable th { color: var(--dim); font-weight: 600; }
</style>
