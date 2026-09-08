<script lang="ts">
  // Attention panel: one canvas per layer, rows = heads, cols = positions.
  // Cell width adapts so short URLs get big readable cells and long ones stay
  // compact.

  import type { Info, LayerTrace, TraceResult } from '../../lib/codec/types';
  import type { TooltipApi } from './Tooltip.svelte';
  import { escapeHtml } from './Tooltip.svelte';
  import Panel from '../../lib/ui/Panel.svelte';
  import ScrollBox from '../../lib/ui/ScrollBox.svelte';
  import { fmtShare } from '../../lib/format';

  let {
    info,
    trace,
    selLayer,
    onSelectLayer,
    tooltip,
  }: {
    info: Info;
    trace: TraceResult | null;
    selLayer: number;
    onSelectLayer: (l: number) => void;
    tooltip: TooltipApi;
  } = $props();

  const CH = 9;
  const cellW = (t: number): number => Math.max(9, Math.min(34, Math.floor(680 / t)));

  function heat(w: number): string {
    const t = Math.min(1, Math.max(0, w));
    const a = [13, 17, 23];
    const b = [88, 166, 255];
    const c = [230, 237, 243];
    const mix = (u: number[], v: number[], f: number) => u.map((x, i) => Math.round(x + (v[i] - x) * f));
    const rgb = t < 0.6 ? mix(a, b, t / 0.6) : mix(b, c, (t - 0.6) / 0.4);
    return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  }

  let panel: ReturnType<typeof Panel> | undefined = $state();
  let open = $state(false);
  let canvases: (HTMLCanvasElement | undefined)[] = $state([]);

  function drawLayer(cv: HTMLCanvasElement | undefined, lt: LayerTrace, t: number): void {
    if (!cv) return;
    const CW = cellW(t);
    cv.width = t * CW;
    cv.height = info.n_head * CH;
    const g = cv.getContext('2d');
    if (!g) return;
    lt.attn.forEach((hrow, h) => {
      hrow.forEach((w, p) => {
        g.fillStyle = heat(w);
        g.fillRect(p * CW, h * CH, CW - 1, CH - 1);
      });
    });
  }

  $effect(() => {
    if (!open || !trace) return;
    const t = trace.pieces.length;
    trace.layers.forEach((lt, l) => drawLayer(canvases[l], lt, t));
  });

  function onCellMove(ev: MouseEvent, l: number, lt: LayerTrace, t: number): void {
    const cv = ev.currentTarget as HTMLCanvasElement;
    const r = cv.getBoundingClientRect();
    const CW = cellW(t);
    const p = Math.floor((ev.clientX - r.left) / CW);
    const h = Math.floor((ev.clientY - r.top) / CH);
    if (!trace || p < 0 || p >= t || h < 0 || h >= info.n_head) {
      tooltip.hide();
      return;
    }
    tooltip.show(
      ev,
      `L${l} · head ${h} → <b>${escapeHtml(trace.pieces[p])}</b><br>weight ${fmtShare(lt.attn[h][p], 2)}`,
    );
  }

  /** The attention panel is a horizontal strip of per-layer blocks, so opening
   *  it is not enough: the selected layer has to be brought into the strip's
   *  own scroll port too. Runs after Panel has opened and scrolled the card. */
  let wrapEl: HTMLDivElement | undefined = $state();

  function scrollToSelectedLayer(): void {
    wrapEl?.querySelector(`.lay[data-layer="${selLayer}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  export async function focus(): Promise<void> {
    await panel?.focus();
  }
</script>

<Panel bind:this={panel} bind:open title="attention" afterFocus={scrollToSelectedLayer}>
  {#snippet sub()}
    the pass that predicts the selected token: each cell is one head's weight on one previous position (rows =
    {info.n_head} heads, one block per layer; brighter = more attention)
  {/snippet}
  {#if open}
    {#if !trace}
      <p class="note">select a token above…</p>
    {:else}
      {@const t = trace.pieces.length}
      <ScrollBox class="attnwrap" style="margin-top: var(--s-2)" bind:element={wrapEl}>
        <div>
          {#each trace.layers as lt, l (l)}
            <div class="lay well" class:sel={l === selLayer} data-layer={l}>
              <span
                class="lab"
                role="button"
                tabindex="0"
                onclick={() => onSelectLayer(l === selLayer ? -1 : l)}
                onkeydown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onSelectLayer(l === selLayer ? -1 : l);
                }}>L{l}</span
              >
              <canvas
                class="attn"
                bind:this={canvases[l]}
                style:width="{t * cellW(t)}px"
                style:height="{info.n_head * CH}px"
                onmousemove={(ev) => onCellMove(ev, l, lt, t)}
                onmouseleave={() => tooltip.hide()}
              ></canvas>
            </div>
          {/each}
        </div>
        <div class="collabels">
          {#each trace.pieces as p, i (i)}
            <span style:width="{cellW(t)}px">{p}</span>
          {/each}
        </div>
      </ScrollBox>
    {/if}
  {/if}
</Panel>

<style>
  /* The surface is app.css's `.well`; this is the row's own layout. */
  .lay {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    margin: var(--s-2) 0;
    width: max-content;
    padding: var(--s-1) var(--s-2);
    border-radius: var(--r-4);
  }
  .lay .lab {
    width: var(--m-label);
    font: var(--fs-2xs) var(--font-mono);
    color: var(--dim);
    text-align: right;
    flex: none;
    cursor: pointer;
  }
  .lay.sel { border-color: var(--acc); }
  .lay.sel .lab { color: var(--acc); }
  /* Aligned with the canvases, not with a number: the label column plus the
     row's own left padding and gap is exactly where a canvas starts. */
  .collabels { display: flex; margin-left: calc(var(--m-label) + var(--s-1) + var(--s-3)); gap: 0; }
  .collabels span { font: var(--fs-micro) var(--font-mono); color: var(--dim); writing-mode: vertical-rl; max-height: var(--m-tick); overflow: hidden; }
</style>
