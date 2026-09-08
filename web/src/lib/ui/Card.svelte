<script lang="ts">
  // The bordered surface every page builds on. `.card`'s rules stay in
  // app.css: Panel.svelte and the learn page's figures need the same
  // decoration on markup this component does not own, and `.card.flash`'s
  // keyframes are shared with the observatory's intro card, which flashes the
  // same way without being a Panel.
  //
  // Props are spelled out rather than collected in a rest element: a rest
  // element makes the component's surface unknowable to the compiler and to a
  // reader. Every attribute a card carries is listed below.
  import type { Snippet } from 'svelte';

  let {
    /** Flash the border: the observatory's jump-to highlight. */
    flash = false,
    /** The DOM node, for the caller that has to force a reflow to restart
     *  that animation (see Panel.svelte's `focus`). */
    element = $bindable(),
    class: klass = '',
    id,
    role,
    ariaLabelledby,
    testid,
    /** Only for hiding an inactive tab panel, which must stay in the DOM. */
    style,
    children,
  }: {
    flash?: boolean;
    element?: HTMLDivElement;
    class?: string;
    id?: string;
    role?: string;
    ariaLabelledby?: string;
    testid?: string;
    style?: string;
    children: Snippet;
  } = $props();
</script>

<div
  bind:this={element}
  class="card {klass}"
  class:flash
  {id}
  {role}
  aria-labelledby={ariaLabelledby}
  data-testid={testid}
  {style}>{@render children()}</div
>
