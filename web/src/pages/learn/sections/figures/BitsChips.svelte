<script lang="ts">
  // The real per-token bill for the worked HN example, measured on the
  // shipped model (numbers.hn — see web/scripts/fixtures/hn-trace.json and
  // scripts/numbers.ts for how it is captured). The strip itself is
  // lib/ui/CostChips.svelte, the same component the compressor renders live:
  // this figure only adds the caption and asks for 2 decimals, which is the
  // one real difference between them.
  import CostChips from '../../../../lib/ui/CostChips.svelte';
  import { numbers } from '../../../../lib/numbers';
  import ScrollBox from '../../../../lib/ui/ScrollBox.svelte';
  import { SIZE } from '../../../../lib/ui/tokens';

  const lastTok = numbers.hn.tokens.at(-1);
  if (!lastTok) throw new Error('lib/numbers.ts: numbers.hn.tokens is empty');
  const lastBits = lastTok.bits;
  // real data: numbers.hn always has a "000000" piece (the worked HN
  // example's story-id digits) — fail loudly at build time if that ever
  // stops being true, rather than showing a placeholder in the rendered page
  const digitsTok = numbers.hn.tokens.find((t) => t.piece === '000000');
  if (!digitsTok) throw new Error('lib/numbers.ts: expected a "000000" token in numbers.hn.tokens');
</script>

<!-- `chip-strip` caps the breakout (learn.css): seventeen chips fill two rows
     at that width and the caption keeps a readable measure. -->
<ScrollBox class="surface fig breakout chip-strip">
  <CostChips tokens={numbers.hn.tokens} digits={2} minWidth={SIZE.chipWide} />
  <div class="cap">
    The real bill for <code>{numbers.hn.url}</code>, measured on the shipped model (canonical form
    <code>{numbers.hn.canonical}</code>). The host's well-known pieces (<code>com</code>,
    <code>news</code>, and the merges that spell <code>ycombinator</code>) are near-free; the story
    id's digits are not — <code>000000</code> alone costs {digitsTok.bits.toFixed(1)} bits.
    (<code>&lt;eos&gt;</code> is the end marker, {lastBits.toFixed(2)} bits here — section 7.) Total:
    {numbers.hn.model_bits.toFixed(1)} bits of model cost, {numbers.hn.coded_bits} bits once the coder's
    fixed-grid rounding and bookkeeping are added, for a {numbers.hn.url_chars}-character URL.
  </div>
</ScrollBox>
