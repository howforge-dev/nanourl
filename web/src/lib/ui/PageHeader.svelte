<script lang="ts">
  // The one header every page uses: logo + wordmark (+ an optional page
  // suffix), the tagline as its own sentence, and the cross-page links as a
  // separate nav row.
  //
  // The tagline and the links are separate rows, not one run of text joined
  // by "·": in one run the browser breaks the line wherever it happens to
  // fit — mid-sentence on desktop, and on a phone leaving a link's arrow
  // alone on its own line. Each nav item is a flex item with
  // `white-space: nowrap`, so it wraps whole or not at all.
  import { navFor, pageSuffix, pageTagline, type PageId } from '../pages';
  // The mark is data, not markup: the same rectangles are serialized into
  // dist/favicon.svg by the build, so the header and the tab icon cannot
  // drift apart. Three rectangles, one spelling.
  import { LOGO_RECTS, LOGO_VIEWBOX } from './logo';
  // The repository, from the same module the home page takes the release URLs
  // from: one spelling of the project's address for every page that shows it.
  import { REPO_URL } from '../links';

  let { here }: { here: PageId } = $props();

  // The tagline comes from lib/pages.ts, the same record the build reads for
  // <title> and the meta description, so the header and <head> cannot differ.
  const tagline = $derived(pageTagline(here));

  // Both the suffix after the wordmark and the cross-page row come from
  // lib/pages.ts: one list, so no two pages can spell one destination
  // differently.
  const suffix = $derived(pageSuffix(here));
  const links = $derived(navFor(here));
</script>

<h1>
  <!-- The logo + wordmark is the site's home link on every page, the
       compressor included (there it reloads, which is the conventional
       behaviour of a masthead link). -->
  <a class="home" href="/" aria-label="nanourl home">
    <svg viewBox={LOGO_VIEWBOX} aria-hidden="true">
      {#each LOGO_RECTS as r, i (i)}<rect {...r} />{/each}
    </svg><span class="wm">nano</span><span class="wmu">url</span></a>{#if suffix}<span class="suffix">· {suffix}</span>{/if}
</h1>
{#if tagline}<p class="tagline">{tagline}</p>{/if}
{#if links.length}
  <nav class="pagenav" aria-label="pages">
    {#each links as l (l.href)}
      {#if l.current}<span class="here" aria-current="page">{l.label}</span>{:else}<a href={l.href}>{l.label}</a>{/if}
    {/each}
    <!-- Last and right-aligned, in the strip's own dim style: it leaves the
         site, so it is not one of the pages, but it belongs to the same row
         rather than to a footer nobody scrolls to. -->
    <a class="source" href={REPO_URL}>source</a>
  </nav>
{/if}

<style>
  .home { display: inline-flex; align-items: center; color: inherit; text-decoration: none; }
  .home:hover .wm, .home:focus-visible .wm { text-decoration: underline; text-underline-offset: var(--s-1); }
  .wm { color: var(--txt); }
  .wmu { color: var(--acc); }
  .suffix { color: var(--dim); font-weight: 400; margin-left: var(--s-2); }
  /* Pushed to the end of the row; on a wrapped row it ends the last line,
     which is the same relationship. */
  .source { margin-left: auto; }
  /* Its own row under the wordmark, indented to start under the "n": the
     tagline is a sentence, and inside the h1's wrapping flex row it broke
     mid-sentence at narrow widths. */
  .tagline {
    color: var(--dim);
    font-size: var(--fs-md);
    line-height: 1.5;
    margin: var(--s-half) 0 0 calc(var(--logo) + var(--s-2));
    max-width: 62ch;
    text-wrap: pretty;
  }
  @media (max-width: 560px) {
    .tagline { margin-left: 0; }
  }
</style>
