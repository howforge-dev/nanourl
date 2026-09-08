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

  let { rows, detailed = false }: { rows: number; detailed?: boolean } = $props();

  const X0 = 20;
  const X1 = 620;
  const W = X1 - X0;
  const ROW_H = 60;
  /** the bar's stroke width; it reaches BAR/2 either side of its own line */
  const BAR = 8;
  /** a row label's baseline, above its bar */
  const LABEL_DY = 14;
  /** `.big` (--fs-sm) mono ink, relative to its own baseline */
  const LABEL_ASC = 11;
  /** a kept slice narrower than this is drawn this wide: a late token's slice
   *  of a fresh line can be a fraction of a pixel, and an invisible slice reads
   *  as "nothing kept", the opposite of what happened */
  const MIN_SLICE = 6;
  /** v's label baseline, below the last bar */
  const V_LABEL_DY = 24;
  const toks = $derived(numbers.hn.tokens.slice(0, rows));
  const y = (i: number) => 30 + i * ROW_H;
  /** the ink-free band under bar `i`, stopping short of row `i+1`'s label */
  const gapTop = (i: number) => y(i) + BAR / 2 + 3;
  const gapBot = (i: number) => y(i + 1) - LABEL_DY - LABEL_ASC - 3;
  /** the drawn slice edges: the real ones, widened to MIN_SLICE inside the bar */
  const slice = (t: { clo?: number; chi?: number }) => {
    const x1 = X0 + (t.clo ?? 0) * W;
    let x2 = X0 + (t.chi ?? 1) * W;
    if (x2 - x1 < MIN_SLICE) x2 = Math.min(X1, x1 + MIN_SLICE);
    return { x1, x2 };
  };
  // Height reaches just past the LAST row, not one whole row past it: a row's
  // worth of empty card below the final line reads as a row that failed to
  // render. `detailed` adds the two lanes below the last bar: v's own label,
  // then the caption naming it.
  const height = $derived(y(Math.max(0, rows - 1)) + (detailed ? 56 : 16));
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
    {#if i < toks.length - 1}
      <!-- The zoom: this row's kept slice becomes the whole of the next row's
           line. The funnel stops at the next label's lane so it never runs
           through the words. -->
      <polygon
        points="{s.x1},{gapTop(i)} {s.x2},{gapTop(i)} {X1},{gapBot(i)} {X0},{gapBot(i)}"
        fill={COLOR.acc}
        fill-opacity="0.08"
      />
      <line x1={s.x1} y1={gapTop(i)} x2={X0} y2={gapBot(i)} stroke={COLOR.line2} stroke-dasharray="3,3" />
      <line x1={s.x2} y1={gapTop(i)} x2={X1} y2={gapBot(i)} stroke={COLOR.line2} stroke-dasharray="3,3" />
    {/if}
    <line x1={X0} y1={y(i)} x2={X1} y2={y(i)} stroke={COLOR.line} stroke-width={BAR} stroke-linecap="round" />
    <line
      x1={s.x1}
      y1={y(i)}
      x2={s.x2}
      y2={y(i)}
      stroke={i === toks.length - 1 ? COLOR.ok : COLOR.acc}
      stroke-width={BAR}
      stroke-linecap="round"
    />
    <text x={X0} y={y(i) - LABEL_DY} class="big">
      token {i + 1} (<tspan class="piece-label">{t.piece}</tspan>) kept — its real slice of this step's line
    </text>
    {#if detailed}
      <circle cx={vAt[i]} cy={y(i)} r="4" fill={COLOR.txt} />
    {/if}
  {/each}
  {#if detailed}
    {@const last = toks.length - 1}
    <!-- v's label gets its own lane under the last bar; beside the dot it
         would sit on the bar. -->
    <text x={vAt[last]} y={y(last) + V_LABEL_DY} class="big" text-anchor="middle" fill={COLOR.txt}>v</text>
    <text x={X0} y={height - 8}>
      the same v on every row; any number inside the last kept slice is a valid code
    </text>
  {/if}
</svg>

<style>
  .piece-label { font: var(--fs-xs) var(--font-mono); fill: var(--dim); }
</style>
