<script lang="ts">
  // Thin heading wrapper so every section numbers and ids itself the same
  // way — id is what the TOC and the observatory's deep links target.
  import type { Snippet } from 'svelte';
  let { id, n, title, children }: { id: string; n: number; title: string; children: Snippet } = $props();
</script>

<h2 {id}>{n} · {title}</h2>
{@render children()}
