<script lang="ts" generics="V extends string | number">
  // Every text entry on the site: the URL box, the code box, the two token
  // filters, the dream prefix and its four numeric knobs. The sunken surface
  // is app.css's `.well`; the radius, padding and monospace are the field's.
  // A styled element selector would reach only the input types it names, and
  // `type=number` is exactly the one such a list forgets.
  //
  // `multiline` renders a <textarea> from the same declaration rather than a
  // second component with a second copy of the styles; TextArea.svelte is the
  // named wrapper.
  let {
    value = $bindable(),
    multiline = false,
    type = 'text',
    rows,
    min,
    max,
    step,
    id,
    placeholder,
    /** the accessible name. Not a placeholder: a placeholder is not a name
     *  and it vanishes the moment anything is typed. Omitted only where a
     *  visible <label for> already names the field. */
    ariaLabel,
    spellcheck = false,
    autocomplete,
    autocapitalize,
    autocorrect,
    /** proportional type instead of monospace */
    sans = false,
    class: klass = '',
    style,
    oninput,
    onkeydown,
  }: {
    value: V;
    multiline?: boolean;
    type?: 'text' | 'search' | 'number';
    rows?: number;
    min?: number;
    max?: number;
    step?: number;
    id?: string;
    placeholder?: string;
    ariaLabel?: string;
    spellcheck?: boolean;
    autocomplete?: 'off';
    autocapitalize?: 'off';
    autocorrect?: 'off';
    sans?: boolean;
    class?: string;
    style?: string;
    oninput?: (e: Event) => void;
    onkeydown?: (e: KeyboardEvent) => void;
  } = $props();
</script>

{#if multiline}
  <textarea
    class="field well {klass}"
    class:sans
    bind:value
    {id}
    {rows}
    {placeholder}
    {spellcheck}
    {style}
    aria-label={ariaLabel}
    {oninput}
    {onkeydown}
  ></textarea>
{:else}
  <input
    class="field well {klass}"
    class:sans
    bind:value
    {type}
    {id}
    {min}
    {max}
    {step}
    {placeholder}
    {spellcheck}
    {style}
    {autocomplete}
    {autocapitalize}
    {autocorrect}
    aria-label={ariaLabel}
    {oninput}
    {onkeydown}
  />
{/if}

<style>
  .field {
    width: 100%;
    color: var(--txt);
    border-radius: var(--r-4);
    padding: var(--s-3);
    font: var(--fs-md) / 1.4 var(--font-mono);
  }
  .sans { font-family: var(--font-sans); }
  textarea.field { resize: vertical; }

  @media (max-width: 480px) {
    /* 16px stops iOS zooming the page on focus. */
    .field { font-size: var(--fs-lg); }
    /* rows="2" is two lines of a 900px-wide desktop box; at 375px the same
       URL needs three or four, and the last one was cut off mid-word inside
       the scroller — which reads as clipped content, not as a scrollable
       field. */
    textarea.field { min-height: var(--m-field); }
  }
</style>
