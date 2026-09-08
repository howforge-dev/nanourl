<script module lang="ts">
  // Shared free-floating tooltip singleton. One instance lives in App.svelte;
  // every panel gets it as a prop and calls .show()/.hide() from its own
  // canvas/svg mousemove handlers.
  export interface TooltipApi {
    show(ev: MouseEvent, html: string): void;
    hide(): void;
  }

  /** Escape user-controlled text (a piece can be ANY byte sequence a URL
   * contains) before it goes into a tooltip's innerHTML. */
  export function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
</script>

<script lang="ts">
  let visible = $state(false);
  let left = $state(0);
  let top = $state(0);
  let html = $state('');

  export function show(ev: MouseEvent, content: string): void {
    html = content;
    visible = true;
    left = Math.min(ev.clientX + 14, innerWidth - 300);
    top = ev.clientY + 14;
  }

  export function hide(): void {
    visible = false;
  }
</script>

{#if visible}
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- callers pass static template fragments plus escapeHtml()'d piece text (see this module's own escapeHtml export); never raw user input -->
  <div class="tip" style:left="{left}px" style:top="{top}px">{@html html}</div>
{/if}

<style>
  .tip {
    position: fixed;
    display: block;
    background: var(--raised);
    border: var(--border);
    border-radius: var(--r-3);
    padding: var(--s-1) var(--s-2);
    font: var(--fs-xs) var(--font-mono);
    pointer-events: none;
    z-index: 10;
    max-width: var(--m-tip);
    word-break: break-all;
    box-shadow: 0 var(--s-1) var(--s-4) var(--shadow);
  }
</style>
