<script lang="ts">
  // A pulled-out aside on the learn page: a bar down the left, the card
  // colour behind it.
  //
  // NOT `.note`: app.css's `.note` is the transient "still working"
  // placeholder that e2e/model.smoke.spec.ts waits on, and one class meaning
  // both a permanent bordered aside here and a spinner-substitute there is
  // how the two ideas got confused in the first place.
  import type { Snippet } from 'svelte';

  let { tone = 'info', children }: { tone?: 'info' | 'warn'; children: Snippet } = $props();
</script>

<div class="callout" class:warn={tone === 'warn'}>{@render children()}</div>

<style>
  .callout {
    border-left: var(--bar) solid var(--acc);
    padding: var(--s-2) var(--s-4);
    background: var(--card);
    border-radius: 0 var(--r-4) var(--r-4) 0;
    margin: var(--s-4) 0;
    font-size: var(--fs-base);
  }
  /* A modifier with its own name, not the global `.warn-text` utility: this
     recolours the bar only, where a global `.warn` would repaint the whole
     body amber. */
  .warn { border-left-color: var(--warn); }
</style>
