<script lang="ts">
  // Stable ids and titles live in sections.ts, shared with
  // e2e/learn.smoke.spec.ts: one list, so a renamed section fails the spec
  // instead of silently narrowing it.
  import Card from '../../lib/ui/Card.svelte';
  import { SECTIONS } from './sections';
</script>

<Card class="toc">
  {#each SECTIONS as [id, title], i (id)}
    <a href="#{id}">{i + 1} · {title}</a>
  {/each}
</Card>

<style>
  /* The card shell is Card.svelte's; all the table of contents adds is its
     own link type. `:global` because the anchors are inside a component's
     children: Svelte scopes them to this file, but their `.toc` ancestor
     belongs to Card. */
  :global(.toc) a {
    color: var(--acc);
    text-decoration: none;
    display: block;
    padding: var(--s-half) 0;
    font-size: var(--fs-base);
  }
</style>
