<script lang="ts">
  // Bits → characters: the mechanical last step — read the bit stream six
  // bits at a time, each group picks one of 64 URL-safe characters.
  // Six-bit grouping is exact for
  // base64url specifically (64 = 2^6, so coder.rs's bignum radix conversion
  // reduces to simple bit-grouping from the least-significant end) — this
  // page always encodes with alpha=1 (base64url), so the story matches what
  // actually ran.

  import type { EncodeResult } from '../../lib/codec/types';
  import { headerBits } from '../../lib/coderReplay';
  import Panel from '../../lib/ui/Panel.svelte';
  import Chip from '../../lib/ui/Chip.svelte';

  let {
    lastEnc,
    writtenBits,
  }: {
    lastEnc: EncodeResult | null;
    writtenBits: number;
  } = $props();

  let panel: ReturnType<typeof Panel> | undefined = $state();
  let open = $state(false);

  interface Cell {
    ch: string;
    ready: boolean;
    bits: { ch: string; known: boolean; color: string }[];
  }

  let cells: Cell[] = $derived.by(() => {
    if (!lastEnc || !open) return [];
    const hdr = headerBits(lastEnc.version);
    const full = '1' + hdr + lastEnc.bitstr; // guard bit · version header · payload
    const known = 1 + hdr.length + Math.max(0, Math.min(lastEnc.bitstr.length, writtenBits));
    const L = full.length;
    const nch = Math.ceil(L / 6);
    const out: Cell[] = [];
    let pos = 0;
    for (let i = 0; i < nch; i++) {
      const len = i === 0 ? L - 6 * (nch - 1) : 6;
      const cellKnown = Math.max(0, Math.min(len, known - pos));
      const ready = cellKnown === len;
      const bits: Cell['bits'] = [];
      for (let b = 0; b < len; b++) {
        const gi = pos + b;
        const color = gi === 0 ? 'var(--warn)' : gi <= hdr.length ? 'var(--ok)' : 'var(--txt)';
        bits.push({ ch: full[gi], known: b < cellKnown, color });
      }
      out.push({ ch: ready ? (lastEnc.coded[i] ?? '?') : '?', ready, bits });
      pos += len;
    }
    return out;
  });

  export async function focus(): Promise<void> {
    await panel?.focus();
  }
</script>

<Panel bind:this={panel} bind:open title="bits → characters">
  {#snippet sub()}
    the final step is mechanical: the bit stream (guard bit, version bits, then the coder's payload) is read six
    bits at a time, and each six-bit number picks one of 64 URL-safe characters. base79 instead treats all the
    bits as one big number and rewrites it in base 79 — ~5% shorter, no per-character alignment
  {/snippet}
  {#if open}
    {#if !lastEnc}
      <p class="note">select a token above…</p>
    {:else}
      <div class="grid">
        {#each cells as c, i (i)}
          <Chip class="cell" block mono muted={!c.ready}>
            <div class="ch" class:acc={c.ready}>{c.ready ? c.ch : '·'}</div>
            <div class="bits">
              {#each c.bits as b, j (j)}<span style:color={b.known ? b.color : 'var(--line)'}>{b.known ? b.ch : '·'}</span>{/each}
            </div>
          </Chip>
        {/each}
      </div>
    {/if}
  {/if}
</Panel>

<style>
  .grid { display: flex; flex-wrap: wrap; gap: var(--s-2); margin-top: var(--s-3); }
  /* The cell shell is Chip.svelte's; this is the character over its six bits.
     `:global` for the cell itself (Chip's element), plain rules for the two
     lines inside it, which are this component's own markup. */
  .grid :global(.cell) { text-align: center; }
  .grid .ch { font-size: var(--fs-lg); color: var(--line); }
  .grid .ch.acc { color: var(--acc); }
  .grid .bits { font-size: var(--fs-2xs); }
</style>
