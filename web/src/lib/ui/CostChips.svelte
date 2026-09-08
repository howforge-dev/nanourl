<script lang="ts" module>
  /** One token's cost, as either source spells it: the live codec's `Tok`
   *  (`{ piece, bits }` plus fields this figure ignores) or the learn page's
   *  stored trace. */
  export interface CostChip {
    piece: string;
    bits: number;
  }
</script>

<script lang="ts">
  // The per-token cost strip, in one place. The compressor's live chips and
  // the learn page's worked-example figure are the same idea; as two
  // components they are two grids, two chip shells, two bar treatments and two
  // bit formatters that disagree on the near-zero case.
  //
  // The only difference is precision. Both sources carry 2dp (the codec
  // rounds `bits` to 2dp on every encode and the learn page's stored trace
  // keeps the same), but the compressor's live strip prints 1dp, where
  // a second decimal is noise beside a bar that moves as you type, and the
  // learn figure's worked example prints the full 2dp it is walking through.
  // That is one prop, not one component each.
  import { fmtBits } from '../format';
  import Chip from './Chip.svelte';
  import { SIZE } from './tokens';

  let {
    tokens,
    /** decimals to print, and the threshold below which a value is reported
     *  as "less than the display resolution" rather than as a rounded zero */
    digits = 1,
    selected,
    onselect,
    /** minimum column width; the learn page's figure sits in a wider box */
    minWidth = SIZE.chip,
  }: {
    tokens: readonly CostChip[];
    digits?: 1 | 2;
    selected?: number;
    onselect?: (i: number) => void;
    minWidth?: string;
  } = $props();

  let maxBits = $derived(Math.max(...tokens.map((t) => t.bits), 1));
</script>

{#snippet body(t: CostChip)}
  <span class="p">{t.piece}</span>
  <i>{fmtBits(t.bits, digits)}</i>
  <!-- Track + fill, not a bare bar: a bar alone collapsed to a stub for a
       near-free token, which reads as a rendering fault instead of "this one
       was almost free". An empty track says "almost nothing". -->
  <div class="bartrack"><i class="fill" style:width="{(100 * t.bits) / maxBits}%"></i></div>
{/snippet}

<div class="toks" style:--chip-min={minWidth}>
  {#each tokens as t, idx (idx)}
    <Chip class="tok" block mono selected={selected === idx} onclick={onselect ? () => onselect(idx) : undefined}>
      {@render body(t)}
    </Chip>
  {/each}
</div>

<style>
  /* One grid, not a flex wrap: chips sized by their own content made a run of
     one-character pieces ('.', '/') into a ragged strip of near-invisible
     boxes. Equal columns line them up whatever the pieces are. */
  .toks {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--chip-min), 1fr));
    gap: var(--s-2);
    margin-top: var(--s-3);
  }
  /* The chip's own shell (surface, border, radius, padding, leading) is
     Chip.svelte's. What is this figure's is the three-row layout inside it:
     the piece, its cost, its bar. `:global` only where the selector's subject
     is the chip element itself, which this component does not own. */
  .toks .p { display: block; overflow-wrap: anywhere; color: var(--txt); }
  .toks :global(.tok > i) {
    display: block;
    font-style: normal;
    color: var(--dim);
    font-size: var(--fs-2xs);
    font-variant-numeric: tabular-nums;
    margin-top: 1px; /* hairline */
  }
  .toks .bartrack { margin-top: var(--s-1); }
  .toks .fill { margin: 0; font-style: normal; }
</style>
