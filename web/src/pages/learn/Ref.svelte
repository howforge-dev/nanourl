<script lang="ts">
  // A cross-reference to another section: "section N" as a link to its
  // heading, N taken from sections.ts, so the prose renumbers with the page.
  import { sectionNumber, sectionTitle, type SectionId } from './sections';
  let { to }: { to: SectionId } = $props();
</script>

<a class="ref" href="#{to}" title={sectionTitle(to)}>section {sectionNumber(to)}</a>

<style>
  .ref { color: inherit; text-decoration: underline; text-decoration-color: var(--dim); text-underline-offset: 0.15em; }
  .ref:hover { color: var(--acc); }
</style>
