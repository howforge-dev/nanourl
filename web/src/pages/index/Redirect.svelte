<script lang="ts">
  // Redirect overlay: decodes the URL fragment and, for an http(s) target
  // only, counts down to location.replace. A non-http target is shown but
  // never auto-opened.
  import type { Codec } from '../../lib/codec/client';
  import type { CodecLoader } from '../../lib/codec/codecState.svelte';
  import type { Alphabet } from '../../lib/codec/types';
  import { parseLink } from '../../lib/alphabet';
  import { isHttp } from '../../lib/url';
  import Status from '../../lib/ui/Status.svelte';
  import Button from '../../lib/ui/Button.svelte';
  import { TESTID } from '../../lib/testids';

  let {
    href,
    loader,
    alpha,
    onclose,
  }: {
    href: string;
    loader: CodecLoader;
    alpha: Alphabet;
    onclose: () => void;
  } = $props();

  // show the fragment the way the user wrote it, not the way the browser
  // serialized it: location.hash percent-encodes emoji at 12 chars per glyph.
  // href is captured once by the caller (App.svelte) and never changes, but
  // it's still a reactive prop, so read it inside $derived rather than at
  // the top level of the script.
  let rawFrag = $derived.by(() => {
    const idx = href.indexOf('#');
    return idx >= 0 ? href.slice(idx + 1) : '';
  });
  let shown = $derived.by(() => {
    try {
      return decodeURIComponent(rawFrag);
    } catch {
      return rawFrag; // keep the raw form
    }
  });

  let active = $state(true);
  let note = $state('');
  let target = $state('');
  let showBar = $state(true);
  let started = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  // Where focus was before the overlay took it, so cancel() can put it back.
  const previouslyFocused = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;

  function cancel() {
    active = false;
    if (timer) clearInterval(timer);
    onclose();
    previouslyFocused?.focus?.();
  }

  /** Escape cancels. Without it the only way to stop an auto-navigation that
   * fires in ~2.1 s is to find and click `cancel` — the last element in DOM
   * order — inside that window, while `Tab` walks the *background* Encode/
   * Decode controls still in the tab order beneath an opaque overlay. That is
   * both an accessibility problem and a safety one. */
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && active) {
      e.preventDefault();
      cancel();
    }
  }

  // Focus the dialog itself, not the cancel button: Escape and screen readers
  // work from there, and no button lights up as if it were the default action.
  let dialogEl: HTMLDivElement | undefined = $state();
  $effect(() => {
    if (active && dialogEl) dialogEl.focus({ preventScroll: true });
  });

  async function doRedirect(c: Codec) {
    showBar = false;
    const parsed = parseLink(href);
    if (parsed.error) {
      // parseLink's only error case is a truncated/bad %-escape. The redirect
      // flow words it for itself, distinct from parseLink's generic message
      // (used verbatim by Decode.svelte's paste-a-full-link case).
      note = 'invalid link: malformed percent-encoding';
      return;
    }
    const codeAlpha = parsed.alpha ?? alpha;
    const r = await c.decode(parsed.code, codeAlpha);
    if (!active) return; // cancelled while decoding
    if (!r.ok) {
      note = r.error;
      return;
    }
    target = r.url;
    // decode is byte-exact, so a code can name any scheme — never auto-open
    // javascript:/data:/anything that isn't plain web
    if (!isHttp(r.url)) {
      note = 'not auto-opening a non-http(s) target; copy it only if you trust it';
      return;
    }
    let n = 2;
    note = `redirecting in ${n}…`;
    timer = setInterval(() => {
      if (n === 0) {
        clearInterval(timer);
        location.replace(r.url);
        return;
      }
      note = `redirecting in ${n--}…`;
    }, 700);
  }

  // A load failure is terminal for this overlay: there is no model to decode
  // the fragment with, so drop the progress line and say so where the note is.
  $effect(() => {
    if (!active) return;
    if (loader.error) {
      note = loader.errorText;
      showBar = false;
    }
  });

  $effect(() => {
    const c = loader.codec;
    if (active && c && !started) {
      started = true;
      void doRedirect(c);
    }
  });
</script>

<svelte:window onkeydown={onKeydown} />

{#if active}
  <!-- role="dialog" + aria-modal so assistive tech announces this and treats
       the page behind it as inert; aria-labelledby/describedby name it with
       the code being decoded and the live countdown. -->
  <div
    class="overlay"
    data-testid={TESTID.redirectOverlay}
    role="dialog"
    aria-modal="true"
    aria-labelledby="redirect-title"
    aria-describedby="redirect-note"
    tabindex="-1"
    bind:this={dialogEl}
  >
    <div class="lead" id="redirect-title">
      {target ? 'decoded' : note ? 'could not decode' : 'decoding'}
      <span class="code">#{shown}</span>{target || note ? '' : '…'}
    </div>
    <div class="target" data-testid={TESTID.redirectTarget}>{target}</div>
    <!-- aria-live: the countdown ("redirecting in 2…"), the decoded target and
         any error are the only things that change here, and a screen-reader
         user must hear them before the navigation happens. `polite` rather
         than `assertive` — it updates every 700 ms. -->
    <div class="caption" id="redirect-note" data-testid={TESTID.redirectNote} aria-live="polite">{note}</div>
    {#if showBar}
      <div class="statuswrap">
        <Status text={loader.statusText} parts={loader.statusParts} fraction={loader.statusFraction} />
      </div>
    {/if}
    <!-- Cancel is the escape hatch, not the action: the ghost variant, still
         fully focusable and with the shared focus ring. -->
    <span class="cancel">
      <Button variant="ghost" testid={TESTID.redirectCancel} onclick={cancel}>cancel (or press Escape)</Button>
    </span>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--s-3);
    padding: var(--s-5);
    text-align: center;
    z-index: 9;
  }
  .lead { font-size: var(--fs-base); color: var(--dim); }
  .statuswrap { width: min(var(--m-dialog), 90%); }
  .statuswrap :global(#status) { margin-bottom: 0; text-align: center; }
  /* The destination is what this screen is about — it is going to be opened
     in a moment, and reading it is the one thing a visitor can do about
     that. Everything else on the overlay is quieter than it. */
  .target {
    font-family: var(--font-mono);
    font-size: var(--fs-2xl);
    line-height: 1.45;
    color: var(--txt);
    word-break: break-all;
    max-width: var(--m-read);
  }
  .target:empty { display: none; }
  /* A permanent status line, not a transient placeholder — .caption, not
     .note (which the observatory's E2E treats as "still working"). Hidden
     while empty so it reserves no space before there is anything to say. */
  .caption:empty { display: none; }
  .code { font-family: var(--font-mono); color: var(--acc); }
  .cancel { margin-top: var(--s-2); }
  /* programmatic focus lands on the dialog; it must not draw a ring */
  .overlay:focus { outline: none; }
</style>
