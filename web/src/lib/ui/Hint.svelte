<script lang="ts">
  // A "?" beside a label that explains the control in plain words: on hover,
  // on keyboard focus, and on a tap, which toggles it for a touch screen with
  // nothing to hover. The tip is a `role="tooltip"` the button points at
  // with `aria-describedby`, and the control it explains points at the same
  // id (the primitives' `describedBy`), so a screen reader hears the
  // explanation on the control as well as on the mark.
  import { TESTID } from '../testids';

  let { id, text }: { id: string; text: string } = $props();
  let open = $state(false);
</script>

<span class="hint" class:open>
  <button
    type="button"
    class="q"
    aria-label="what this means"
    aria-describedby={id}
    aria-expanded={open}
    data-testid={TESTID.hint}
    onclick={() => (open = !open)}
    onblur={() => (open = false)}>?</button
  >
  <span role="tooltip" {id} class="tip">{text}</span>
</span>

<style>
  .hint { position: relative; display: inline-block; margin-left: var(--s-1); vertical-align: middle; }
  .q {
    width: 1.25em;
    height: 1.25em;
    padding: 0;
    border: var(--border);
    border-radius: 50%;
    background: var(--card);
    color: var(--dim);
    font: 600 var(--fs-2xs) / 1 var(--font-sans);
    cursor: help;
  }
  .q:hover,
  .q:focus-visible { color: var(--acc); border-color: var(--acc); }
  .tip {
    display: none;
    position: absolute;
    left: 0;
    top: calc(100% + var(--s-1));
    z-index: 2;
    width: max-content;
    max-width: min(28em, 80vw);
    padding: var(--s-2) var(--s-3);
    border: var(--border);
    border-radius: var(--r-4);
    background: var(--raised);
    color: var(--txt);
    font: var(--fs-xs) / 1.5 var(--font-sans);
    white-space: normal;
  }
  .hint:hover .tip,
  .hint:focus-within .tip,
  .hint.open .tip { display: block; }
</style>
