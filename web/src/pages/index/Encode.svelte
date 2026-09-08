<script lang="ts">
  // Encode pane: auto-submitting textarea (debounce + Enter), the compressed
  // code with a redirect link, stats, the QR disclosure, and the advanced
  // disclosure (token chips → distribution viewer, round-trip check, build
  // info).
  import { untrack } from 'svelte';
  import type { Codec } from '../../lib/codec/client';
  import type { Alphabet, EncodeResult } from '../../lib/codec/types';
  import { QR_ALPHA, fragmentFor } from '../../lib/alphabet';
  import CopyButton from '../../lib/ui/CopyButton.svelte';
  import PendingNote from '../../lib/ui/PendingNote.svelte';
  import CostChips from '../../lib/ui/CostChips.svelte';
  import Examples from '../../lib/ui/Examples.svelte';
  import BuildInfo from '../../lib/ui/BuildInfo.svelte';
  import FactsGrid from '../../lib/ui/FactsGrid.svelte';
  import TextArea from '../../lib/ui/TextArea.svelte';
  import Dist from './Dist.svelte';
  import Qr from './Qr.svelte';
  import { TESTID } from '../../lib/testids';
  import { costParts, fmtBitsPerChar, fmtMs } from '../../lib/format';
  import { PLACEHOLDER_URL as placeholder } from '../../lib/examples';
  import { debounce, INPUT_DEBOUNCE_MS } from '../../lib/ui/debounce';
  import { createLatest } from '../../lib/latest';

  let { codec, alpha, onalpha }: { codec: Codec | null; alpha: Alphabet; onalpha?: (a: Alphabet) => void } = $props();

  let url = $state('');
  let busy = $state(false);
  let errorMsg = $state('');
  let hasOutput = $state(false);
  let result: EncodeResult | null = $state(null);
  let resultAlpha: Alphabet | null = $state(null);
  // The same URL in qr-alpha, encoded beside a result in another alphabet so
  // the QR section can show what switching would save; '' while unknown.
  let altCode = $state('');
  let ms = $state(0);
  let roundtripTokens = $state(0);
  let roundtripUrl = $state('');
  // 'wait' while the decode-back is in flight: green before it has actually
  // verified anything would be a claim the page cannot yet make.
  let roundtrip: 'wait' | 'ok' | 'fail' = $state('wait');
  // fully determined by `roundtrip`, so derived rather than a fourth piece of
  // state to keep in step with it
  const ROUNDTRIP_TEXT = {
    wait: 'verifying…',
    ok: '✓ byte-identical',
    fail: '✗ FAILED — decode does not match input',
  } as const;
  let roundtripText = $derived(ROUNDTRIP_TEXT[roundtrip]);
  let selectedTok: number | null = $state(null);

  let info = $derived(codec?.info ?? null);
  // Where the URL's bits went, rendered the one way the observatory's coder
  // stepper renders it too (lib/format.ts's costParts).
  let cost = $derived.by(() => (result ? costParts(result.model_bits, result.coded_bits) : null));
  const linkFor = (code: string, a: Alphabet): string => location.origin + location.pathname + '#' + fragmentFor(code, a);
  let redirectLink = $derived.by(() => {
    const r = result;
    if (!r || resultAlpha === null) return '';
    return linkFor(r.coded, resultAlpha);
  });
  let altLink = $derived(altCode && resultAlpha !== null && resultAlpha !== QR_ALPHA ? linkFor(altCode, QR_ALPHA) : '');

  const latest = createLatest();

  async function runEncode() {
    if (!codec) return;
    const u = url.trim();
    if (!u) return;
    const run = latest.begin();
    const myAlpha = alpha;
    errorMsg = '';
    busy = true;
    const t0 = performance.now();
    const r = await codec.encode(u, myAlpha);
    const elapsed = Math.round(performance.now() - t0);
    if (!run.current) return; // a newer request superseded this one
    busy = false;
    if (!r.ok) {
      hasOutput = false;
      result = null;
      errorMsg = r.error;
      return;
    }
    hasOutput = true;
    result = r;
    resultAlpha = myAlpha;
    altCode = '';
    ms = elapsed;
    selectedTok = null;
    roundtripTokens = 0;
    roundtripUrl = '';
    roundtrip = 'wait';
    // decode-back check; byte-identical or a loud failure.
    // Compare against `u`, the string the user actually typed — not against
    // `r.url`, the encoder's own echo of it. Comparing the codec's output to
    // the codec's output cannot detect a codec that echoes something other
    // than its input, which is exactly what "byte-identical" claims

    const d = await codec.decode(r.coded, myAlpha);
    if (!run.current) return;
    if (d.ok && d.url === u) {
      roundtripTokens = d.tokens.length;
      roundtripUrl = d.url;
      roundtrip = 'ok';
    } else {
      roundtripTokens = 0;
      roundtripUrl = d.ok ? d.url : '';
      roundtrip = 'fail';
    }
    if (myAlpha !== QR_ALPHA) {
      const alt = await codec.encode(u, QR_ALPHA);
      if (!run.current) return;
      if (alt.ok) altCode = alt.coded;
    }
  }

  const autoEncode = debounce(() => {
    if (!codec) return;
    if (url.trim()) {
      void runEncode();
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
    if (e.key === 'Enter') {
      e.preventDefault();
      void runEncode();
    }
  }

  function onPick(u: string) {
    url = u;
    void runEncode();
  }

  // Once the model finishes loading, run whatever was typed while waiting.
  $effect(() => {
    if (codec) untrack(() => { if (url.trim()) void runEncode(); });
  });

  // The alphabet toggle re-runs whatever result is already on screen so the
  // output tracks the toggle.
  $effect(() => {
    void alpha;
    untrack(() => {
      if (codec && hasOutput && url.trim()) void runEncode();
    });
  });
</script>

<Examples onpick={onPick} />
<!-- ariaLabel, not placeholder-as-label: a placeholder is not an accessible
     name and it vanishes the moment anything is typed. Same for every other
     control on this page. -->
<TextArea bind:value={url} rows={2} ariaLabel="URL to compress" {placeholder} oninput={autoEncode} onkeydown={onKeydown} />
{#if busy}<div class="busy" role="status" aria-live="polite">compressing…</div>{/if}
{#if !codec && url.trim()}<PendingNote action="shorten" />{/if}
{#if hasOutput && result}
  <div class="row">
    <!-- shown without the scheme; the copy button still copies the full URL -->
    <div class="out well" data-testid={TESTID.redirectLink} style="flex:1">{redirectLink.replace(/^https?:\/\//, '')}</div>
    <CopyButton text={redirectLink} />
  </div>
  <div>
    <span class="stat"><b>{result.url_chars} → {result.coded_chars}</b> chars</span>
    <span class="stat"><b>{(1 / result.ratio).toFixed(2)}×</b> smaller</span>
    <span class="stat"><b>{fmtBitsPerChar(result.bits_per_char)}</b> bits/char</span>
    <span class="stat"><b>{result.coded_bits}</b> coded bits</span>
  </div>
  {#if resultAlpha !== null}
    <Qr link={redirectLink} {altLink} code={result.coded} alpha={resultAlpha} onalpha={(a) => onalpha?.(a)} />
  {/if}
  <details data-testid={TESTID.advanced}>
    <summary>Advanced — per-token cost and build info</summary>
    <p class="caption">click a token to see the model's predictions at that position</p>
    <CostChips tokens={result.tokens} selected={selectedTok ?? undefined} onselect={(i) => (selectedTok = i)} />
    {#if selectedTok !== null && codec}
      <Dist {codec} url={result.url} k={selectedTok} />
    {/if}

    <FactsGrid title="Cost">
        <dt>model</dt>
        <dd><span class="n">{cost?.model}</span> bits <span class="dim">— what the predictions actually cost</span></dd>
        <dt>coder overhead</dt>
        <dd><span class="n">{cost?.overhead}</span> bits <span class="dim">— fixed-grid rounding and bookkeeping</span></dd>
        <dt>total coded</dt>
        <dd><span class="n">{result.coded_bits}</span> bits <span class="dim">→</span> <span class="n">{result.coded_chars}</span> chars</dd>
        <dt>input</dt>
        <dd><span class="n">{result.url_chars}</span> chars <span class="dim">— hosts shown TLD-first, the model's canonical form</span></dd>
        <dt>bits per char</dt>
        <dd><span class="n">{fmtBitsPerChar(result.bits_per_char)}</span></dd>
        <dt>encode time</dt>
        <dd><span class="n">{fmtMs(ms)}</span></dd>
    </FactsGrid>

    <FactsGrid title="Round trip">
        <dt>status</dt>
        <!-- the losslessness verdict is the most important thing this pane
             says; it must be announced, not only coloured. -->
        <dd
          data-testid={TESTID.roundtrip}
          role="status"
          aria-live="polite"
          class={roundtrip === 'ok' ? 'ok' : roundtrip === 'fail' ? 'bad' : ''}
        >
          <span>{roundtripText}</span>{#if roundtripTokens}<span class="dim"
              >&nbsp;— decoded <span class="n">{roundtripTokens}</span> tokens</span
            >{/if}
        </dd>
        {#if roundtripUrl}
          <dt>decoded</dt>
          <dd class="n wrap">{roundtripUrl}</dd>
        {/if}
    </FactsGrid>

    {#if info}<BuildInfo title="Build" {info} wasmName={codec?.wasmName} version={result.version} />{/if}
  </details>
{/if}
{#if errorMsg}<div class="err" role="alert">{errorMsg}</div>{/if}

<style>
  /* The decoded URL is one unbreakable run with no space in it; without this
     it overflows the grid's value column instead of wrapping. */
  .wrap { overflow-wrap: anywhere; }
</style>
