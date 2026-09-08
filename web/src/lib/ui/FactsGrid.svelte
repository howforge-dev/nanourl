<script lang="ts">
  // The label/value grid: what a fact-carrying block looks like on this site.
  // The `.fgroup` + `<h4>` + `<dl class="facts">` scaffold is written once, so
  // a group cannot lose its heading or its label column independently of the
  // others.
  //
  // The `dt`/`dd` pairs come from the caller and stay there: they are the
  // content, and Svelte scopes a component's CSS to its own template — so the
  // `.facts` rules have to live in app.css, where the caller's markup can
  // reach them, and this component owns only the scaffold around them.
  import type { Snippet } from 'svelte';

  let {
    /** The group heading. Without one the grid renders bare, for a caller
     *  that is already inside a titled group or is the only thing in a card. */
    title,
    children,
    /** Rendered after the grid, inside the group (the build footer's
     *  "a new version is ready" prompt). */
    after,
  }: { title?: string; children: Snippet; after?: Snippet } = $props();
</script>

{#if title}
  <div class="fgroup">
    <h4>{title}</h4>
    <dl class="facts">{@render children()}</dl>
    {#if after}{@render after()}{/if}
  </div>
{:else}
  <dl class="facts">{@render children()}</dl>
  {#if after}{@render after()}{/if}
{/if}
