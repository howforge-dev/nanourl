<script lang="ts">
  // Per-token distribution viewer: a virtual table over the FULL vocab
  // distribution at one token position, with a jump-to-chosen-row header and
  // a substring filter.
  import { tick } from 'svelte';
  import type { Codec } from '../../lib/codec/client';
  import type { DistRow } from '../../lib/codec/types';
  import VirtualList from '../../lib/ui/VirtualList.svelte';
  import Chip from '../../lib/ui/Chip.svelte';
  import TextField from '../../lib/ui/TextField.svelte';
  import { LIST_HEIGHT, ROW_HEIGHT } from '../../lib/ui/virtual';
  import { fmtBits, fmtExact, fmtPct } from '../../lib/format';
  import { createLatest } from '../../lib/latest';

  let { codec, url, k }: { codec: Codec | null; url: string; k: number } = $props();


  let context = $state('computing…');
  let rows: DistRow[] = $state([]);
  let actualRank = $state(0);
  let actualPiece = $state('');
  let actualProb = $state(0);
  let actualBits = $state(0);
  let maxProb = $state(1);
  let loaded = $state(false);
  let filterText = $state('');
  let flash = $state(false);
  let listComp: { scrollTo: (i: number) => void } | undefined = $state();

  // lowercased once per distribution; the filter re-scans on every keystroke
  let lc = $derived(rows.map((r) => r.piece.toLowerCase()));
  // null view means "every row"; a filtered view maps display position -> rank-1 index
  let view = $derived.by(() => {
    const q = filterText.toLowerCase();
    if (!q) return null;
    const v: number[] = [];
    for (let i = 0; i < lc.length; i++) if (lc[i].includes(q)) v.push(i);
    return v;
  });
  let visibleCount = $derived(view ? view.length : rows.length);

  const latest = createLatest();
  $effect(() => {
    const c = codec,
      u = url,
      kk = k; // dependencies: re-fetch whenever the codec, url or token index changes
    if (!c) return;
    const run = latest.begin();
    loaded = false;
    context = 'computing…';
    c.dist(u, kk).then((r) => {
      if (!run.current) return;
      if (!r.ok) {
        context = r.error;
        return;
      }
      context = r.context || '<eos>';
      rows = r.top;
      actualRank = r.actual.rank;
      actualPiece = r.actual.piece;
      actualProb = r.actual.prob;
      actualBits = r.actual.bits;
      maxProb = r.top[0] ? r.top[0].prob : 1;
      loaded = true;
      // the filter box survives clicking a different token; its view was
      // just recomputed above via the $derived reads, so just reset scroll
      listComp?.scrollTo(0);
    });
  });

  function onFilterInput(e: Event) {
    filterText = (e.currentTarget as HTMLInputElement).value;
    listComp?.scrollTo(0);
  }

  // Narrow the table to tokens containing the query. Ranks stay the rank in
  // the FULL distribution: a filtered row still says where the model put it,
  // and because rows stay probability-ordered the first match IS the best
  // match.
  async function jumpChosen() {
    let pos = view ? view.indexOf(actualRank - 1) : actualRank - 1;
    if (pos < 0) {
      // The filter hides the chosen token; drop it rather than scroll
      // nowhere. Clearing filterText updates `view`/`visibleCount` (and thus
      // the `rows` count we pass to VirtualList) immediately as reactive
      // values, but VirtualList's own rendered .vspacer height (which is
      // what actually bounds how far el.scrollTop can go) only catches up
      // once Svelte flushes that prop change to the DOM. Calling scrollTo
      // before that flush scrolls against the STALE (filtered, much
      // shorter) scrollable height and silently clamps back near 0. Wait
      // for the flush first.
      filterText = '';
      pos = actualRank - 1;
      await tick();
    }
    // instant rather than smooth: smooth-scrolling a virtual table hundreds
    // of thousands of pixels tall crawls
    listComp?.scrollTo(Math.max(0, pos - 5));
    flash = true;
    setTimeout(() => {
      flash = false;
    }, 1000);
  }
</script>

<div class="distE">
  <div class="disthead">
    <span class="ctx">{context}</span>
    → <Chip class="next" mono title="jump to this row" onclick={jumpChosen}>
      <span class="piece">{actualPiece}</span><b>#{actualRank}</b>
      <span class="dim">{fmtPct(actualProb, actualBits)} · {fmtBits(actualBits)}</span>
    </Chip>
  </div>
  <div class="row" style="margin-top:var(--s-2)">
    <TextField
      type="search"
      value={filterText}
      oninput={onFilterInput}
      autocomplete="off"
      ariaLabel="filter the token distribution"
      placeholder="filter tokens, e.g. .com"
      style="flex:1;min-width:var(--m-filter)"
    />
    <span class="count">{filterText ? `${fmtExact(visibleCount)} of ${fmtExact(rows.length)} tokens` : ''}</span>
  </div>
  <div class="box">
    {#if !loaded}
      <div class="empty">computing…</div>
    {:else if visibleCount === 0}
      <div class="empty">no token contains that</div>
    {:else}
      <VirtualList rows={visibleCount} rowHeight={ROW_HEIGHT} height={LIST_HEIGHT} bind:this={listComp}>
        {#snippet row(pos)}
          {@const i = view ? view[pos] : pos}
          {@const t = rows[i]}
          <div class="drow" class:hit={i + 1 === actualRank} class:flash={flash && i + 1 === actualRank}>
            <span class="dv rank">#{i + 1}</span>
            <span class="dp">{t.piece}</span>
            <div class="db" style:width="{Math.max(2, (160 * t.prob) / maxProb)}px"></div>
            <span class="dv">{fmtPct(t.prob, t.bits)} · {fmtBits(t.bits)}{i + 1 === actualRank ? ' ← chosen' : ''}</span>
          </div>
        {/snippet}
      </VirtualList>
    {/if}
  </div>
</div>

<style>
  .distE { margin-top: var(--s-3); }
  .disthead { font-size: var(--fs-sm); color: var(--dim); }
  /* `<eos>` plus the decoded URL prefix: a long, space-free string with no
     natural break opportunity. Without `overflow-wrap: anywhere` it is one
     unbreakable ~40-character word that overflows a 321px card content box at
     375px. */
  .ctx { font-family: var(--font-mono); color: var(--txt); overflow-wrap: anywhere; }
  /* The chosen token is a Chip; all this adds is that it is the CHOSEN one:
     the same green the distribution table marks the chosen row with. `:global`
     because the element is Chip.svelte's, not this component's. */
  .disthead :global(.next) {
    border-color: var(--ok);
    background: var(--ok-tint);
    flex-wrap: wrap;
    gap: var(--s-1) var(--s-2);
    margin-left: var(--s-2);
    vertical-align: middle;
    max-width: 100%;
  }
  .disthead :global(.next:hover) { background: var(--ok-tint-strong); }
  .disthead :global(.next b) { color: var(--ok); }
  .disthead .piece { white-space: pre; }
  .count { font-size: var(--fs-xs); color: var(--dim); }
  .empty { padding: var(--s-3); color: var(--dim); font-size: var(--fs-sm); }
  .drow .dv { color: var(--dim); }
  /* Same rank column as the readout panel's table: both are "#" plus up to
     four digits of monospace. */
  .drow .rank { width: var(--m-rank); }
  .drow .dv :global(sup) { font-size: 0.7em; line-height: 0; }
  .disthead :global(sup) { font-size: 0.7em; line-height: 0; }
</style>
