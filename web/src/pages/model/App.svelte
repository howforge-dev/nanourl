<script lang="ts">
  // Model observatory: owns the codec, the current URL/selection, and wires
  // every panel's cross-links together.
  import { onMount, untrack } from 'svelte';
  import { createCodecLoader } from '../../lib/codec/codecState.svelte';
  import type { TraceResult, EncodeResult } from '../../lib/codec/types';
  import Status from '../../lib/ui/Status.svelte';
  import PageHeader from '../../lib/ui/PageHeader.svelte';
  import Examples from '../../lib/ui/Examples.svelte';
  import CostChips from '../../lib/ui/CostChips.svelte';
  import BuildInfo from '../../lib/ui/BuildInfo.svelte';
  import Card from '../../lib/ui/Card.svelte';
  import TextArea from '../../lib/ui/TextArea.svelte';
  import Tooltip, { type TooltipApi } from './Tooltip.svelte';
  import Arch, { type GotoTarget } from './Arch.svelte';
  import Atlas from './Atlas.svelte';
  import Wpe from './Wpe.svelte';
  import Attention from './Attention.svelte';
  import Residual from './Residual.svelte';
  import Readout from './Readout.svelte';
  import CoderStepper from './CoderStepper.svelte';
  import BitsChars from './BitsChars.svelte';
  import { FLASH_MS } from '../../lib/ui/Panel.svelte';
  import { DEFAULT_ALPHABET } from '../../lib/alphabet';
  import { BENCH_URL, PLACEHOLDER_URL as placeholder } from '../../lib/examples';
  import { debounce, INPUT_DEBOUNCE_MS } from '../../lib/ui/debounce';
  import { createLatest, type Claim } from '../../lib/latest';

  type Focusable = { focus: () => Promise<void> | void };

  const loader = createCodecLoader({
    readyDetail: () => [{ text: 'shipped int4 weights, all local' }],
  });
  let codec = $derived(loader.codec);

  let url = $state(BENCH_URL);
  let busy = $state(false);
  let encError = $state('');
  let lastEnc: EncodeResult | null = $state(null);
  let selK = $state(0);
  let trace: TraceResult | null = $state(null);
  let selLayer = $state(-1);
  let writtenBits = $state(0);

  let tooltip: TooltipApi | undefined = $state();
  let introCardEl: HTMLDivElement | undefined = $state();
  let introFlash = $state(false);
  let atlasRef: Focusable | undefined = $state();
  let wpeRef: Focusable | undefined = $state();
  let attnRef: Focusable | undefined = $state();
  // Residual has no incoming cross-link (architecture has no "residual
  // stream" pipeline row to click — the residual stream is reached by
  // scrolling, not a goto), so it has no
  // `Focusable` ref here; it still exports `focus()` for interface
  // consistency with the other panels, just uncalled.
  let readoutRef: Focusable | undefined = $state();
  let coderRef: Focusable | undefined = $state();
  let bitsRef: Focusable | undefined = $state();

  onMount(() => loader.load());

  // Once the model is ready, run whatever URL is on screen (the nytimes
  // default, or anything typed while waiting).
  $effect(() => {
    if (codec) {
      untrack(() => {
        selK = Infinity;
        void run();
      });
    }
  });

  const latest = createLatest();

  async function run(): Promise<void> {
    if (!codec) return;
    const u = url.trim();
    const run = latest.begin();
    if (!u) {
      busy = false; // clearing the textarea cancels whatever was in flight
      lastEnc = null;
      trace = null;
      encError = '';
      return;
    }
    busy = true;
    // base64url: the observatory explains the shipped default, and its
    // bits->characters panel's six-bit story is base64url-specific.
    const e = await codec.encode(u, DEFAULT_ALPHABET);
    if (!run.current) {
      busy = false; // a newer run superseded this one — don't leave the spinner stuck
      return;
    }
    busy = false;
    if (!e.ok) {
      encError = e.error;
      lastEnc = null;
      trace = null;
      return;
    }
    encError = '';
    lastEnc = e;
    selK = Math.max(0, Math.min(selK, e.tokens.length - 1));
    await traceSel(u, run);
  }

  async function traceSel(u: string, run: Claim): Promise<void> {
    if (!codec) return;
    const t = await codec.trace(u, selK);
    if (!run.current || !t.ok) return;
    trace = t;
  }

  function selectToken(i: number): void {
    if (!lastEnc) return;
    selK = Math.max(0, Math.min(lastEnc.tokens.length - 1, i));
    void traceSel(url.trim(), latest.begin());
  }

  const autoRun = debounce(() => {
    selK = Infinity;
    void run();
  }, INPUT_DEBOUNCE_MS);

  function onPick(u: string): void {
    url = u;
    selK = Infinity;
    void run();
  }

  /** The intro card is not a Panel (it holds the URL input, not a
   *  `<details>`), but it flashes the same way when the architecture table
   *  jumps to it — same animation, same duration. */
  let introFlashTimer: ReturnType<typeof setTimeout> | undefined;
  function flashIntro(): void {
    introFlash = false;
    void introCardEl?.offsetWidth;
    introFlash = true;
    // clearTimeout, like Panel.focus(): without it two fast jumps to this card
    // leave the first timer running, which cuts the second flash short.
    clearTimeout(introFlashTimer);
    introFlashTimer = setTimeout(() => {
      introFlash = false;
    }, FLASH_MS);
  }

  function handleGoto(target: GotoTarget | { layer: number }): void {
    if (typeof target === 'object') {
      selLayer = target.layer;
      if (target.layer >= 0) void attnRef?.focus();
      return;
    }
    switch (target) {
      case 'toks':
        introCardEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        flashIntro();
        break;
      case 'atlas':
        void atlasRef?.focus();
        break;
      case 'wpe':
        void wpeRef?.focus();
        break;
      case 'attn':
        void attnRef?.focus();
        break;
      case 'readout':
        void readoutRef?.focus();
        break;
      case 'coder':
        void coderRef?.focus();
        break;
      case 'bits':
        void bitsRef?.focus();
        break;
    }
  }

  function onSelectLayer(l: number): void {
    selLayer = l;
    if (l >= 0) void attnRef?.focus();
  }
