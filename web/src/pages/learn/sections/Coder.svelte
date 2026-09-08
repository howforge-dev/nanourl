<script lang="ts">
  import Section from '../Section.svelte';
  import CoderRows from './figures/CoderRows.svelte';
  import { numbers } from '../../../lib/numbers';
  import { fmtCount, fmtShare } from '../../../lib/format';
  import ScrollBox from '../../../lib/ui/ScrollBox.svelte';
  import Callout from '../../../lib/ui/Callout.svelte';

  const gridTotal = 2 ** numbers.static.probGridBits;
  const floorFrac = numbers.vocab / gridTotal;
  const inflationPerToken = -Math.log2(1 - floorFrac);
  const inflationPerUrl = inflationPerToken * numbers.meanTokensPerUrl;
  const floorFrac16 = numbers.vocab / 2 ** 16;
</script>

<Section id="coder">
  <p>
    Now the classical half. <b>Arithmetic coding</b> turns the model's predictions into a short string
    with one move, repeated once per token, on a number line. Start with the whole line from 0 to 1 as
    the <b>working interval</b>; then, for each token in order:
  </p>
  <ol>
    <li>
      <b>Slice.</b> Ask the model for its probabilities given the tokens so far, and cut the working
      interval into {fmtCount(numbers.vocab)} slices, each as wide as its piece is likely. Likely
      pieces get fat slices, unlikely ones slivers.
    </li>
    <li>
      <b>Keep.</b> The piece the URL <i>actually has</i> next: its slice becomes the whole working
      interval. Every other slice is gone forever.
    </li>
    <li><b>Repeat.</b> The next token subdivides that smaller interval the same way.</li>
  </ol>
  <p>
    After the last token the working interval is a very narrow segment, and its <i>position</i> is a
    record of every keep along the way. The code is enough binary digits to name one number inside
    it. Below, the real thing on the first three tokens of this page's worked example. Each row
    redraws that step's surviving interval at full width so its slices are visible; in the coder the
    interval only ever shrinks.
  </p>
  <ScrollBox class="surface fig">
    <CoderRows rows={3} />
    <div class="cap">
      Each row's real slice, measured on the shipped model. Likely pieces have fat slices, so keeping
      them barely shrinks the region — that's why predictable tokens cost almost nothing.
    </div>
  </ScrollBox>

  <h3 id="algorithm">The algorithm, precisely</h3>
  <p>
    Both directions in full. <i>P</i> is the model's probability table for the next piece;
    <i>C</i>(<i>s</i>) sums the probabilities of every piece before <i>s</i> in the dictionary, so
    [<i>C</i>(<i>s</i>), <i>C</i>(<i>s</i>)+<i>P</i>(<i>s</i>)) is exactly <i>s</i>'s slice of [0,1):
  </p>
  <ScrollBox class="surface fig">
    <pre class="pseudo"><b>ENCODE(url)</b>
  tokens ← tokenizer(url), then append &lt;eos&gt;
  lo ← 0,  hi ← 1
  for each token s, in order:
      P ← model(tokens before s)          <span class="dim"># one forward pass</span>
      w ← hi − lo
      hi ← lo + w · (C(s) + P(s))         <span class="dim"># keep s's slice…</span>
      lo ← lo + w · C(s)                  <span class="dim"># …of the current interval</span>
  return enough binary digits to name one number in [lo, hi)

<b>DECODE(code)</b>
  v ← the number the code names
  lo ← 0,  hi ← 1,  output ← empty
  repeat:
      P ← model(output)                   <span class="dim"># the SAME model, same context</span>
      w ← hi − lo
      find the piece s with  lo + w·C(s) ≤ v &lt; lo + w·(C(s)+P(s))
      if s = &lt;eos&gt;: stop — output is the URL
      append s to output
      hi ← lo + w · (C(s) + P(s))         <span class="dim"># identical update to ENCODE</span>
      lo ← lo + w · C(s)</pre>
    <div class="cap">
      One model forward pass per token, each direction — that pass is the entire cost. The loops above
      assume unbounded precision; "what the real coder adds" turns them into finite integer arithmetic
      without changing an output bit.
    </div>
  </ScrollBox>
  <p>One more token. Each funnel zooms a kept slice out to the full width of the next line; the white dot is <i>v</i>, one number inside the final kept slice, shown where it sits on every line:</p>
  <ScrollBox class="surface fig">
    <CoderRows rows={4} detailed />
    <div class="cap">
      Where a kept slice sits depends only on which piece the URL actually has next. The decoder,
      holding just <i>v</i> and the model, reads token 1 off row 1, feeds it back to slice row 2, and
      walks the nesting out.
    </div>
  </ScrollBox>

  <h3 id="worked">A tiny example, by hand</h3>
  <p>
    Pretend the dictionary has three pieces, rated <b>A&nbsp;50%</b>, <b>B&nbsp;25%</b>,
    <b>C&nbsp;25%</b>: A owns [0,&nbsp;0.50), B [0.50,&nbsp;0.75), C [0.75,&nbsp;1). Encode
    <b>"B, then A"</b>:
  </p>
  <ScrollBox class="surface fig">
    <pre class="pseudo wide-lines">start                     interval = [0.000, 1.000)   width 1
