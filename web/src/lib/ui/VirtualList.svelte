<script lang="ts">
  // Virtual table over the full vocab distribution: only the rows inside the
  // viewport (plus a small overscan) are ever in the DOM.
  import type { Snippet } from 'svelte';
  import { visibleRange } from './virtual';

  let { rows, rowHeight, height, row }: { rows: number; rowHeight: number; height: number; row: Snippet<[number]> } =
    $props();

  let el: HTMLDivElement | undefined = $state();
  let scrollTop = $state(0);

  let range = $derived(visibleRange(scrollTop, rowHeight, height, rows));

  function onscroll() {
    if (el) scrollTop = el.scrollTop;
  }

  // Instant, not smooth — smooth-scrolling a virtual table hundreds of
  // thousands of pixels tall crawls.
  export function scrollTo(i: number) {
    if (!el) return;
    el.scrollTop = Math.max(0, i * rowHeight);
    // A programmatic scrollTop write dispatches a native 'scroll' event
    // asynchronously (next frame) in real browsers, and not at all in jsdom
    // — so a caller that jumps and then immediately reads back the visible
    // range (e.g. a "flash the chosen row" highlight) would see stale rows
    // for a frame or forever. Refresh synchronously from the clamped value.
    scrollTop = el.scrollTop;
  }
</script>

<div class="vlist" bind:this={el} style:height="{height}px" onscroll={onscroll}>
  <div class="vspacer" style:height="{rows * rowHeight}px">
    {#each [...Array(range.last - range.first).keys()] as offset (range.first + offset)}
      <div class="vrow" style:top="{(range.first + offset) * rowHeight}px" style:height="{rowHeight}px">
        {@render row(range.first + offset)}
      </div>
    {/each}
  </div>
</div>

<style>
  /* both axes: a row can be wider than the viewport (e.g. the distribution
     viewer's rank+piece+bar+prob columns), and it must scroll inside this
     box rather than pushing the page itself wider. */
  .vlist { overflow: auto; position: relative; }
  .vspacer { position: relative; }
  .vrow { position: absolute; left: 0; right: 0; }
</style>
