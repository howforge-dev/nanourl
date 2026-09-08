<script lang="ts">
  // One-click examples. Each is a Chip: a small labelled thing you click to
  // fill the input, which is what a chip is.
  import Chip from './Chip.svelte';
  import { EXAMPLE_URLS as EXAMPLES } from '../examples';

  let { onpick }: { onpick: (url: string) => void } = $props();
</script>

<div class="examples">
  <span>try:</span>
  {#each EXAMPLES as [name, u] (name)}
    <Chip title={u} onclick={() => onpick(u)}>{name}</Chip>
  {/each}
</div>

<style>
  .examples { font-size: var(--fs-xs); margin: 0 0 var(--s-3); display: flex; gap: var(--s-2); align-items: center; flex-wrap: wrap; }
  .examples span { color: var(--dim); }
</style>
