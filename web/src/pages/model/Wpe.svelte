<script lang="ts">
  // Position embedding panel: the block position vectors projected to 2D
  // trace an ordered path — position is a learned ruler, not `block`
  // arbitrary labels. The dequantisation is web/src/lib/nurl.ts's dequantRows
  // (this is its only caller), over the `wpe` table at `info.wpe_offset`.
  //
  // The bytes are fetched here, one slice at a time, rather than read out of
  // a full JS-side copy of the artifact. `Codec.load({ keepModel: true })`
  // would allocate a second 124.8 MiB `Uint8Array` and pin it for the life of
  // the page — for this one ~340 KiB table and nothing else, on the page most
  // likely to be killed on iOS. `fetchModelSlice` reads only the chunk(s)
  // that cover the range, and they are Cache-API hits after the first visit.
  import { tick } from 'svelte';
  import type { Info } from '../../lib/codec/types';
  import { fetchModelSlice } from '../../lib/codec/loader';
  import { dequantRows, rowBytes } from '../../lib/nurl';
  import { numbers } from '../../lib/numbers';
  import type { TooltipApi } from './Tooltip.svelte';
  import Panel from '../../lib/ui/Panel.svelte';
  import ScrollBox from '../../lib/ui/ScrollBox.svelte';
  import { CANVAS_FONT, COLOR } from '../../lib/ui/tokens';

  let {
    info,
    tooltip,
  }: {
    info: Info;
    tooltip: TooltipApi;
  } = $props();

  // The mean tokens per URL over the eval set (numbers.ts, from the run
  // manifest) — marked on the curves below because that is where the ruler is
  // finely made and past which it fades. Not "most URLs finish under this":
  // it is a mean, and the distribution has a long tail.
  const AVG_URL_TOKENS = Math.round(numbers.meanTokensPerUrl);

  let panel: ReturnType<typeof Panel> | undefined = $state();
  let open = $state(false);
  let computed = $state(false);
  let pathCanvas: HTMLCanvasElement | undefined = $state();
  let pathWrap: HTMLDivElement | undefined = $state();

  interface WpeData {
    pts: [number, number][];
    cosNext: Float32Array;
    norms: Float32Array;
    S: number;
  }
  let data: WpeData | null = $state(null);
  let error = $state('');

  // `started` latches synchronously, before the first await. The `$effect`
  // below guards on `!computed`, which is only set once the fetch resolves —
  // so without this latch, closing and reopening the panel during that fetch
  // schedules a second concurrent compute() and a duplicate ~340 KiB read.
  let started = false;

  async function compute(): Promise<void> {
    if (started) return;
    started = true;
    const BLK = info.block;
    const D = info.d_model;
    let slice: Uint8Array;
    try {
      slice = await fetchModelSlice(info.wpe_offset, BLK * rowBytes(D));
    } catch (e) {
      error = `could not read the position table: ${e instanceof Error ? e.message : String(e)}`;
      computed = true;
      return;
    }
    const w = dequantRows(slice, 0, BLK, D);
    const norms = new Float32Array(BLK);
    for (let i = 0; i < BLK; i++) {
      let n = 0;
      for (let c = 0; c < D; c++) n += w[i * D + c] * w[i * D + c];
      norms[i] = Math.sqrt(n);
    }
    const cosNext = new Float32Array(BLK - 1);
    for (let i = 0; i < BLK - 1; i++) {
      let d = 0;
      for (let c = 0; c < D; c++) d += w[i * D + c] * w[(i + 1) * D + c];
      cosNext[i] = d / (norms[i] * norms[i + 1] || 1);
    }
    // top-2 principal directions by power iteration over centered rows —
    // a lightweight, dependency-free 2D projection just for this trajectory
    // plot (independent of the atlas's server-side PCA(50)+UMAP).
    const mean = new Float32Array(D);
    for (let i = 0; i < BLK; i++) for (let c = 0; c < D; c++) mean[c] += w[i * D + c] / BLK;
    const X = new Float32Array(BLK * D);
    for (let i = 0; i < BLK; i++) for (let c = 0; c < D; c++) X[i * D + c] = w[i * D + c] - mean[c];
    const pc = (deflate: Float32Array | null): Float32Array => {
      let v = new Float32Array(D).fill(1 / Math.sqrt(D));
      for (let it = 0; it < 30; it++) {
        const s1 = new Float32Array(BLK);
        for (let i = 0; i < BLK; i++) {
          let d = 0;
          for (let c = 0; c < D; c++) d += X[i * D + c] * v[c];
          s1[i] = d;
        }
        const nv = new Float32Array(D);
        for (let i = 0; i < BLK; i++) for (let c = 0; c < D; c++) nv[c] += X[i * D + c] * s1[i];
        if (deflate) {
          let d = 0;
          for (let c = 0; c < D; c++) d += nv[c] * deflate[c];
          for (let c = 0; c < D; c++) nv[c] -= d * deflate[c];
        }
        let n = 0;
        for (let c = 0; c < D; c++) n += nv[c] * nv[c];
        n = Math.sqrt(n) || 1;
        for (let c = 0; c < D; c++) v[c] = nv[c] / n;
      }
      return v;
    };
    const v1 = pc(null);
    const v2 = pc(v1);
    const pts: [number, number][] = [];
    for (let i = 0; i < BLK; i++) {
      let a = 0;
      let b = 0;
      for (let c = 0; c < D; c++) {
        a += X[i * D + c] * v1[c];
        b += X[i * D + c] * v2[c];
      }
      pts.push([a, b]);
    }
    const S = Math.min(440, Math.max(300, (pathWrap?.clientWidth ?? 800) - 40));
    data = { pts, cosNext, norms, S };
    computed = true;
  }

  function drawPath(): void {
    if (!data || !pathCanvas) return;
    const { pts, S } = data; // norms/cosNext aren't drawn here — see onPathMove's tooltip below
    const BLK = info.block;
    const cv = pathCanvas;
    cv.width = S * 2;
    cv.height = S * 2;
    const g = cv.getContext('2d');
    if (!g) return;
    g.fillStyle = COLOR.bg;
    g.fillRect(0, 0, S * 2, S * 2);
    let mnx = Infinity;
    let mxx = -Infinity;
    let mny = Infinity;
    let mxy = -Infinity;
    for (const [a, b] of pts) {
      mnx = Math.min(mnx, a);
      mxx = Math.max(mxx, a);
      mny = Math.min(mny, b);
      mxy = Math.max(mxy, b);
    }
    const px = (a: number) => 20 + ((a - mnx) / (mxx - mnx)) * (S * 2 - 40);
    const py = (b: number) => 20 + ((b - mny) / (mxy - mny)) * (S * 2 - 40);
    g.lineWidth = 1.4;
    for (let i = 0; i < BLK - 1; i++) {
      const t = i / BLK;
      g.strokeStyle = `rgba(${Math.round(88 + t * 51)},${Math.round(166 - t * 18)},${Math.round(255 - t * 106)},${0.9 - t * 0.78})`;
      g.beginPath();
      g.moveTo(px(pts[i][0]), py(pts[i][1]));
      g.lineTo(px(pts[i + 1][0]), py(pts[i + 1][1]));
      g.stroke();
    }
    for (let i = 0; i < BLK; i++) {
      const t = i / BLK;
      g.fillStyle = i <= 24 ? COLOR.txt : `rgba(139,148,158,${0.7 - t * 0.6})`;
      g.fillRect(px(pts[i][0]) - 1.5, py(pts[i][1]) - 1.5, 3, 3);
    }
    g.font = CANVAS_FONT;
    g.fillStyle = COLOR.txt;
    for (const i of [0, 2, 5, 10, 19, 40, 100, 250, 511].filter((i) => i < BLK)) {
      g.fillText(String(i), px(pts[i][0]) + 6, py(pts[i][1]) - 5);
    }
  }

  function onPathMove(ev: MouseEvent): void {
    if (!data || !pathCanvas) return;
    const { pts, norms, cosNext, S } = data;
    const r = pathCanvas.getBoundingClientRect();
    let mnx = Infinity;
    let mxx = -Infinity;
    let mny = Infinity;
    let mxy = -Infinity;
    for (const [a, b] of pts) {
      mnx = Math.min(mnx, a);
      mxx = Math.max(mxx, a);
      mny = Math.min(mny, b);
      mxy = Math.max(mxy, b);
    }
    const px = (a: number) => 20 + ((a - mnx) / (mxx - mnx)) * (S * 2 - 40);
    const py = (b: number) => 20 + ((b - mny) / (mxy - mny)) * (S * 2 - 40);
    const mx = (ev.clientX - r.left) * 2;
    const my = (ev.clientY - r.top) * 2;
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const dx = px(pts[i][0]) - mx;
      const dy = py(pts[i][1]) - my;
      if (dx * dx + dy * dy < bd) {
        bd = dx * dx + dy * dy;
        best = i;
      }
    }
    if (bd > 900) {
      tooltip.hide();
      return;
    }
    tooltip.show(
      ev,
      `position ${best} · |wpe| ${norms[best].toFixed(2)}` + (best < pts.length - 1 ? ` · cos to next ${cosNext[best].toFixed(3)}` : ''),
    );
  }

  let curves = $derived.by(() => {
    if (!data) return null;
    const W = 330;
    const hh = 128;
    const gap = 26;
    const P = 34;
    const BLK = info.block;
    const lx = (i: number) => P + (Math.log(i + 1) / Math.log(BLK)) * (W - P - 10);
    const build = (vals: ArrayLike<number>, y0: number) => {
      let mx2 = -Infinity;
      let mn2 = Infinity;
      for (let i = 0; i < vals.length; i++) {
        mx2 = Math.max(mx2, vals[i]);
        mn2 = Math.min(mn2, vals[i]);
      }
      const y = (v: number) => y0 + hh - 14 - ((v - mn2) / ((mx2 - mn2) || 1)) * (hh - 30);
      const points: string[] = [];
      for (let i = 0; i < vals.length; i++) points.push(`${lx(i)},${y(vals[i])}`);
      return { mx2, mn2, points: points.join(' '), y0 };
    };
    const cos = build(data.cosNext, 0);
    const norm = build(data.norms, hh + gap);
    const markerI = Math.min(AVG_URL_TOKENS, BLK - 1);
    return { W, hh, gap, P, lx, cos, norm, markerI, height: 2 * hh + gap + 28 };
  });

  export async function focus(): Promise<void> {
    await panel?.focus();
  }

  $effect(() => {
    if (open && !started) {
      // yield one frame so the details element has laid out (clientWidth)
      // before sizing the canvas, then fetch + dequantise the wpe slice
      void tick().then(compute);
    }
  });
  $effect(() => {
    if (data) void tick().then(drawPath);
  });