</script>

<PageHeader
  here="model"
/>

<Tooltip bind:this={tooltip} />

{#if codec}
  {@const info = codec.info}
  <Card flash={introFlash} bind:element={introCardEl}>
    <Examples onpick={onPick} />
    <TextArea bind:value={url} rows={2} ariaLabel="URL to run through the model" {placeholder} oninput={autoRun} />
    {#if busy}<div class="busy" role="status" aria-live="polite">running the model…</div>{/if}
    {#if lastEnc}
      <CostChips tokens={lastEnc.tokens} selected={selK} onselect={selectToken} />
    {/if}
    {#if trace}
      <div class="stat">
        the panels below dissect the forward pass that predicts <b class="mono">{trace.pred}</b> from the
        {trace.pieces.length} position{trace.pieces.length > 1 ? 's' : ''} before it
      </div>
    {/if}
    {#if encError}<div class="err" role="alert">{encError}</div>{/if}
  </Card>

  <Arch {info} {selLayer} onGoto={handleGoto} />
  <Atlas {info} tokens={lastEnc?.tokens ?? []} tooltip={tooltip!} bind:this={atlasRef} />
  <Wpe {info} tooltip={tooltip!} bind:this={wpeRef} />
  <Attention {info} {trace} selLayer={selLayer} onSelectLayer={onSelectLayer} tooltip={tooltip!} bind:this={attnRef} />
  <Residual {info} {trace} tooltip={tooltip!} />
  <Readout {info} {codec} url={url.trim()} k={selK} bind:this={readoutRef} />
  <CoderStepper
    {lastEnc}
    k={selK}
    onSelectK={selectToken}
    onProgress={(b) => (writtenBits = b)}
    tooltip={tooltip!}
    bind:this={coderRef}
  />
  <BitsChars {lastEnc} {writtenBits} bind:this={bitsRef} />

  <BuildInfo {info} wasmName={codec.wasmName} />
{/if}

<Status text={loader.statusText} parts={loader.statusParts} fraction={loader.statusFraction} />
