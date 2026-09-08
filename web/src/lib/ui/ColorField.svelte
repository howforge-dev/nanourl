<script lang="ts">
  // A colour as a hex field and a native picker, one value. The field takes
  // what is typed and hands over a value only once it is `#rrggbb`, so a
  // half-typed colour neither snaps back nor renders; the picker always
  // holds a full colour, so it hands over every change. Either way the other
  // control follows.
  import TextField from './TextField.svelte';

  const HEX = /^#[0-9a-f]{6}$/i;

  let {
    /** The colour, as `#rrggbb`. */
    value = $bindable(),
    /** The accessible name; the picker's is this plus " picker". */
    label,
    describedBy,
    onchange,
  }: { value: string; label: string; describedBy?: string; onchange?: (hex: string) => void } = $props();

  let text = $state('');
  $effect(() => {
    text = value;
  });

  function fromText(): void {
    if (HEX.test(text)) {
      value = text.toLowerCase();
      onchange?.(value);
    }
  }
  function fromPicker(e: Event): void {
    value = (e.currentTarget as HTMLInputElement).value.toLowerCase();
    onchange?.(value);
  }
</script>

<span class="color">
  <input class="picker" type="color" {value} aria-label="{label} picker" aria-describedby={describedBy} oninput={fromPicker} />
  <span class="hex"><TextField ariaLabel={label} {describedBy} bind:value={text} oninput={fromText} /></span>
</span>

<style>
  .color { display: inline-flex; align-items: center; gap: var(--s-1); }
  /* The native swatch, sized to the field beside it and given the same
     hairline; its own chrome is stripped so it does not paint a second,
     unrelated border around the swatch. */
  .picker {
    width: 2em;
    height: 2em;
    padding: 0;
    border: var(--border);
    border-radius: var(--r-3);
    background: none;
    cursor: pointer;
  }
  .picker::-webkit-color-swatch-wrapper { padding: 2px; }
  .picker::-webkit-color-swatch { border: 0; border-radius: var(--r-2); }
  .hex { width: 7em; }
</style>
