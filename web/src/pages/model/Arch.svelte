<script module lang="ts">
  export type GotoTarget = 'toks' | 'atlas' | 'wpe' | 'attn' | 'readout' | 'coder' | 'bits';
</script>

<script lang="ts">
  // Architecture panel: the whole pipeline, every tensor at its real shape.
  // Every size comes from `info`, never a hardcoded constant, so this reads
  // correctly whatever shape ships next.
  import type { Info } from '../../lib/codec/types';
  // Never hard-code a model figure in web/ — the tokenizer's
  // 24-character cap already lives in numbers.static.maxTokenLength.
  import { numbers } from '../../lib/numbers';
  import { fmtBytes, fmtExact } from '../../lib/format';
  import Panel from '../../lib/ui/Panel.svelte';
  import Button from '../../lib/ui/Button.svelte';
  import ScrollBox from '../../lib/ui/ScrollBox.svelte';

  let {
    info,
    selLayer,
    onGoto,
  }: {
    info: Info;
    selLayer: number;
    onGoto: (target: GotoTarget | { layer: number }) => void;
  } = $props();

  // shipped int4-g64 bytes per weight: 4 bits of payload + a 34/32 per-group
  // overhead for the f16 scale (34 bytes carry 32 nibble-packed weights).
  // Labelled MiB, not MB: the divisor is 2^20, and the same figure is quoted
  // as MiB on the learn page and in the status line.
  const weightsMiB = (w: number): string => fmtBytes((w * 4.25) / 8);

  let headDim = $derived(info.d_model / info.n_head);
  let layerIdx = $derived(Array.from({ length: info.n_layer }, (_, i) => i));
</script>

<!-- The one panel with no focus(): nothing deep-links to the architecture
     table, it is the index the other panels are reached FROM. Open by
     default, and still collapsible. -->
<Panel title="architecture" open>
  {#snippet sub()}
    the whole pipeline, every tensor at its real shape; sizes are the shipped int4-g64 bytes (4.25 bits/weight).
    Every row links to its live view in the panels below.
  {/snippet}
  <!-- One scroller for the whole pipeline: a row wider than the card is
       reachable rather than clipped. -->
  <ScrollBox>
  <div class="arch">
    <Button variant="well" block class="stage blk" onclick={() => onGoto('toks')}>
      <span>URL bytes → BPE tokenizer <span class="goto">↗</span></span>
      <span class="dims">{fmtExact(info.vocab)} pieces, {numbers.static.maxTokenLength}-char cap</span>
    </Button>
    <div class="conn"></div>
    <Button variant="well" block class="stage blk" onclick={() => onGoto('atlas')}>
      <span>token embedding <b>wte</b> (tied with output) <span class="goto">↗</span></span>
      <span class="dims">{fmtExact(info.vocab)}×{info.d_model} · {weightsMiB(info.vocab * info.d_model)}</span>
    </Button>
    <div class="conn"></div>
    <Button variant="well" block class="stage blk" onclick={() => onGoto('wpe')}>
      <span>+ position embedding <b>wpe</b> <span class="goto">↗</span></span>
      <span class="dims">{info.block}×{info.d_model} · {weightsMiB(info.block * info.d_model)}</span>
    </Button>
    <div class="conn"></div>
    <!-- Real <button>s, so Enter and Space are the browser's job rather than
         a hand-written keydown handler per row. -->
    <div class="layer-list well">
      {#each layerIdx as l (l)}
        <Button
          variant="well"
          block
          flush
          class="stage blk layer {l === selLayer ? 'sel' : ''}"
          onclick={() => onGoto({ layer: l === selLayer ? -1 : l })}
        >
          <span>layer {l} — LN → attention ({info.n_head} heads × {headDim}d) → LN → think (SwiGLU)</span>
          <span class="dims"
            >qkv {info.d_model}→{3 * info.d_model} · {weightsMiB(info.d_model * 3 * info.d_model)} | proj {weightsMiB(
              info.d_model * info.d_model,
            )} | think {info.d_model}→{info.d_mlp}→{info.d_model} · {weightsMiB(3 * info.d_model * info.d_mlp)}</span
          >
        </Button>
      {/each}
    </div>
    <div class="conn"></div>
    <Button variant="well" block class="stage blk" onclick={() => onGoto('readout')}>
      <span>final LayerNorm → tied head → logits <span class="goto">↗</span></span>
      <span class="dims">{info.d_model} → {fmtExact(info.vocab)}</span>
    </Button>
    <div class="conn"></div>
    <Button variant="well" block class="stage blk" onclick={() => onGoto('coder')}>
      <span>softmax (f64) → 24-bit tables → arithmetic coder <span class="goto">↗</span></span>
      <span class="dims">exact integer stream</span>
    </Button>
    <div class="conn"></div>
    <Button variant="well" block class="stage blk" onclick={() => onGoto('bits')}>
      <span>base64url / base79 string <span class="goto">↗</span></span>
      <span class="dims">what you share</span>
    </Button>
  </div>
  </ScrollBox>
</Panel>

<style>
  .arch { font: var(--fs-sm) var(--font-mono); }
  /* The rows are `<Button variant="well" block>`: surface, border, radius,
     cursor and the shared focus ring are the primitive's, and `block` is what
     puts the label left and the shape right. Only the pipeline's own layout is
     here — the indent under the connector, the monospace the panel is set in,
     and the sizing.

     `max-content` with a `min-width` floor, not a plain `width`: a row's label
     and its shape are both unbreakable runs of monospace, so at a narrow
     viewport their combined min-content width exceeds the card and the shape
     spills out of a fixed-width row, past the page's own edge. Sized to its
     content instead, the row stays whole and the panel scrolls. */
  .arch :global(.stage) {
    gap: var(--s-3);
    padding: var(--s-2) var(--s-3);
    margin-left: var(--s-4);
    width: max-content;
    min-width: calc(100% - var(--s-4));
    font: inherit;
  }
  /* The connector drops from the left edge of a row's CONTENT, which is the
     row's own indent plus its padding — derived, so moving either keeps the
     line under the text rather than beside it. */
  .arch .conn { border-left: var(--stroke) solid var(--line); height: var(--s-3); margin-left: calc(var(--s-4) + var(--s-3)); }
  .arch .dims { color: var(--dim); text-align: right; flex: none; }
  .arch :global(.stage.blk:hover), .arch :global(.stage.sel) { border-color: var(--acc); }
  /* The rows are `flush`; the list draws its own separators. */
  .arch .layer-list > :global(.stage:not(:last-child)) { border-bottom: var(--border); }
  .arch .goto { color: var(--acc); }
  /* The box around the layer rows. Its surface is `.well`; this is where it
     sits and how round it is. It deliberately does not clip: the ScrollBox
     around the whole pipeline is what makes an over-wide row reachable, and a
     clip here would hide one from the reader and from every scrollWidth
     assertion alike. */
  .arch .layer-list {
    margin-left: var(--s-4);
    border-radius: var(--r-4);
  }
  /* max-content + min-width:100% so a row still spans the whole scroll port
     when it is narrower than one, rather than stopping at its own content. */
  .arch :global(.stage.layer) {
    margin-left: 0;
    width: max-content;
    min-width: 100%;
  }
</style>
