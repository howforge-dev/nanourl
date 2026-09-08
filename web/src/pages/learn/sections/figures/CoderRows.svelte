<script lang="ts">
  // Real interval-slicing data for the worked HN example: each row is one
  // token's actual clo/chi, its slice of that step's fresh [0,1) probability
  // line (rust/urlcodec's codec_encode; see web/scripts/fixtures/hn-trace.json).
  // Every row is drawn at full width because the coder renormalises after each
  // token: row i+1's line IS row i's kept slice, zoomed. The funnel between two
  // rows draws that zoom, so the nesting is visible even though every bar is
  // the same width.
  import { numbers } from '../../../../lib/numbers';
  import { COLOR } from '../../../../lib/ui/tokens';

  /** `from` picks the window: token index (0-based) of the first row. */
  let { rows, from = 0, detailed = false }: { rows: number; from?: number; detailed?: boolean } = $props();

  const X0 = 20;
  const X1 = 620;
  const W = X1 - X0;
  const ROW_H = 64;
  /** the bar's stroke width; it reaches BAR/2 either side of its own line */
  const BAR = 10;
  /** a row label's baseline, above its bar */
  const LABEL_DY = 16;
  /** `.big` (--fs-sm) mono ink, relative to its own baseline */
  const LABEL_ASC = 11;
  /** a kept slice narrower than this is drawn this wide: a late token's slice
   *  of a fresh line can be a fraction of a pixel, and an invisible slice reads
   *  as "nothing kept", the opposite of what happened */
  const MIN_SLICE = 12;
  /** v's label baseline, below the last bar */
  const V_LABEL_DY = 24;
  const toks = $derived(numbers.hn.tokens.slice(from, from + rows));
  const y = (i: number) => 30 + i * ROW_H;
  /** the ink-free band under bar `i`, stopping short of row `i+1`'s label */
  const gapTop = (i: number) => y(i) + BAR / 2 + 2;
  const gapBot = (i: number) => y(i + 1) - LABEL_DY - LABEL_ASC - 3;
  /** the drawn slice edges: the real ones, widened to MIN_SLICE inside the bar */
  const slice = (t: { clo?: number; chi?: number }) => {
    const x1 = X0 + (t.clo ?? 0) * W;
    let x2 = X0 + (t.chi ?? 1) * W;
    if (x2 - x1 < MIN_SLICE) x2 = Math.min(X1, x1 + MIN_SLICE);
    return { x1, x2 };
  };
  /** the slice as a share of its line, worded for the label beside it */
  const share = (t: { clo?: number; chi?: number }) => {
    const p = ((t.chi ?? 1) - (t.clo ?? 0)) * 100;
    return p >= 99.5 ? '~100% kept' : p >= 10 ? `${p.toFixed(0)}% kept` : p >= 0.1 ? `${p.toFixed(1)}% kept` : `${p.toPrecision(2)}% kept`;
  };
  // Height reaches just past the LAST row, not one whole row past it: a row's
  // worth of empty card below the final line reads as a row that failed to
  // render. `detailed` adds the two lanes below the last bar: v's own label,
  // then the caption naming it.
  const height = $derived(y(Math.max(0, rows - 1)) + (detailed ? 56 : 18));
  // Each row's line as a range of the FIRST row's [0,1): row i+1 is row i's
  // kept slice, so its ends are that slice's ends mapped through every zoom
  // above.
  const ranges = $derived.by(() => {
    const out: [number, number][] = [[0, 1]];
    for (const t of toks) {
      const [lo, hi] = out[out.length - 1];
      out.push([lo + (hi - lo) * (t.clo ?? 0), lo + (hi - lo) * (t.chi ?? 1)]);
    }
    return out;
  });
  const fmt = (x: number) => (x === 0 ? '0' : x === 1 ? '1' : x.toPrecision(4).replace(/\.?0+$/, '').replace(/e-(\d)$/, 'e-0$1'));
  /** A range too narrow for four digits is given as a start and a width,
   *  or both ends would print the same number. */
  const rangeText = ([lo, hi]: [number, number]) =>
    hi - lo < 1e-3 ? `${fmt(lo)}…, width ${(hi - lo).toExponential(1)}` : `${fmt(lo)}, ${fmt(hi)}`;
  // v is one number, but each row's line is a different zoom of [0,1), so v
  // sits at a different fraction of each bar. Working back from the last row,
  // where it is the midpoint of the kept slice: in row i it is that position
  // mapped into row i's slice.
  const vAt = $derived.by(() => {
    const pos = new Array<number>(toks.length);
    let v = 0.5;
    for (let i = toks.length - 1; i >= 0; i--) {
      const clo = toks[i].clo ?? 0;
      const chi = toks[i].chi ?? 1;
      v = clo + (chi - clo) * v;
      pos[i] = v;
    }
    return pos.map((f) => X0 + f * W);
  });