</script>

<Panel bind:this={panel} bind:open title="position embedding">
  {#snippet sub()}
    what the model learned about "where am I": the {info.block} position vectors projected to 2D trace an
    <b>ordered path</b> — position is a learned ruler, not {info.block} arbitrary labels.
  {/snippet}
  {#if open}
    {#if !computed}
      <p class="note">computing…</p>
    {:else if error}
      <p class="err">{error}</p>
    {:else if data && curves}
      <div class="layout">
        <!-- The canvas is sized once, from the wrapper's width at the moment
             the panel first opens (`data.S`), and does not resize with the
             viewport — so a desktop-width open followed by a narrow viewport
             leaves a 440px canvas over a 305px card. It scrolls, like every
             other over-wide figure here; a clip would hide it instead. -->
        <ScrollBox bind:element={pathWrap}>
          <canvas
            class="attn"
            bind:this={pathCanvas}
            style:width="{data.S}px"
            style:height="{data.S}px"
            onmousemove={onPathMove}
            onmouseleave={() => tooltip.hide()}
          ></canvas>
          <div class="caption">positions 0→{info.block - 1} (bright → dark), consecutive positions connected. Hover for position.</div>
        </ScrollBox>
        <!-- The curves are a fixed 330px wide and the card's content box is
             ~321px at 375px, so the right edge has to be reachable: the same
             ScrollBox the attention and residual panels wrap their canvases
             in, rather than a clip that hides the overflow entirely. -->
        <ScrollBox>
          <svg width={curves.W} height={curves.height}>
            <text x={curves.P} y="10">how similar is each position to its next? cos(i, i+1)</text>
            <line x1={curves.P} y1={curves.cos.y0 + curves.hh - 14} x2={curves.W - 10} y2={curves.cos.y0 + curves.hh - 14} stroke={COLOR.line} />
            <polyline fill="none" stroke={COLOR.acc} stroke-width="1.5" points={curves.cos.points} />
            <line x1={curves.lx(curves.markerI)} y1="14" x2={curves.lx(curves.markerI)} y2={curves.cos.y0 + curves.hh - 14} stroke={COLOR.ok} stroke-dasharray="3,3" />
            <text x={curves.P - 26} y={curves.cos.y0 + 24}>{curves.cos.mx2.toFixed(2)}</text>
            <text x={curves.P - 26} y={curves.cos.y0 + curves.hh - 16}>{curves.cos.mn2.toFixed(2)}</text>

            <text x={curves.P} y={curves.norm.y0 + 10}>how strong is each position's signal? |wpe(i)|</text>
            <line x1={curves.P} y1={curves.norm.y0 + curves.hh - 14} x2={curves.W - 10} y2={curves.norm.y0 + curves.hh - 14} stroke={COLOR.line} />
            <polyline fill="none" stroke={COLOR.warn} stroke-width="1.5" points={curves.norm.points} />
            <line x1={curves.lx(curves.markerI)} y1={curves.norm.y0 + 14} x2={curves.lx(curves.markerI)} y2={curves.norm.y0 + curves.hh - 14} stroke={COLOR.ok} stroke-dasharray="3,3" />
            <text x={curves.P - 26} y={curves.norm.y0 + 24}>{curves.norm.mx2.toFixed(1)}</text>
            <text x={curves.P - 26} y={curves.norm.y0 + curves.hh - 16}>{curves.norm.mn2.toFixed(1)}</text>

            <text x={curves.lx(curves.markerI) - 14} y={2 * curves.hh + curves.gap + 6} fill={COLOR.ok}>↑ avg URL: {AVG_URL_TOKENS} tokens</text>
            <text x={curves.P} y={2 * curves.hh + curves.gap + 20}>position (log scale) → 0 … {info.block - 1}</text>
          </svg>
        </ScrollBox>
      </div>
    {/if}
  {/if}
</Panel>

<style>
  /* .note = transient "still working" placeholder (see the e2e smoke test's
     per-panel wait); .hint = a permanent caption that happens to share the
     same look — kept as a separate class so that wait stays a reliable
     "this panel's lazy first-open work has settled" signal. */
  /* This one caption sits above a wide canvas; unbounded it stretches the
     full card width and reads as a paragraph rather than a legend. */
  .caption { max-width: var(--m-legend); }
  .layout { display: flex; gap: var(--s-5); flex-wrap: wrap; align-items: flex-start; margin-top: var(--s-2); }
  /* min-width: 0 so a flex item may shrink below its content's min-content
     size; without it the ScrollBoxes inside can never actually narrow. */
  .layout > :global(*) { min-width: 0; max-width: 100%; }
</style>
