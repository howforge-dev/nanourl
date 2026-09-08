<script lang="ts">
  // A box whose content may be wider than the page, and scrolls inside itself
  // rather than pushing the page wider or being silently clipped.
  //
  // One name for the whole site. `.scroller` lives in app.css because the
  // learn page's figures compose it onto their own surface element, and
  // e2e/overflow.spec.ts's sweep walks the ancestor chain for it to decide
  // whether over-wide content is reachable at all.
  import type { Snippet } from 'svelte';

  let {
    /** The scrolling element, for a caller that scrolls it programmatically
     *  (the attention panel scrolls to the selected layer). */
    element = $bindable(),
    /** A caller's own layout hook, reached with `:global()` under a scoped
     *  ancestor — never its chrome. */
    class: klass = '',
    /** The scroller's own place in the flow (a top margin). Inline rather
     *  than a global rule, so one panel's spacing cannot reach another's. */
    style,
    children,
  }: {
    element?: HTMLDivElement;
    class?: string;
    style?: string;
    children: Snippet;
  } = $props();
</script>

<div bind:this={element} class="scroller {klass}" {style}>{@render children()}</div>
