<script lang="ts">
  // Schematic: one attention head while predicting the digits of the HN
  // example's story id. Box/arc geometry is illustrative layout, not a
  // measured attention weight (we haven't instrumented per-head weights for
  // our model). The pieces named in
  // the boxes are real (numbers.hn.tokens): the structural pre-split makes
  // the host many small tokens rather than one big chunk.
  import { numbers } from '../../../../lib/numbers';
  import { COLOR, FIGURE } from '../../../../lib/ui/tokens';

  // The host span, spelled the way the tokenizer stores it. Joining the
  // pieces with "·" produces "com··y·com·bin·ator·.", a run of separators
  // around pieces that are themselves separators, reading as corrupted text
  // rather than as a tokenization.
  //
  // The three boxes split on the trace's own structure, found in it rather
  // than typed as indices: everything before the first "/" is the host (stored
  // TLD-first, so "com.ycombinator.news"), everything from there to the story
  // id is the path, and the id itself is what the figure is predicting. Fixed
  // slice() bounds would be correct only for today's numbers.hn.
  const toks = numbers.hn.tokens;
  const firstSlash = toks.findIndex((t, i) => i > 0 && t.piece === '/');
  const digits = toks.findIndex((t) => t.piece === '000000');
  if (firstSlash < 1 || digits < 2) {
    throw new Error('lib/numbers.ts: numbers.hn.tokens has no "/" or no "000000" piece to anchor the attention figure on');
  }
  const hostPieces = toks.slice(1, firstSlash);
  const hostText = hostPieces.map((t) => t.piece).join('');
  const pathText = toks
    .slice(firstSlash, digits - 1)
    .map((t) => t.piece)
    .join('');
  // the id being predicted: its first piece, elided
  const target = `${toks[digits - 1].piece}…`;

  // One geometry, derived once, so an arc can never land somewhere a box
  // isn't: each box's centre is computed and the arcs are drawn to it.
  const W_MAX = 640;
  const BOX_Y = 96;
  const BOX_H = 30;
  // Two mono advances, not one: the box labels are `.big` (--fs-sm, 13px) and
  // everything else is --fs-xs (12px). Measured on the shipped font stack and
  // rounded up, so an estimate can only ever reserve too much room.
  const CH_BIG = 7.9;
  const CH = 7.3;
  const PAD = 18;
  const GAP = 10;
  /** the drawing's own margin inside the viewBox */
  const M = 12;
  const TAIL = '← predicting here';
  const TAIL_W = TAIL.length * CH;
  /** air between the predicting box and the label that names it */
  const TAIL_GAP = 12;

  interface Box {
    label: string;
    /** how much of the attention this schematic gives it, 0..1 */
    weight: number;
    target?: boolean;
  }
  // The caption says this head leans on the HOST span, so the host must carry
  // the thickest arc (stroke = 0.8 + 2.6 * weight): a schematic that
  // contradicts its own caption teaches the wrong thing.
  const raw: Box[] = [
    { label: 'https://', weight: 0.25 },
    { label: hostText, weight: 0.85 },
    { label: pathText, weight: 0.4 },
    { label: target, weight: 0, target: true },
  ];

  // Width every label needs; the row is then scaled to fit W_MAX, so a
  // label can never overflow its box into the next one.
  const wants = raw.map((b) => Math.max(52, b.label.length * CH_BIG + 2 * PAD));
  const sumWants = wants.reduce((a, b) => a + b, 0);
  const avail = W_MAX - 2 * M - TAIL_GAP - TAIL_W - GAP * (raw.length - 1);
  const scale = Math.min(1, avail / sumWants);
  const widths = wants.map((w) => w * scale);
  const xs: number[] = [];
  let cursor = M;
  for (const w of widths) {
    xs.push(cursor);
    cursor += w + GAP;
  }
  const boxes = raw.map((b, i) => ({ ...b, x: xs[i], w: widths[i], cx: xs[i] + widths[i] / 2 }));
  const from = boxes[boxes.length - 1];
  const sources = boxes.slice(0, -1);
  // The drawing's own width, so the viewBox hugs its content: a viewBox with
  // slack in it is dead space that the card cannot tell from the figure, and
  // centring or scaling the box then centres and scales the slack too.
  const W = from.x + from.w + TAIL_GAP + TAIL_W + M;

  const strokeW = (weight: number) => 0.8 + 2.6 * weight;
  const depth = (cx: number) => 20 + 30 * Math.min(1, Math.abs(from.cx - cx) / W);

  /** A quadratic arc from the predicting box's top-centre to a source box's
   *  top-centre, apexing in the band reserved above the boxes. */
  function arc(cx: number): string {
    const mid = (from.cx + cx) / 2;
    return `M ${from.cx} ${BOX_Y} Q ${mid} ${BOX_Y - depth(cx) * 2} ${cx} ${BOX_Y}`;
  }

  // A quadratic's highest point is halfway to its control point, so the
  // topmost ink is BOX_Y - depth - half the stroke. Deriving the viewBox from
  // that is the only way the arcs cannot be clipped: the control point sits at
  // BOX_Y - 2*depth, which for the widest span is above a 0-based viewBox.
  const apex = Math.min(...sources.map((b) => BOX_Y - depth(b.cx) - strokeW(b.weight) / 2));
  // --fs-xs mono ink, relative to its own baseline.
  const ASC = 11;
  const DESC = 3;
  /** air between the caption and the highest arc */
  const CAP_GAP = 12;
  const capY = apex - CAP_GAP - DESC;
  const TOP = capY - ASC - 2;
  /** the "N pieces" line, below the boxes */
  const COUNT_Y = BOX_Y + 46;
  const H = COUNT_Y + DESC + 2 - TOP;
</script>

<!-- Centred at its natural size in a card wider than it, and scaled down to
     fit one narrower: a schematic read whole is worth more than a fragment of
     one at full size, and the caption below carries the same content in prose. -->
<svg
  class="attn"
  viewBox="0 {TOP} {W} {H}"
  width={W}
  height={H}
  role="img"
  aria-label="one attention head reading back over earlier tokens"
>
  <!-- Caption first, in its own band: an arc drawn through it is unreadable. -->
  <text x={M} y={capY}>thicker = more attention (schematic)</text>
  {#each sources as b (b.label)}
    <path d={arc(b.cx)} fill="none" stroke={COLOR.acc} stroke-width={strokeW(b.weight)} opacity={0.3 + 0.6 * b.weight} />
  {/each}
  {#each boxes as b (b.label)}
    <rect
      x={b.x}
      y={BOX_Y}
      width={b.w}
      height={BOX_H}
      rx="6"
      fill={b.target ? FIGURE.accentFill : COLOR.bg}
      stroke={b.target ? COLOR.acc : COLOR.line}
      stroke-width={b.target ? 1.6 : 1}
    />
    <text x={b.cx} y={BOX_Y + 20} class="big" text-anchor="middle" fill={b.target ? COLOR.acc : undefined}>{b.label}</text>
  {/each}
  <text x={from.x + from.w + TAIL_GAP} y={BOX_Y + 20}>{TAIL}</text>
  <text x={boxes[1].cx} y={COUNT_Y} text-anchor="middle">{hostPieces.length} pieces</text>
</svg>

<style>
  .attn {
    display: block;
    margin-inline: auto;
    max-width: 100%;
    height: auto;
  }
</style>
