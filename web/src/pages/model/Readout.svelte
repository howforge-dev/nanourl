<script lang="ts">
  // Prediction readout: the full vocab-sized ranked distribution at the
  // selected token, in a virtualized table. Skips the (expensive,
  // full-softmax) dist RPC entirely while the panel is closed, and re-fetches
  // it whenever the selected token changes while open.

  import type { Codec } from '../../lib/codec/client';
  import type { DistResult, Info } from '../../lib/codec/types';
  import VirtualList from '../../lib/ui/VirtualList.svelte';
  import { LIST_HEIGHT, ROW_HEIGHT } from '../../lib/ui/virtual';
  import { fmtBits, fmtExact, fmtPct } from '../../lib/format';
  import Panel from '../../lib/ui/Panel.svelte';
  import Button from '../../lib/ui/Button.svelte';
  import { createLatest } from '../../lib/latest';

  let {
    info,
    codec,
    url,
    k,
  }: {
    info: Info;
    codec: Codec | null;
    url: string;
    k: number;
  } = $props();

  let panel: ReturnType<typeof Panel> | undefined = $state();
  let open = $state(false);
  let listComp: { scrollTo: (i: number) => void } | undefined = $state();

  let loading = $state(false);
  let result: DistResult | null = $state(null);
  let error = $state('');
  let rows = $derived.by(() => {
    const r = result;
    return r ? r.top : [];
  });
  let entropy = $derived.by(() => {
    let e = 0;
    for (const t of rows) if (t.prob > 0) e -= t.prob * Math.log2(t.prob);
    return e;
  });
  let maxProb = $derived(rows[0] ? rows[0].prob : 1);

  const latest = createLatest();
  $effect(() => {
    const c = codec;
    const u = url;
    const kk = k;
    if (!open || !c || !u.trim()) return;
    const run = latest.begin();
    loading = true;
    error = '';
    c.dist(u, kk)
      .then((r) => {
        if (!run.current) return;
        if (r.ok) {
          result = r;
          error = '';
          listComp?.scrollTo(0);
        } else {
          // a failed dist (e.g. the worker crashed mid-call) must not leave
          // the previous token's table on screen looking like an answer
          result = null;
          error = r.error;
        }
      })
      .catch((e: unknown) => {
        if (!run.current) return;
        result = null;
        error = e instanceof Error ? e.message : String(e);
      })
      .finally(() => {
        if (run.current) loading = false;
      });
  });

  function jumpToActual(): void {
    if (!result) return;
    listComp?.scrollTo(Math.max(0, result.actual.rank - 5));
  }

  export async function focus(): Promise<void> {
    await panel?.focus();
  }
</script>

<Panel bind:this={panel} bind:open title="prediction readout">
  {#snippet sub()}
    the pipeline's product at the selected token: {info.d_model} numbers become one probability for each of
    {fmtExact(info.vocab)} pieces, ranked in full below; the green row is the piece the URL
    actually contains.
  {/snippet}
  {#if open}
    {#if !url.trim()}
      <p class="note">select a token above…</p>
    {:else if error}
      <p class="err" role="alert">{error}</p>
    {:else if loading && !result}
      <p class="note">running the readout…</p>
    {:else if result}
      <div class="h2sub info">
        predicting after <span class="mono">{result.context.slice(-46)}</span><br />
        distribution entropy <b class="txt">{fmtBits(entropy, 2, 'bits')}</b> (the expected cost of whatever comes next) ·
        actual: <b class="ok mono">{result.actual.piece}</b>, rank {result.actual.rank},
        {fmtPct(result.actual.prob, result.actual.bits)}, {fmtBits(result.actual.bits, 2, 'bits')}
      </div>
      <Button size="sm" onclick={jumpToActual}>jump to actual (#{result.actual.rank})</Button>
      <div class="box">
        <VirtualList rows={rows.length} rowHeight={ROW_HEIGHT} height={LIST_HEIGHT} bind:this={listComp}>
          {#snippet row(i)}
            {@const t = rows[i]}
            {#if t}
              {@const hit = i + 1 === result?.actual.rank}
              <div class="rbar" class:hit>
                <span class="rv rank">#{i + 1}</span>
                <span class="rp">{t.piece}</span>
                <div class="rb" style:width="{Math.max(2, (160 * t.prob) / maxProb)}px"></div>
                <span class="rv">{fmtPct(t.prob, t.bits)} · {fmtBits(t.bits)}{hit ? ' ← actual' : ''}</span>
              </div>
            {/if}
          {/snippet}
        </VirtualList>
      </div>
    {/if}
  {/if}
</Panel>

<style>
  .info { margin-top: var(--s-2); margin-bottom: var(--s-2); }
  .rbar { display: flex; align-items: center; gap: var(--s-2); font: var(--fs-xs) var(--font-mono); padding: 0 var(--s-2); height: 100%; }
  .rbar .rank { width: var(--m-rank); text-align: right; }
  .rbar .rp { width: 20ch; white-space: pre; overflow: hidden; text-align: right; flex: none; }
  .rbar .rb { height: var(--s-3); background: var(--acc); border-radius: var(--r-1); opacity: 0.75; flex: none; }
  .rbar.hit { background: var(--ok-tint); }
  .rbar.hit .rb { background: var(--ok); opacity: 1; }
  .rbar .rv { color: var(--dim); }
</style>
