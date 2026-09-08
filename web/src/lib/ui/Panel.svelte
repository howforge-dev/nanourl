<script module lang="ts">
  /**
   * How long a panel stays highlighted after being jumped to.
   *
   * Long enough to be seen after a smooth scroll settles, short enough not to
   * still be pulsing when the reader starts reading. One number for the seven
   * panels and the observatory's intro card, which flashes the same way
   * without being a panel.
   */
  export const FLASH_MS = 1400;

  // ...and the CSS animation's duration comes from the same number. `.card.flash`
  // lives in app.css (the observatory's intro card flashes without being a
  // Panel), so the two could not simply share a declaration — but they can
  // share a value. Set once, at module evaluation, before any flash can fire.
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--flash-ms', `${FLASH_MS}ms`);
  }
</script>

<script lang="ts">
  // One collapsible panel of the model observatory: a `.card` wrapping a
  // `<details>` whose `<summary>` holds the heading and a sub-heading that
  // hides while collapsed.
  //
  // The shell and the `focus()` that opens, scrolls and flashes it live here
  // once, with the styling that describes them, rather than seven copies of
  // four `$state` declarations and an eleven-line function against a rule set
  // in the site-wide stylesheet.
  //
  // Panels keep their own `focus()` as a one-line forwarder rather than the
  // parent reaching in here, because the parent's `handleGoto` addresses
  // panels by what they are ("atlas", "readout"), not by which of them happens
  // to own a card.
  import { tick, type Snippet } from 'svelte';
  import Card from './Card.svelte';

  let {
    title,
    /** Bound by every caller, so a panel can render its body lazily
     *  (`{#if open}`) and `focus()` can open it. */
    open = $bindable(false),
    /** The sub-heading under the title; hidden by CSS while collapsed. */
    sub,
    children,
    /** Run after the panel has opened and been scrolled to, before the flash —
     *  the attention panel additionally scrolls its own inner layer strip to
     *  the selected layer. */
    afterFocus,
  }: {
    title: string;
    open?: boolean;
    sub?: Snippet;
    children: Snippet;
    afterFocus?: () => void;
  } = $props();

  let cardEl: HTMLDivElement | undefined = $state();
  let detailsEl: HTMLDetailsElement | undefined = $state();
  let flash = $state(false);
  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  /** Open this panel, scroll it into view, and flash its border.
   *
   * The `flash = false` / read `offsetWidth` / `flash = true` dance restarts
   * the CSS animation: without the forced reflow between them the class never
   * actually leaves the element as far as the style engine is concerned, so a
   * second jump to an already-flashed panel animates nothing. */
  export async function focus(): Promise<void> {
    open = true;
    await tick();
    detailsEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    afterFocus?.();
    flash = false;
    void cardEl?.offsetWidth;
    flash = true;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flash = false;
    }, FLASH_MS);
  }
</script>

<Card {flash} class={open ? '' : 'collapsed'} bind:element={cardEl}>
  <details bind:this={detailsEl} bind:open>
    <summary>
      <h2>{title}</h2>
      {#if sub}<div class="h2sub">{@render sub()}</div>{/if}
    </summary>
    {@render children()}
  </details>
</Card>

<style>
  /* Panel chrome. It lives here, with the markup it describes, rather than in
     the site-wide stylesheet, which no other page's markup can reach.

     Two rows, so the summary is a grid rather than app.css's base flex row:
     that puts the shared chevron in row 1 next to the heading, vertically
     centred ON THE HEADING rather than on the whole two-line block. */
  summary {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    column-gap: var(--s-2);
    padding: var(--s-half) 0;
  }
  summary::before {
    grid-row: 1;
    grid-column: 1;
    width: 0.5em;
    height: 0.5em;
    border-width: var(--stroke);
    color: var(--dim);
  }
  summary:hover::before { color: var(--acc); }
  summary > h2,
  summary > .h2sub { grid-column: 2; }
  /* 17px, not the browser's 1.5em (22.5px): a panel heading was coming out
     LARGER than the page's own h1, which inverted the type scale. */
  summary h2 { margin: 0; color: var(--txt); font-size: var(--fs-xl); line-height: 1.4; }
  /* `.h2sub`'s own type stays in app.css: two panels reuse the class for
     captions inside their bodies, so it is not this shell's alone. What IS
     this shell's is that the summary copy hides while collapsed. */
  details:not([open]) summary .h2sub { display: none; }
  /* `.card.flash`'s animation and `.card.collapsed`'s padding stay in app.css:
     both act on Card.svelte's element, which a rule scoped here cannot reach,
     and the observatory's intro card flashes identically without being a
     Panel. */
</style>
