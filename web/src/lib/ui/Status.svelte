<script lang="ts">
  // The model-load status line + progress bar, fed by
  // lib/codec/codecState.svelte.ts.
  //
  // `parts` are the '·'-separated segments of the same line `text` holds:
  // numeric ones are set in tabular monospace so the line keeps its width as
  // the figures tick (a proportional "18.2 MB/s · 3.1 s elapsed" reflows on
  // every update, which reads as flicker). Callers that have no segmentation
  // can still pass `text` alone.
  import type { StatusPart } from '../codec/progress';

  let {
    text,
    fraction,
    parts,
  }: { text: string; fraction: number; parts?: StatusPart[] } = $props();

  let shown: StatusPart[] = $derived(parts ?? [{ text }]);
  // The bar is a download indicator: keep it while there is something left to
  // download, drop it the moment there isn't, rather than leaving a full blue
  // rule under the status line for the rest of the session.
  let loading = $derived(fraction < 1);
</script>

<div id="status" class:pinned={loading}>
  <!-- aria-live: "loading model…" -> "model ready — 246M params…" -> "failed
       to load: …" is the page's whole state machine; with a role only on the
       bar it is announced to nobody. `polite`
       because it updates roughly ten times a second during the download;
       aria-atomic so the whole sentence is re-read, not just the delta. The
       separator spans are aria-hidden so the reading is a sentence, not a
       list of interpuncts. -->
  <span class="line" role="status" aria-live="polite" aria-atomic="true"
    >{#each shown as p, i (i)}{#if i > 0}<span class="sep" aria-hidden="true">·</span>{/if}<span class:n={p.num}>{p.text}</span>{/each}</span
  >
  {#if loading}
    <div id="bar" role="progressbar" aria-label="model download" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(fraction * 100)}>
      <div style:width="{fraction * 100}%"></div>
    </div>
  {/if}
</div>

<style>
  /* In flow at the end of the page once the model is ready; pinned to the
     bottom of the viewport only while loading, so the progress stays visible
     however far the page is scrolled without taking screen space afterwards. */
  #status {
    padding: var(--s-2) 0 var(--s-3);
    border-top: var(--border);
    font-size: var(--fs-sm);
    color: var(--dim);
  }
  #status.pinned {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 5;
    padding: var(--s-2) var(--gutter) var(--s-3);
    background: var(--bg);
  }
  /* Centred on the same reading column the page uses, so the pinned line
     starts under the content it is reporting on. */
  #status > * { max-width: calc(var(--col) - 2 * var(--gutter)); margin-left: auto; margin-right: auto; display: block; }
  .line { font-variant-numeric: tabular-nums; }
  /* Figures keep the monospace so the line does not jitter while a download
     ticks, but the same colour as the words — the status line is not a place
     to highlight anything. */
  .n {
    font-family: var(--font-mono);
    font-size: 0.94em;
  }
  /* Svelte trims template whitespace, so the spaces around a '·' written
     inline vanish — the padding has to be the separator's own. */
  .sep { opacity: 0.5; padding: 0 var(--s-2); }
  #bar { height: var(--s-1); background: var(--line); border-radius: var(--r-1); overflow: hidden; margin-top: var(--s-2); }
  #bar > div { height: 100%; background: var(--acc); transition: width 0.2s; }
  @media (prefers-reduced-motion: reduce) {
    #bar > div { transition: none; }
  }
</style>
