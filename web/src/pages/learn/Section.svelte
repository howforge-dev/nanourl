<script lang="ts">
  // Thin heading wrapper: the number and the title come from sections.ts, so
  // a section cannot carry a number its position does not give it. The id is
  // what the TOC, the cross-references and the observatory's deep links target.
  import type { Snippet } from 'svelte';
  import { sectionNumber, sectionTitle, type SectionId } from './sections';
  let { id, children }: { id: SectionId; children: Snippet } = $props();
</script>

<h2 {id}>{sectionNumber(id)} · {sectionTitle(id)}</h2>
{@render children()}
