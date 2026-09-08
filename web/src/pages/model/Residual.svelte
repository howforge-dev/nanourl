<script lang="ts">
  // Residual stream panel: n_layer rows x up to 128 buckets of the d_model
  // channels, one row per layer (drawFingerprint), a per-layer full-resolution
  // detail view (drawFpDetail) and the pad-size line chart (drawNorms).
  import { onMount } from 'svelte';
  import type { Info, TraceResult } from '../../lib/codec/types';
  import type { TooltipApi } from './Tooltip.svelte';
  import { fmtExact } from '../../lib/format';
  import Panel from '../../lib/ui/Panel.svelte';
  import Button from '../../lib/ui/Button.svelte';
  import ScrollBox from '../../lib/ui/ScrollBox.svelte';
  import { CANVAS_SCALE, COLOR } from '../../lib/ui/tokens';

  /** The detail strip's height in CSS pixels. Its backing store is this times
   *  `CANVAS_SCALE`, so the two halves of one decision cannot drift. */
  const DETAIL_H = 64;

  let {
    info,
    trace,
    tooltip,
  }: {
    info: Info;
    trace: TraceResult | null;
    tooltip: TooltipApi;
  } = $props();

  const BH = 12;

  let panel: ReturnType<typeof Panel> | undefined = $state();
  let open = $state(false);
  let fpCanvas: HTMLCanvasElement | undefined = $state();
  let detailCanvas: HTMLCanvasElement | undefined = $state();

  // Placeholder until onMount sets the real full range from `info` — a
  // lifecycle callback, rather than this declaration, is where Svelte wants
  // a one-time prop read seeding mutable state to happen.
  let fpView = $state<{ c0: number; c1: number }>({ c0: 0, c1: 1 });
  let fpDrag: { x0: number; x1: number } | null = $state(null);
  let fpSel = $state(-1);
  let hoverLayer: number | null = $state(null);

  onMount(() => {
    fpView = { c0: 0, c1: info.d_model };
  });

  let geom = $derived.by(() => {
    const range = fpView.c1 - fpView.c0;
    const cells = Math.min(128, range);
    const per = range / cells;
    const BW = Math.max(5, Math.floor(640 / cells));
    return { cells, per, BW };
  });
  let zoomed = $derived(fpView.c0 > 0 || fpView.c1 < info.d_model);

  function draw(): void {
    const cv = fpCanvas;
    if (!cv || !trace) return;
    const { cells, per, BW } = geom;
    cv.width = cells * BW;
    cv.height = info.n_layer * BH;
    const g = cv.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, cv.width, cv.height);
    trace.layers.forEach((lt, l) => {
      let mx = 0;
      for (let c = fpView.c0; c < fpView.c1; c++) mx = Math.max(mx, Math.abs(lt.x[c]));
      for (let b = 0; b < cells; b++) {
        let v = 0;
        const lo = fpView.c0 + Math.floor(b * per);
        const hi = fpView.c0 + Math.floor((b + 1) * per);
        for (let c = lo; c < Math.max(hi, lo + 1); c++) if (Math.abs(lt.x[c]) > Math.abs(v)) v = lt.x[c];
        const t = Math.min(1, Math.abs(v) / (mx || 1)) ** 0.5;
        g.fillStyle = v >= 0 ? `rgba(88,166,255,${t})` : `rgba(210,153,34,${t})`;
        g.fillRect(b * BW, l * BH, BW - 1, BH - 1);
      }
    });
    if (fpSel >= 0) {
      g.strokeStyle = COLOR.acc;
      g.strokeRect(0.5, fpSel * BH + 0.5, cells * BW - 1, BH - 2);
    }
    if (fpDrag) {
      g.strokeStyle = COLOR.acc;
      g.setLineDash([7, 4]);
      g.strokeRect(Math.min(fpDrag.x0, fpDrag.x1), 0.5, Math.abs(fpDrag.x1 - fpDrag.x0), info.n_layer * BH - 1);
      g.setLineDash([]);
    }
  }

  function drawDetail(): void {
    const cv = detailCanvas;
    if (!cv || !trace || fpSel < 0 || fpSel >= trace.layers.length) return;
    const x = trace.layers[fpSel].x;
    const BW = 2;
    const H = DETAIL_H * CANVAS_SCALE;
    const mid = H / 2;
    cv.width = info.d_model * BW;
    cv.height = H;
    const g = cv.getContext('2d');
    if (!g) return;
    g.fillStyle = COLOR.bg;
    g.fillRect(0, 0, cv.width, H);
    let mx = 0;
    x.forEach((v) => {
      mx = Math.max(mx, Math.abs(v));
    });
    for (let c = 0; c < info.d_model; c++) {
      const h = Math.max(1, (Math.abs(x[c]) / (mx || 1)) * (mid - 4));
      g.fillStyle = x[c] >= 0 ? COLOR.acc : COLOR.warn;
      g.fillRect(c * BW, x[c] >= 0 ? mid - h : mid, BW - (BW > 1 ? 1 : 0), h);
    }
    g.fillStyle = COLOR.line;
    g.fillRect(0, mid, cv.width, 1);
  }

  let detailTop = $derived.by(() => {
    if (!trace || fpSel < 0 || fpSel >= trace.layers.length) return { max: 0, dominant: [] as { c: number; v: number }[] };
    const x = trace.layers[fpSel].x;
    let mx = 0;
    x.forEach((v) => (mx = Math.max(mx, Math.abs(v))));
    const order = [...x.keys()].sort((a, b) => Math.abs(x[b]) - Math.abs(x[a])).slice(0, 6);
    return { max: mx, dominant: order.map((c) => ({ c, v: x[c] })) };
  });

  $effect(() => {
    if (!open) return;
    void trace;
    void fpView;
    void fpDrag;
    void fpSel;
    draw();
  });
  $effect(() => {
    if (!open) return;
    void trace;
    void fpSel;
    drawDetail();
  });

  function bucketAt(px: number): [number, number] | null {
    const { cells, per, BW } = geom;
    const b = Math.floor(px / BW);
    if (b < 0 || b >= cells) return null;
    const lo = fpView.c0 + Math.floor(b * per);
    const hi = Math.max(fpView.c0 + Math.floor((b + 1) * per) - 1, lo);
    return [lo, hi];
  }

  function onDown(ev: MouseEvent): void {
    const r = fpCanvas!.getBoundingClientRect();
    fpDrag = { x0: ev.clientX - r.left, x1: ev.clientX - r.left };
    ev.preventDefault();
  }
  function onMove(ev: MouseEvent): void {
    const r = fpCanvas!.getBoundingClientRect();
    if (fpDrag) {
      fpDrag = { x0: fpDrag.x0, x1: ev.clientX - r.left };
      return;
    }
    if (!trace) return;
    const l = Math.floor((ev.clientY - r.top) / BH);
    const bk = bucketAt(ev.clientX - r.left);
    if (l < 0 || l >= info.n_layer || !bk) {
      tooltip.hide();
      return;
    }
    const [lo, hi] = bk;
    let best = lo;
    for (let c = lo; c <= hi; c++) if (Math.abs(trace.layers[l].x[c]) > Math.abs(trace.layers[l].x[best])) best = c;
    const v = trace.layers[l].x[best];
    tooltip.show(
      ev,
      `layer ${l} · ${lo === hi ? `channel ${lo}` : `channels ${lo}–${hi}, strongest #${best}`} · ${v >= 0 ? '+' : ''}${v}<br>drag ↔ to zoom · click row for all channels`,
    );
  }
  function onUp(ev: MouseEvent): void {
    if (!fpDrag) return;
    const r = fpCanvas!.getBoundingClientRect();
    const a = Math.min(fpDrag.x0, fpDrag.x1);
    const b = Math.max(fpDrag.x0, fpDrag.x1);
    fpDrag = null;
    if (b - a < 6) {
      const l = Math.floor((ev.clientY - r.top) / BH);
      if (l >= 0 && l < info.n_layer) fpSel = l === fpSel ? -1 : l;
      return;
    }
    const range = fpView.c1 - fpView.c0;
    const { cells, BW } = geom;
    let c0 = fpView.c0 + Math.floor((a / (cells * BW)) * range);
    let c1 = fpView.c0 + Math.ceil((b / (cells * BW)) * range);
    if (c1 - c0 < 8) {
      const m = (c0 + c1) >> 1;
      c0 = m - 4;
      c1 = m + 4;
    }
    fpView = { c0: Math.max(0, c0), c1: Math.min(info.d_model, c1) };
  }
  function onLeave(): void {
    tooltip.hide();
    if (fpDrag) fpDrag = null;
  }
  function resetZoom(): void {
    fpView = { c0: 0, c1: info.d_model };
  }
  function onDetailMove(ev: MouseEvent): void {
    if (!trace || fpSel < 0) return;
    const r = detailCanvas!.getBoundingClientRect();
    const c = Math.floor((ev.clientX - r.left) / 1);
    const x = trace.layers[fpSel].x;
    if (c < 0 || c >= x.length) {
      tooltip.hide();
      return;
    }
    tooltip.show(ev, `channel ${c} · ${x[c] >= 0 ? '+' : ''}${x[c]}`);
  }

  // ---- norms chart (SVG) ----
  const NW = 260;
  const NH = 160;
  const NP = 26;
  let series = $derived.by(() => {
    if (!trace) return [];
    return [
      { name: 'in', vals: trace.layers.map((l) => l.norm_in), col: COLOR.dim },
      { name: '+attn', vals: trace.layers.map((l) => l.norm_attn), col: COLOR.warn },
      { name: '+think', vals: trace.layers.map((l) => l.norm_mlp), col: COLOR.acc },
    ];
  });
  let normMax = $derived(series.length ? Math.max(...series.flatMap((s) => s.vals)) : 1);
  const nx = (i: number): number => NP + (i * (NW - NP - 8)) / (info.n_layer - 1);
  const ny = (v: number, mx: number): number => NH - 18 - (v / mx) * (NH - 34);
  function onNormsMove(ev: MouseEvent): void {
    if (!trace) return;
    const svg = ev.currentTarget as SVGSVGElement;
    const r = svg.getBoundingClientRect();
    const l = Math.max(0, Math.min(info.n_layer - 1, Math.round((ev.clientX - r.left - NP) / ((NW - NP - 8) / (info.n_layer - 1)))));
    hoverLayer = l;
    const t = trace.layers[l];
    const f = (v: number) => (v >= 1000 ? fmtExact(Math.round(v)) : v.toFixed(1));
    tooltip.show(
      ev,
      `layer ${l}<br>in ${f(t.norm_in)}<br>+attn ${f(t.norm_attn)} (Δ ${f(t.norm_attn - t.norm_in)})<br>+think ${f(t.norm_mlp)} (Δ ${f(t.norm_mlp - t.norm_attn)})`,
    );
  }
  function onNormsLeave(): void {
    tooltip.hide();
    hoverLayer = null;
  }

  export async function focus(): Promise<void> {
    await panel?.focus();
  }
