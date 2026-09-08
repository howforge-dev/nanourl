<script lang="ts">
  // The online short link, made on request: a button while there is none, the
  // minted `qv.lc/ABC123` row once there is. It needs no model, so it is
  // offered as soon as a URL is typed, and it is never made on its own, since
  // the server counts creations per address.
  import { untrack } from 'svelte';
  import { shorten, TURNSTILE_SITE_KEY, type Shortened } from '../../lib/shortener';
  import { challenge } from '../../lib/turnstile';
  import Button from '../../lib/ui/Button.svelte';
  import CopyButton from '../../lib/ui/CopyButton.svelte';
  import { TESTID } from '../../lib/testids';
  import { createLatest } from '../../lib/latest';

  let { url, onlink }: { url: string; onlink?: (link: string) => void } = $props();

  let phase: 'idle' | 'checking' | 'posting' = $state('idle');
  let result: Shortened | null = $state(null);
  let errorMsg = $state('');
  let widget: HTMLDivElement | undefined = $state();
  const latest = createLatest();

  const PHASE_TEXT = { checking: 'checking you are not a bot…', posting: 'making the link…' } as const;

  // A different URL: the link on screen was made for the previous one.
  $effect(() => {
    void url;
    untrack(reset);
  });
  function reset(): void {
    latest.cancel();
    phase = 'idle';
    result = null;
    errorMsg = '';
    onlink?.('');
  }

  async function make(): Promise<void> {
    const run = latest.begin();
    const u = url;
    errorMsg = '';
    let token = '';
    if (TURNSTILE_SITE_KEY && widget) {
      phase = 'checking';
      try {
        token = await challenge(widget, TURNSTILE_SITE_KEY);
      } catch (e) {
        if (!run.current) return;
        phase = 'idle';
        errorMsg = e instanceof Error ? e.message : String(e);
        return;
      }
      if (!run.current) return;
    }
    phase = 'posting';
    const r = await shorten(u, token);
    if (!run.current) return;
    phase = 'idle';
    if (r.ok) {
      result = r;
      onlink?.(r.link);
    } else {
      errorMsg = r.error;
    }
  }
</script>

{#if url}
  {#if result}
    <div class="row">
      <!-- shown without the scheme, like the compressed link above it; the copy button copies the full URL -->
      <div class="out well" data-testid={TESTID.shortLink} style="flex:1">{result.link.replace(/^https?:\/\//, '')}</div>
      <CopyButton text={result.link} />
    </div>
    <p class="caption">
      {result.created ? 'A short link' : 'This URL already had a short link'}: {result.slug.length} characters, stored on qv.lc. It lasts as long as this
      service does; the compressed link above needs no service at all.
    </p>
  {:else}
    <div class="row">
      <Button testid={TESTID.shortLinkButton} disabled={phase !== 'idle'} onclick={make}>Short link</Button>
      <span class="caption note">a few characters, stored on qv.lc, for when the compressed link is too long</span>
    </div>
    {#if phase !== 'idle'}<div class="busy" role="status" aria-live="polite">{PHASE_TEXT[phase]}</div>{/if}
    <!-- The widget draws here only when Cloudflare needs the visitor to act. -->
    <div bind:this={widget} data-testid={TESTID.shortLinkWidget}></div>
  {/if}
  {#if errorMsg}<div class="err" role="alert" data-testid={TESTID.shortLinkError}>{errorMsg}</div>{/if}
{/if}

<style>
  /* The caption beside the button, not under it: the row reads as one offer. */
  .note { margin-top: 0; }
</style>