</script>

<svg viewBox="0 0 640 {height}" width="640" height={height}>
  {#each toks as t, i (t.piece + i)}
    {@const s = slice(t)}
    {@const last = i === toks.length - 1}
    {#if !last}
      <!-- The zoom: this row's kept slice becomes the whole of the next row's
           line. The funnel stops at the next label's lane so it never runs
           through the words. -->
      <polygon
        points="{s.x1},{gapTop(i)} {s.x2},{gapTop(i)} {X1},{gapBot(i)} {X0},{gapBot(i)}"
        fill={COLOR.acc}
        fill-opacity="0.22"
      />
      <line x1={s.x1} y1={gapTop(i)} x2={X0} y2={gapBot(i)} stroke={COLOR.acc} stroke-opacity="0.7" />
      <line x1={s.x2} y1={gapTop(i)} x2={X1} y2={gapBot(i)} stroke={COLOR.acc} stroke-opacity="0.7" />
      <text x={(X0 + X1) / 2} y={(gapTop(i) + gapBot(i)) / 2 + 4} text-anchor="middle" fill={COLOR.acc}>
        {i === 0 ? 'zoom: this slice becomes the next line' : 'next line'} = [{rangeText(ranges[i + 1])}){i === 0 ? '' : ' of the first line'}
      </text>
    {/if}
    <line x1={X0} y1={y(i)} x2={X1} y2={y(i)} stroke={COLOR.line} stroke-width={BAR} stroke-linecap="round" />
    <line x1={s.x1} y1={y(i)} x2={s.x2} y2={y(i)} stroke={last ? COLOR.ok : COLOR.acc} stroke-width={BAR} stroke-linecap="round" />
    <text x={X0} y={y(i) - LABEL_DY} class="big">
      token {from + i + 1} (<tspan class="piece-label">{t.piece}</tspan>) — its slice of this line
    </text>
    <!-- The share, beside the slice's end (or before it when the slice fills
         the line), is the number the caption's claim rests on. -->
    {#if s.x2 < X1 - 80}
      <text x={s.x2 + 8} y={y(i) + 4} fill={last ? COLOR.ok : COLOR.acc}>{share(t)}</text>
    {:else}
      <text x={X1} y={y(i) - LABEL_DY} text-anchor="end" fill={last ? COLOR.ok : COLOR.acc}>{share(t)}</text>
    {/if}
    {#if detailed}
      <circle cx={vAt[i]} cy={y(i)} r="4.5" fill={COLOR.txt} stroke={COLOR.bg} stroke-width="1.5" />
    {/if}
  {/each}
  {#if detailed}
    {@const last = toks.length - 1}
    <!-- v's label gets its own lane under the last bar; beside the dot it
         would sit on the bar. -->
    <text x={vAt[last]} y={y(last) + V_LABEL_DY} class="big" text-anchor="middle" fill={COLOR.txt}>v</text>
    <text x={X0} y={height - 8}>
      the white dot is v: in every kept slice; any number in the last one is a valid code
    </text>
  {/if}
</svg>

<style>
  .piece-label { font-family: var(--font-mono); fill: var(--dim); }
</style>
