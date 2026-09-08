<script lang="ts">
  // Build/version footer: what model, tokenizer and wasm kernel this page is
  // running, assembled from the asset manifest (names, produced by
  // scripts/pack-assets.ts) and the codec's own self-reported Info.
  //
  // Laid out as a label/value grid rather than three dim sentences: these are
  // facts you scan for one of (which model? which tokenizer? which kernel?),
  // and as running prose they are indistinguishable from the paragraph above
  // them.
  import type { Info } from '../codec/types';
  import { describeKernel } from '../codec/tier';
  import manifest from '../assets.json';
  import { onMount } from 'svelte';
  import { SKIP_WAITING_MESSAGE } from '../sw-messages';
  import { TESTID } from '../testids';
  import { fmtBytes, fmtExact, paramsM } from '../format';
  import Button from './Button.svelte';
  import FactsGrid from './FactsGrid.svelte';

  // wasmName is the asset fetched for this load (manifest.wasm /
  // wasmRelaxed / wasmMt, picked by loader.ts's pickWasm at load time). It
  // falls back to the portable build's name, so a caller that cannot say
  // which tier loaded shows something plausible rather than undefined.
  let {
    info,
    wasmName = manifest.wasm.name,
    version,
    /** Group heading, when this footer is one group among several (the
     *  compressor's advanced panel). The observatory shows it alone. */
    title,
  }: { info: Info; wasmName?: string; version?: number; title?: string } = $props();

  let params = $derived(paramsM(info.params));
  // The three wasm builds nest and the label does not say so: "threads:8" is
  // also relaxed SIMD, which is also SIMD128. Spelled out from the reported
  // string by tier.ts, never from a table typed here.
  let kernel = $derived(describeKernel(info.kernel));

  // src/sw.ts never activates a new build on its own: a newly installed
  // worker sits as `registration.waiting` until this component's "reload"
  // button explicitly asks for it (applyUpdate below), so an update never
  // yanks the page out from under an in-progress encode.
  //
  // `updatefound` and the installing worker's own `statechange` catch the
  // moment a new build reaches `installed` (i.e. is now the waiting worker)
  // and offer the reload; `controllerchange`, fired once applyUpdate's
  // SKIP_WAITING message gets the new worker to activate and claim, performs
  // the reload itself.
  //
  // Via `navigator.serviceWorker.ready`, not `getRegistration()`: `ready`
  // resolves once *a* registration exists whether that happens before or
  // after this component mounts, where `getRegistration()` returns undefined
  // if called too early.
  let updateAvailable = $state(false);
  onMount(() => {
    if (!('serviceWorker' in navigator)) return;
    // Guards against a double reload: `controllerchange` fires on every
    // client claim() affects, so a rapid second event (or another tab's own
    // applyUpdate racing the same registration) must not queue a second
    // reload on top of the first.
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
    void navigator.serviceWorker.ready.then((reg) => {
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) updateAvailable = true;
        });
      });
    });
  });

  // Posts SKIP_WAITING_MESSAGE to the waiting worker (the only thing that
  // ever calls self.skipWaiting(), in src/sw.ts's `message` handler) and lets
  // the controllerchange listener above perform the reload once that worker
  // has taken over. Falls back to a plain reload if there's no waiting worker
  // by the time this runs (e.g. it already activated via every old client
  // naturally dropping off), so the button always does something rather than
  // silently no-op.
  async function applyUpdate(): Promise<void> {
    const reg = await navigator.serviceWorker.getRegistration();
    const waiting = reg?.waiting;
    if (!waiting) {
      location.reload();
      return;
    }
    waiting.postMessage(SKIP_WAITING_MESSAGE);
  }
</script>

<FactsGrid {title}>
  <dt>model</dt>
  <dd>
    <span class="n">sha256 {manifest.model.sha256.slice(0, 16)}</span>
    <span class="dim">— {fmtBytes(manifest.model.bytes)}, {params}M params, {info.n_layer}L×{info.d_model}, int4 g64</span>
  </dd>
  <dt>tokenizer</dt>
  <dd>
    <span class="n">{manifest.tokenizer.name}</span>
    <span class="dim">— {fmtExact(info.vocab)} BPE vocab, structural split, TLD-first hosts</span>
  </dd>
  <dt>kernel</dt>
  <dd>
    <span class="n">{kernel.label}</span>
    {#if kernel.features.length}<span class="dim">— {kernel.features.join(' + ')}</span>{/if}
  </dd>
  <dt>runtime</dt>
  <dd><span class="n">{wasmName}</span> <span class="dim">— wasm32</span></dd>
  {#if version !== undefined}
    <dt>stream version</dt>
    <dd><span class="n">{version}</span></dd>
  {/if}
  {#snippet after()}
    {#if updateAvailable}
      <div class="sw-update" data-testid={TESTID.swUpdateBanner}>
        a new version is ready: <Button variant="ghost" size="sm" tone="accent" onclick={applyUpdate}>reload</Button>
      </div>
    {/if}
  {/snippet}
</FactsGrid>

<style>
  .sw-update { margin-top: var(--s-3); font-size: var(--fs-xs); color: var(--acc); display: flex; align-items: center; gap: var(--s-2); flex-wrap: wrap; }
</style>
