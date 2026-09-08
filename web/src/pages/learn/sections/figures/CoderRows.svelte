<script lang="ts">
  // Real interval-slicing data for the worked HN example: each row is one
  // token's actual clo/chi — its slice of that step's fresh [0,1) probability
  // line (rust/urlcodec's codec_encode; see web/scripts/fixtures/hn-trace.json).
  // Drawn renormalized (every row full width), exactly like the real coder's
  // own renormalization after each token — see the "worked" subsection.
  import { numbers } from '../../../../lib/numbers';
  import { COLOR } from '../../../../lib/ui/tokens';

  let { rows, detailed = false }: { rows: number; detailed?: boolean } = $props();

  const X0 = 20;
  const X1 = 620;
  const W = X1 - X0;
  const ROW_H = 60;
  /** the bar's stroke width — it reaches BAR/2 either side of its own line */
  const BAR = 8;
  /** a row label's baseline, above its bar */
  const LABEL_DY = 14;
  /** `.big` (--fs-sm) mono ink, relative to its own baseline */
  const LABEL_ASC = 11;
  const LABEL_DESC = 3;
  /** the stem carrying v's marker from its dot down into its own label lane */
  const V_STEM = 11;
  /** v's label baseline, below the last bar */
  const V_LABEL_DY = 24;
  const toks = $derived(numbers.hn.tokens.slice(0, rows));
  const y = (i: number) => 30 + i * ROW_H;
  /** the ink-free band under bar `i`, stopping short of row `i+1`'s label */
  const gapTop = (i: number) => y(i) + BAR / 2 + 3;
  const gapBot = (i: number) => y(i + 1) - LABEL_DY - LABEL_ASC - 3;
  // Height reaches just past the LAST row, not one whole row past it: a row's
  // worth of empty card below the final line reads as a row that failed to
  // render. `detailed` adds the two lanes below the last bar — v's own label,
  // then the caption naming it.
  const height = $derived(y(Math.max(0, rows - 1)) + (detailed ? 56 : 16));
  // v crosses every line but never a word: one segment per row, each resuming
  // below that row's label. One full-height line strikes through every label
  // instead, which reads as struck-out text.
  const vSegments = $derived(
    toks.map((_, i) => ({
      y1: i === 0 ? y(0) - BAR / 2 : y(i) - LABEL_DY + LABEL_DESC + 2,
      y2: i === toks.length - 1 ? y(i) + V_STEM : gapBot(i),
    })),
  );
</script>

<svg viewBox="0 0 640 {height}" width="640" height={height}>
  {#each toks as t, i (t.piece + i)}
    <line x1={X0} y1={y(i)} x2={X1} y2={y(i)} stroke={COLOR.line} stroke-width={BAR} stroke-linecap="round" />
    <line
      x1={X0 + (t.clo ?? 0) * W}
      y1={y(i)}
      x2={X0 + (t.chi ?? 1) * W}
      y2={y(i)}
      stroke={i === toks.length - 1 ? COLOR.ok : COLOR.acc}
      stroke-width={BAR}
      stroke-linecap="round"
    />
    <text x={X0} y={y(i) - LABEL_DY} class="big">
      token {i + 1} (<tspan class="piece-label">{t.piece}</tspan>) kept — its real slice of this step's line
    </text>
    {#if detailed && i < toks.length - 1}
      <!-- Each guide lives in the band between the bars only. Run to the next
           bar's edge and it strikes through that row's label instead, which
           reads as corrupted text rather than as a line carried down. -->
      <line x1={X0 + (t.clo ?? 0) * W} y1={gapTop(i)} x2={X0 + (t.clo ?? 0) * W} y2={gapBot(i)} stroke={COLOR.line2} stroke-dasharray="3,3" />
      <line x1={X0 + (t.chi ?? 1) * W} y1={gapTop(i)} x2={X0 + (t.chi ?? 1) * W} y2={gapBot(i)} stroke={COLOR.line2} stroke-dasharray="3,3" />
    {/if}
  {/each}
  {#if detailed}
    {@const last = toks.length - 1}
    {@const lastTok = toks[last]}
    {@const vx = X0 + (((lastTok?.clo ?? 0) + (lastTok?.chi ?? 1)) / 2) * W}
    {#each vSegments as seg, i (i)}
      <line x1={vx} y1={seg.y1} x2={vx} y2={seg.y2} stroke={COLOR.txt} stroke-width="1.6" />
    {/each}
    <circle cx={vx} cy={y(last)} r="4" fill={COLOR.txt} />
    <!-- v's label gets its own lane under the last bar. At the head of the
         marker it collides with row 1's label, which spells "token v1". -->
    <text x={vx} y={y(last) + V_LABEL_DY} class="big" text-anchor="middle" fill={COLOR.txt}>v</text>
    <text x={X0} y={height - 8}>
      any number inside the last kept slice is a valid code — e.g. v
    </text>
  {/if}
</svg>

<style>
  .piece-label { font: var(--fs-xs) var(--font-mono); fill: var(--dim); }
</style>