</script>

<Panel bind:this={panel} bind:open title="residual stream">
  {#snippet sub()}
    the {info.d_model} numbers each layer hands the next, one row per layer — each cell shows the strongest of
    several neighboring channels (blue positive, amber negative), each row scaled to its own maximum; hover for
    the channels behind a cell, drag sideways to zoom into a channel range, double-click to reset, click a row
    for that layer's full vector (click again to close)
  {/snippet}
  {#if open}
    {#if !trace}
      <p class="note">select a token above…</p>
    {:else}
      <div class="layout">
        <ScrollBox class="fpwrap">
          <canvas
            class="attn"
            bind:this={fpCanvas}
            style:width="{geom.cells * geom.BW}px"
            style:height="{info.n_layer * BH}px"
            onmousedown={onDown}
            onmousemove={onMove}
            onmouseup={onUp}
            onmouseleave={onLeave}
            ondblclick={resetZoom}
          ></canvas>
        </ScrollBox>
        <div class="normsbox">
          <svg width={NW} height={NH} role="img" aria-label="pad size per layer" onmousemove={onNormsMove} onmouseleave={onNormsLeave}>
            <line x1={NP} y1={NH - 18} x2={NW - 8} y2={NH - 18} stroke={COLOR.line} />
            {#if hoverLayer !== null}
              <line x1={nx(hoverLayer)} y1="14" x2={nx(hoverLayer)} y2={NH - 18} stroke={COLOR.line} />
            {/if}
            {#each series as s (s.name)}
              <polyline fill="none" stroke={s.col} stroke-width="1.6" points={s.vals.map((v, i) => `${nx(i)},${ny(v, normMax)}`).join(' ')} />
              {#if hoverLayer !== null}
                <circle cx={nx(hoverLayer)} cy={ny(s.vals[hoverLayer], normMax)} r="3" fill={s.col} />
              {/if}
            {/each}
            <text x={NP} y={NH - 5}>L0</text>
            <text x={NW - 26} y={NH - 5}>L{info.n_layer - 1}</text>
            <text x="4" y={ny(normMax, normMax) + 8}>{Math.round(normMax)}</text>
            {#each series as s, i (s.name)}
              <rect x={NP + i * 62} y="2" width="8" height="8" fill={s.col} />
              <text x={NP + i * 62 + 12} y="10">{s.name}</text>
            {/each}
          </svg>
          <div class="caption">pad size per layer: in / +attn / +think</div>
        </div>
      </div>
      {#if zoomed}
        <Button size="sm" onclick={resetZoom}>reset channel zoom</Button>
      {/if}
      {#if fpSel >= 0}
        <div class="detail">
          <div class="stat">
            layer <b>{fpSel}</b> exit — all {info.d_model} channels, tallest bar = {detailTop.max.toFixed(1)} · dominant:
            {#each detailTop.dominant as d, i (d.c)}{i > 0 ? ' · ' : ' '}<span class="mono"
                >#{d.c} {d.v >= 0 ? '+' : ''}{d.v.toFixed(1)}</span
              >{/each}
          </div>
          <ScrollBox>
            <canvas
              class="attn"
              bind:this={detailCanvas}
              style:width="{info.d_model}px"
              style:height="{DETAIL_H}px"
              onmousemove={onDetailMove}
              onmouseleave={() => tooltip.hide()}
            ></canvas>
          </ScrollBox>
        </div>
      {/if}
    {/if}
  {/if}
</Panel>

<style>
  /* .note = transient "still working" placeholder (see the e2e smoke test's
     per-panel wait); .hint = a permanent caption that happens to share the
     same look — kept separate so that wait stays a reliable "this panel's
     lazy first-open work has settled" signal. */
  .layout { display: flex; gap: var(--s-5); flex-wrap: wrap; align-items: flex-start; margin-top: var(--s-2); }
  /* The heatmap sits at its own width when the column has room for it and
     scrolls inside itself (ScrollBox) when it does not: `flex: 0 1 auto`
     takes the canvas's 640 px as the basis, and `min-width: 0` is what lets a
     flex child shrink below its content instead of wrapping onto a new row.
     `:global`, because the scroller is ScrollBox.svelte's element — the
     `.layout` prefix keeps the rule this panel's. */
  .layout :global(.fpwrap) { flex: 0 1 auto; min-width: 0; }
  .normsbox { flex: none; max-width: var(--m-side); }
  @media (max-width: 560px) {
    .layout { flex-direction: column; }
    .layout :global(.fpwrap) { flex: none; width: 100%; }
  }
  .detail { margin-top: var(--s-3); }
</style>