encode B  (25% slice)     interval = [0.500, 0.750)   width 0.25
encode A  (50% of that)   interval = [0.500, 0.625)   width 0.125</pre>
    <div class="cap">
      After each piece, the new interval is that piece's slice <i>of the current interval</i>.
    </div>
  </ScrollBox>
  <p>
    Now transmit any number inside [0.500,&nbsp;0.625). In binary, 0.5 is <code>.100</code> — and
    three binary digits, <code>100</code>, pin it down unambiguously at this width. So the message
    "B,&nbsp;A" costs <b>3 bits</b>.
  </p>
  <Callout>
    Check the bill. The width is 0.25 × 0.5 = 0.125 = 2⁻³, and width multiplies by each piece's
    probability — so the digits needed, −log₂ of the width, are exactly the sum of the pieces' −log₂
    p: 2 bits for B + 1 for A. Nothing has to cost a whole number of bits: a 90% piece costs 0.15,
    and ten of them together cost 1.5. Huffman codes, which spend whole bits per symbol, cannot.
  </Callout>
  <h3>Decoding is the same walk</h3>
  <p>
    The receiver gets <code>100</code> — the number 0.5 — and the same model. First distribution:
    0.5 falls in B's slice, so the first piece <b>was B</b>. Zoom into B's slice, ask again, and 0.5
    now falls in A's: second piece <b>A</b>. Decoding never guesses; the number's position <i>is</i>
    the answer. And note what the decoder never needs: token boundaries. There are no delimiters in
    the stream, and a streaming decoder holds only a small window of upcoming bits, never the whole
    code.
  </p>
  <h3>What the real coder adds</h3>
  <p>Three engineering moves turn the idea into shippable code, each of them for exactness:</p>
  <ul>
    <li>
      <b>No infinite decimals.</b> The interval is two 64-bit integers, and whenever both endpoints
      agree on their leading binary digit, that digit is written out at once and the interval
      re-stretched. Output streams as you go; precision never grows.
    </li>
    <li>
      <b>The carry problem.</b> An interval can shrink while <i>straddling</i> 1/2 — say
      [0.4999,&nbsp;0.5001) — where the next bit is genuinely undecided, exactly as you cannot write
      the first digit of 0.0999999… vs 0.1000000… until a later carry settles it. The fix: record
      "one bit deferred", re-centre and double, move on. When a later token finally tips the interval
      into one half, every deferred bit resolves at once, to the complement of the bit just written.
    </li>
    <li>
      <b>Snapped probabilities.</b> Encoder and decoder must slice at <i>identical</i> boundaries, so
      the probabilities are rounded onto a fixed grid of {fmtCount(gridTotal)} steps
      ({numbers.static.probGridBits} bits) first. Every one of the {fmtCount(numbers.vocab)} pieces
      gets a floor of one step, even one the model rates at a billion to one, which costs about
      {(inflationPerToken * 1000).toFixed(2)} thousandths of a bit per token —
      {inflationPerUrl.toFixed(3)} bits on a {numbers.meanTokensPerUrl.toFixed(0)}-token URL, invisible
      beside its real cost. In exchange no slice is narrower than a step, so <b>no token can cost more
      than {numbers.static.probGridBits} bits</b> however badly the model misjudges it. It is
      {numbers.static.probGridBits} bits rather than 16 because at 16 those mandatory floors would eat
      {fmtShare(floorFrac16)} of the grid.
    </li>
  </ul>
  <p>
    Finally the bits are respelled in a URL-safe alphabet —
    {#each numbers.static.alphabets as name, i (name)}{i > 0 ? (i === numbers.static.alphabets.length - 1 ? ', or ' : ', ') : ''}<code
      >{name}</code
    > ({Math.log2(numbers.static.alphabetSizes[name]).toFixed(1)} bits/char){/each}. emoji-1k trades
    bytes for fewer visible characters: each glyph is 4 bytes of UTF-8 where a base64url character is
    one. qr-alpha is the other way round: fewer bits per character, but every character is one a QR
    code's alphanumeric mode can carry at 5.5 bits, where any other link costs 8 per byte. Every coded
    string carries a stream version tag (currently
    {numbers.static.streamVersion}), so a decoder refuses an incompatible string rather than silently
    corrupting it.
  </p>
</Section>
