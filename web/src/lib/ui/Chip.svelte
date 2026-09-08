<script lang="ts">
  // The small rounded label: a "try:" example, a tokenizer piece, one of the
  // atlas legend's class toggles, a per-token cost cell, one character of the
  // bit stream, one dreamed URL. The sunken surface is app.css's `.well`; the
  // radius, padding and type are the chip's.
  //
  // Interactive when it is given an `onclick`, and then a real <button>: an
  // example that fills the input is a control, so it must be focusable and
  // reachable by keyboard without a role attribute standing in for one.
  import type { Snippet } from 'svelte';

  let {
    /** monospace label — a token piece, a code, a character */
    mono = false,
    /** keep runs of spaces: a tokenizer piece can BE a space */
    pre = false,
    /** stack the content instead of laying it out in a row (the per-token
     *  cost cell is a piece over its bits over its bar) */
    block = false,
    /** this one is chosen — an accent border, not colour alone */
    selected = false,
    /** switched off but still shown (the atlas legend's hidden classes, a
     *  character the coder has not written yet) */
    muted = false,
    pressed,
    title,
    ariaLabel,
    /** id of the element that explains the chip (a `Hint`'s tooltip). */
    describedBy,
    /** `data-testid`. On the control itself: a wrapper element carrying it
     *  instead would let a click land beside the button rather than on it. */
    testid,
    class: klass = '',
    onclick,
    onkeydown,
    children,
  }: {
    mono?: boolean;
    pre?: boolean;
    block?: boolean;
    selected?: boolean;
    muted?: boolean;
    pressed?: boolean;
    title?: string;
    ariaLabel?: string;
    describedBy?: string;
    testid?: string;
    class?: string;
    onclick?: (e: MouseEvent) => void;
    onkeydown?: (e: KeyboardEvent) => void;
    children: Snippet;
  } = $props();
</script>

{#if onclick}
  <button
    class="chip well {klass}"
    class:mono
    class:pre
    class:block
    class:selected
    class:muted
    type="button"
    {title}
    aria-label={ariaLabel}
    aria-describedby={describedBy}
    data-testid={testid}
    aria-pressed={pressed}
    {onclick}
    {onkeydown}>{@render children()}</button
  >
{:else}
  <span class="chip well {klass}" class:mono class:pre class:block class:selected class:muted {title} data-testid={testid}>{@render children()}</span>
{/if}

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    border-radius: var(--r-3);
    padding: var(--s-1) var(--s-2);
    color: var(--txt);
    font-family: var(--font-sans);
    font-size: var(--fs-xs);
    /* Never inherit prose leading: the learn page sets 1.65 on <body>, and
       inherited into a chip's 10px sub-label it opens a blank line inside
       every box. */
    line-height: 1.35;
    text-align: left;
    min-width: 0;
  }
  .mono { font-family: var(--font-mono); }
  .pre { white-space: pre; }
  .block { display: block; }
  .selected { border-color: var(--acc); }
  /* One "shown but switched off" opacity, for the atlas legend's hidden
     classes and the bit grid's unwritten characters alike. */
  .muted { opacity: 0.45; }
  button.chip { cursor: pointer; }
</style>
