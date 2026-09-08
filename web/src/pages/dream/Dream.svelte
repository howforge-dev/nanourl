<script lang="ts">
  // Dream controls + results. The per-URL seed is a plain `seed + i`: this
  // client awaits one sample at a time, so it needs no order-independent
  // mixing (a Weyl constant XORed in) to give every row a distinct,
  // reproducible seed.
  //
  // The prefix is typed in the model's own canonical form (hosts TLD-first —
  // it's the space `codec.sample` conditions on directly, uncanonicalised).
  // `result.url` is de-canonicalised back to original form, so what's shown
  // here never needs reordering, but the note under the input says so since
  // it's surprising the first time.
  import type { Codec } from '../../lib/codec/client';
  import type { SampleResult } from '../../lib/codec/types';
  import { isHttp } from '../../lib/url';
  import CopyButton from '../../lib/ui/CopyButton.svelte';
  import Button from '../../lib/ui/Button.svelte';
  import Chip from '../../lib/ui/Chip.svelte';
  import TextField from '../../lib/ui/TextField.svelte';
  import { TESTID } from '../../lib/testids';
  import { createLatest } from '../../lib/latest';

  let { codec }: { codec: Codec | null } = $props();

  let prefix = $state('');
  let count = $state(10);
  let temp = $state(1.0);
  let topK = $state(0);
  let seed = $state(1);

  let running = $state(false);
  let current = $state(0); // 1-based index of the in-flight sample call, 0 when idle
  let activeN = $state(0); // clamped count for the run in progress, so the "i / n" status is stable
  let results: SampleResult[] = $state([]);
  let errorMsg = $state('');

  function clampInt(v: number, lo: number, hi: number, dflt: number): number {
    return Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : dflt;
  }
  function clampNum(v: number, lo: number, hi: number, dflt: number): number {
    return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt;
  }

  // Cancellation: Stop supersedes the current claim, so the loop below (and
  // any in-flight call it's awaiting) notices on its next check and drops out
  // without pushing a stale result — at most the one call already in flight
  // still completes.
  const latest = createLatest();

  async function runDream() {
    if (!codec || running) return;
    const run = latest.begin();
    const n = clampInt(count, 1, 200, 10);
    const t = clampNum(temp, 0, 2, 1.0);
    const tk = clampInt(topK, 0, Number.MAX_SAFE_INTEGER, 0);
    const sd = clampInt(seed, 0, Number.MAX_SAFE_INTEGER, 1);
    const pfx = prefix;
    running = true;
    activeN = n;
    results = [];
    errorMsg = '';
    for (let i = 0; i < n && run.current; i++) {
      current = i + 1;
      const r = await codec.sample(sd + i, t, tk, 96, pfx);
      if (!run.current) return; // a newer run (or Stop) superseded this one
      if (!r.ok) {
        errorMsg = r.error;
        break;
      }
      results = [...results, r];
    }
    if (run.current) {
      running = false;
      current = 0;
    }
  }

  function stop() {
    latest.cancel();
    running = false;
    current = 0;
  }

  function randomizeSeed() {
    seed = Math.floor(Math.random() * 1_000_000_000);
  }

  function onPrefixKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void runDream();
    }
  }
</script>

<label for="prefix">start with (optional)</label>
<TextField
  id="prefix"
  bind:value={prefix}
  placeholder="https://com.example.www/"
  autocapitalize="off"
  autocorrect="off"
  onkeydown={onPrefixKeydown}
/>
<p class="caption">type the prefix in the model's canonical form, hosts TLD-first (e.g. https://com.example.www/); results are shown un-reordered</p>

<div class="grid">
  <div>
    <label for="count">how many</label>
    <TextField id="count" type="number" min={1} max={200} bind:value={count} />
  </div>
  <div>
    <label for="temp">temperature</label>
    <TextField id="temp" type="number" min={0} max={2} step={0.05} bind:value={temp} />
  </div>
  <div>
    <label for="topk">top-k (0=off)</label>
    <TextField id="topk" type="number" min={0} bind:value={topK} />
  </div>
  <div>
    <label for="seed">seed</label>
    <div class="seedrow">
      <TextField id="seed" type="number" min={0} bind:value={seed} />
      <Button size="sm" onclick={randomizeSeed}>random</Button>
    </div>
  </div>
</div>

<div class="row">
  <Button variant="primary" size="lg" disabled={!codec || running} onclick={() => void runDream()}>Dream</Button>
  {#if running}<Button onclick={stop}>Stop</Button>{/if}
</div>
{#if running}<div class="busy">dreaming {current} / {activeN}…</div>{/if}
{#if errorMsg}<div class="err" role="alert">{errorMsg}</div>{/if}
<div class="caption">
  temperature 0 is greedy: the single most likely URL the model can imagine (the same one every
  time). 1.0 samples the true distribution. Above ~1.2 it falls apart.
</div>

{#if results.length}
  <div class="out-list" data-testid={TESTID.dreamResults}>
    {#each results as r, i (i)}
      <Chip class="u {r.terminated ? '' : 'trunc'}" block mono>
        <div class="n">{i + 1}.</div>
        <div class="body">
          <div class="t" data-testid={TESTID.dreamUrl}>{r.url}</div>
          <div class="meta">{r.pieces.length} tokens · {r.terminated ? 'terminated' : 'did not terminate (hit max tokens)'}</div>
        </div>
        <div class="actions">
          <CopyButton text={r.url} />
          {#if isHttp(r.url)}<Button size="sm" href={r.url} target="_blank">open ↗</Button>{/if}
        </div>
      </Chip>
    {/each}
  </div>
{/if}

<style>
  label { display: block; font-size: var(--fs-xs); color: var(--dim); margin-bottom: var(--s-1); }

  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--s-3); margin-top: var(--s-3); }
  .seedrow { display: flex; gap: var(--s-2); align-items: stretch; }
  /* `:global`, because both children are components' own elements. The field
     takes the row and the button keeps its own width. */
  .seedrow :global(.field) { flex: 1; min-width: 0; }
  .seedrow :global(.btn) { flex: none; }

  .out-list { margin-top: var(--s-4); }
  /* Each result is a Chip: the surface, the hairline and the leading are the
     primitive's. This is the row's own layout — a number, the URL and its
     actions — and the wider padding a line of URL needs over a label.
     `:global` where the subject is the chip element itself. */
  .out-list :global(.u) {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
    align-items: flex-start;
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-4);
    margin-bottom: var(--s-2);
    font-size: var(--fs-sm);
    line-height: 1.45;
  }
  .out-list .n { color: var(--dim); flex: none; min-width: 2.2em; text-align: right; }
  .out-list .body { flex: 1 1 var(--m-side); min-width: 0; }
  .out-list .t { word-break: break-all; }
  .out-list .meta { color: var(--dim); font-size: var(--fs-2xs); margin-top: 1px; /* hairline */ }
  .out-list :global(.u.trunc .meta) { color: var(--warn); }
  .out-list .actions { display: flex; gap: var(--s-2); align-items: center; flex: none; }

  @media (max-width: 560px) {
    .grid { grid-template-columns: repeat(2, 1fr); }
  }
</style>
