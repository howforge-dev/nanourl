<script lang="ts">
  // Decode pane: accepts a bare code or a full redirect link (parseLink
  // handles both), decodes, and shows the original URL with an "open ↗" link
  // gated on http(s).
  import { untrack } from 'svelte';
  import type { Codec } from '../../lib/codec/client';
  import type { Alphabet, DecodeResult } from '../../lib/codec/types';
  import { parseLink } from '../../lib/alphabet';
  import { isHttp } from '../../lib/url';
  import Button from '../../lib/ui/Button.svelte';
  import CopyButton from '../../lib/ui/CopyButton.svelte';
  import PendingNote from '../../lib/ui/PendingNote.svelte';
  import CostChips from '../../lib/ui/CostChips.svelte';
  import BuildInfo from '../../lib/ui/BuildInfo.svelte';
  import FactsGrid from '../../lib/ui/FactsGrid.svelte';
  import TextField from '../../lib/ui/TextField.svelte';
  import { TESTID } from '../../lib/testids';
  import { fmtBitsPerChar, fmtMs } from '../../lib/format';
  import { debounce, INPUT_DEBOUNCE_MS } from '../../lib/ui/debounce';
  import { createLatest } from '../../lib/latest';

  let { codec, alpha }: { codec: Codec | null; alpha: Alphabet } = $props();

  let code = $state('');
  let busy = $state(false);
  let errorMsg = $state('');
  let hasOutput = $state(false);
  let result: DecodeResult | null = $state(null);
  let ms = $state(0);

  let info = $derived(codec?.info ?? null);

  const latest = createLatest();

  async function runDecode() {
    if (!codec) return;
    const raw = code.trim();
    if (!raw) return;
    const parsed = parseLink(raw);
    if (parsed.error) {
      hasOutput = false;
      result = null;
      errorMsg = parsed.error;
      return;
    }
    const useAlpha = parsed.alpha ?? alpha;
    const run = latest.begin();
    errorMsg = '';
    busy = true;
    const t0 = performance.now();
    const r = await codec.decode(parsed.code, useAlpha);
    const elapsed = Math.round(performance.now() - t0);
    if (!run.current) return; // a newer request superseded this one
    busy = false;
    if (!r.ok) {
      hasOutput = false;
      result = null;
      // The codec reads the stream version from the first bits, so any string
      // that is not a nanourl code fails as "unsupported stream version N":
      // say what a visitor can act on instead.
      errorMsg = /unsupported stream version/.test(r.error)
        ? 'not a nanourl code (or one made by a newer version of this site)'
        : r.error;
      return;
    }
    hasOutput = true;
    result = r;
    ms = elapsed;
  }

  const autoDecode = debounce(() => {
    if (!codec) return;
    if (code.trim()) {
      void runDecode();
    } else {
      // clearing the input cancels any in-flight request and hides output
      latest.cancel();
      busy = false;
      hasOutput = false;
      result = null;
      errorMsg = '';
    }
  }, INPUT_DEBOUNCE_MS);

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') void runDecode();
  }

  // Once the model finishes loading, run whatever was typed while waiting.
  $effect(() => {
    if (codec) untrack(() => { if (code.trim()) void runDecode(); });
  });

  // The alphabet toggle re-runs whatever result is already on screen so the
  // output tracks the toggle.
  $effect(() => {
    void alpha;
    untrack(() => {
      if (codec && hasOutput && code.trim()) void runDecode();
    });
  });
</script>

<TextField
  bind:value={code}
  ariaLabel="compressed code or redirect link"
  placeholder="pDkLHLL — or paste a full redirect link"
  oninput={autoDecode}
  onkeydown={onKeydown}
/>
{#if busy}<div class="busy" role="status" aria-live="polite">decompressing…</div>{/if}
{#if !codec && code.trim()}<PendingNote action="expand" />{/if}
{#if hasOutput && result}
  <div class="row">
    <div class="out well" data-testid={TESTID.decodedUrl} style="flex:1">{result.url}</div>
    <div class="actions">
      <CopyButton text={result.url} />
      {#if isHttp(result.url)}<Button size="sm" href={result.url} target="_blank">open ↗</Button>{/if}
    </div>
  </div>
  <div>
    <span class="stat"><b>{result.coded_chars} → {result.url_chars}</b> chars</span>
    <span class="stat"><b>{fmtBitsPerChar(result.bits_per_char)}</b> bits/char</span>
  </div>
  <details>
    <summary>Advanced — per-token cost and build info</summary>
    <CostChips tokens={result.tokens} />
    <FactsGrid title="Cost">
        <dt>input</dt>
        <dd><span class="n">{result.coded_chars}</span> chars of code</dd>
        <dt>decoded</dt>
        <dd><span class="n">{result.url_chars}</span> chars of URL</dd>
        <dt>bits per char</dt>
        <dd><span class="n">{fmtBitsPerChar(result.bits_per_char)}</span></dd>
        <dt>decode time</dt>
        <dd><span class="n">{fmtMs(ms)}</span></dd>
    </FactsGrid>
    {#if info}<BuildInfo title="Build" {info} wasmName={codec?.wasmName} version={result.version} />{/if}
  </details>
{/if}
{#if errorMsg}<div class="err" role="alert">{errorMsg}</div>{/if}

<style>
  /* Copy and open are the same kind of control at the same size, stacked
     beside the decoded URL so the URL keeps the row's width. `:global` and an
     explicit width because both are components' own elements, and an
     inline-flex button sizes to its label — so without it the two would be
     different widths in a column that stretches everything else. */
  .actions { display: flex; flex-direction: column; gap: var(--s-2); flex: none; }
  .actions :global(.btn) { width: 100%; }
</style>
