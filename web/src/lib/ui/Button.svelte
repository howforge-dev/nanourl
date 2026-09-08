<script lang="ts" module>
  /** How loud the button is. `primary` is the one action a pane is for;
   *  `secondary` is everything beside it; `ghost` must not read as the default
   *  action; `well` is a row of a diagram, filled like the page it sits on;
   *  `bare` carries its own paint and takes no chrome at all. */
  export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'well' | 'bare';
  /** `sm` sits inline beside text, `md` is a control in its own right, `lg`
   *  is a pane's primary action. */
  export type ButtonSize = 'sm' | 'md' | 'lg';
  /** Recolours the label (and, for `accent`, the border). A `tone` rather than
   *  a class, because a bare colour utility loses the specificity fight with
   *  the button's own colour. */
  export type ButtonTone = 'default' | 'accent' | 'ok' | 'bad';
</script>

<script lang="ts">
  // Every button on the site, and every link that has to sit beside one.
  //
  // The chrome — surface, border, radius, sizes, tones, and the one focus ring
  // — is `.btn*` in app.css, because Segmented's options are buttons too and
  // have to be the same button. This component owns the markup and the props
  // a caller chooses behaviour with.
  import type { Snippet } from 'svelte';

  let {
    variant = 'secondary',
    size = 'md',
    tone = 'default',
    /** Renders an <a>. A control that navigates is a link — it must open in a
     *  new tab, be copied from a context menu and be announced as a link — but
     *  it sits beside buttons, which is a shared appearance, not a shared
     *  element. */
    href,
    /** `href` only. `_blank` additionally gets `rel="noopener"`: without it the
     *  opened page can reach back through `window.opener`. */
    target,
    /** `href` only: the file name a click saves the target as, instead of
     *  navigating to it (the QR exports). */
    download,
    type = 'button',
    disabled = false,
    /** A full-width row: label left, detail right. */
    block = false,
    /** One of a stack: no border or radius of its own, so the list around it
     *  draws the separators. */
    flush = false,
    /** Renders `aria-pressed`: a toggle, not a command. */
    pressed,
    title,
    ariaLabel,
    /** `data-testid`. On the control itself: a wrapper element carrying it
     *  instead would let a click land beside the button rather than on it. */
    testid,
    /** Extra classes for the caller's own layout — never its chrome, which is
     *  what `variant`, `size`, `block` and `flush` are for. */
    class: klass = '',
    onclick,
    children,
  }: {
    variant?: ButtonVariant;
    size?: ButtonSize;
    tone?: ButtonTone;
    href?: string;
    target?: '_blank';
    download?: string;
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    block?: boolean;
    flush?: boolean;
    pressed?: boolean;
    title?: string;
    ariaLabel?: string;
    testid?: string;
    class?: string;
    onclick?: (e: MouseEvent) => void;
    children: Snippet;
  } = $props();

  const cls = $derived(
    [
      'btn',
      `btn-${variant}`,
      `btn-${size}`,
      tone === 'default' ? '' : `btn-tone-${tone}`,
      // `well` carries the shared sunken surface; the variant adds only its
      // readable label colour on top.
      variant === 'well' ? 'well' : '',
      block ? 'btn-block' : '',
      flush ? 'btn-flush' : '',
      klass,
    ]
      .filter(Boolean)
      .join(' '),
  );
</script>

{#if href}
  <a
    class={cls}
    {href}
    {target}
    {download}
    rel={target === '_blank' ? 'noopener' : undefined}
    {title}
    aria-label={ariaLabel}
    data-testid={testid}
    {onclick}>{@render children()}</a
  >
{:else}
  <button
    class={cls}
    {type}
    {disabled}
    {title}
    aria-label={ariaLabel}
    data-testid={testid}
    aria-pressed={pressed}
    {onclick}>{@render children()}</button
  >
{/if}
