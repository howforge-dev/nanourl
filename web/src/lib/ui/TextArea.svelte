<script lang="ts">
  // The multi-line spelling of TextField, so a caller reads as what it is.
  // Forwarding rather than a second copy of the field styles.
  import TextField from './TextField.svelte';

  let {
    value = $bindable(),
    rows,
    id,
    placeholder,
    ariaLabel,
    oninput,
    onkeydown,
  }: {
    value: string;
    rows?: number;
    id?: string;
    placeholder?: string;
    ariaLabel?: string;
    oninput?: (e: Event) => void;
    onkeydown?: (e: KeyboardEvent) => void;
  } = $props();
</script>

<TextField multiline bind:value {rows} {id} {placeholder} {ariaLabel} {oninput} {onkeydown} />
