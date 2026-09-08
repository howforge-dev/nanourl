<script lang="ts">
  import Section from '../Section.svelte';
  import AttentionFig from './figures/AttentionFig.svelte';
  import { numbers } from '../../../lib/numbers';
  import { fmtBytes, fmtCount, fmtShare, probPct } from '../../../lib/format';
  import ScrollBox from '../../../lib/ui/ScrollBox.svelte';

  const urlsPerWindow = numbers.block / numbers.meanTokensPerUrl;
  // real data: numbers.hn always has an "item" piece (the worked HN example's
  // path segment) — fail loudly at build time if that ever stops being true,
  // rather than showing a placeholder in the rendered page
  const itemTok = numbers.hn.tokens.find((t) => t.piece === 'item');
  if (!itemTok) throw new Error('lib/numbers.ts: expected an "item" token in numbers.hn.tokens');
  // int4-g64 bytes/param: half a byte per weight (4 bits) plus one f16 scale
  // shared by every group of numbers.static.groupSize weights
  const bytesPerParam = (numbers.static.groupSize / 2 + 2) / numbers.static.groupSize;
  const tiedParams = numbers.vocab * numbers.dModel;
  const tiedBytes = tiedParams * bytesPerParam;
  const tiedSharePct = (tiedParams / numbers.params) * 100;
</script>

<Section id="transformer" n={6} title="Inside the transformer">
  <p>
    The particular network shape nanourl uses is a <b>transformer</b> — the same architecture as
    ChatGPT-style models, just {numbers.layers} layers and {fmtCount(numbers.params)} parameters
    instead of dozens of layers and hundreds of billions. A single prediction flows through five
    stages:
  </p>

  <h3 id="embeddings">Embeddings: pieces become number-lists</h3>
  <p>
    Each of the {fmtCount(numbers.vocab)} pieces owns a learned list of {numbers.dModel} numbers — its
    <b>embedding</b> — which is really the coordinates of a point in {numbers.dModel}-dimensional
    space, and pieces used in similar contexts land near each other there. You can't draw that many
    dimensions, so the <a href="/model.html">observatory</a>'s atlas flattens them onto paper with a
    map-projection algorithm (UMAP), which keeps neighbours neighbours. Like a world map, exact
    distances get distorted; <i>neighbourhoods</i> are honest.
  </p>

  <h3 id="positions">Position embeddings: knowing where you are</h3>
  <p>
    The next stage, <b>attention</b>, lets tokens gather information from each other by weighted
    averaging — and a weighted average treats the earlier tokens as an unordered bag, caring neither
    who came first nor how far away anyone is. For URLs, position is meaning: the piece at position 1
    is almost certainly a scheme, and a digit right after <code>item?id=</code> is a different
    situation from a digit five pieces later. The fix is blunt: every position, 0 to
    {numbers.block - 1}, gets its own learned {numbers.dModel}-number list (the <b>wpe</b> table), and
    each token's pad starts as its piece embedding <b>plus</b> its position's embedding.
  </p>
  <p>
    <b>Every URL is its own context.</b> Training packs about {urlsPerWindow.toFixed(0)} URLs into one
    {numbers.block}-token window, but each attends only within itself, and positions restart at 0
    after every <code>&lt;eos&gt;</code>. The {numbers.block}-row table is also the model's hard
    horizon — there is no {numbers.block + 1}th position — but because it resets per URL rather than
    sliding through a document, it binds only on a URL longer than {numbers.block} tokens:
    {numbers.evalUrlsSkipped} of the {fmtCount(numbers.evalUrls)} held-out URLs,
    {fmtShare(numbers.evalUrlsSkipped / numbers.evalUrls, 2)}. The {numbers.static.chainCarry}-token
    carry-window scheme is the fallback for those, not the normal path.
  </p>

  <h3 id="attention">Attention: tokens look back</h3>
  <p>
    The defining trick of the transformer. At each position the model asks "to predict what comes
    next, how much should I consult each earlier token?", answers with a weight for every one of them
    inside the same URL, and mixes what they carry into the current position. One rule governs all of
    it: a position may consult only positions <b>before</b> it. The future is walled off because the
    decoder, mid-decode, has no future to show it.
  </p>
  <p>
    The model runs <b>{numbers.heads} of these lookups side by side</b>, each with its own learned
    criterion ({numbers.headDim} numbers each — {numbers.dModel} ÷ {numbers.heads} heads): think of
    {numbers.heads} researchers reading the same URL, one tracking the host, one watching the piece
    just before, one counting digits. Nobody assigned those roles; each head drifted into a specialty
    because the division of labour reduced errors. One pattern shows up in almost every transformer,
    ours very likely included: a head with nothing to contribute dumps its attention on
    <code>&lt;eos&gt;</code> instead, because the weights must sum to 1 and that is the one position
    always present and content-free. It's called the <b>attention sink</b>.
  </p>
  <details class="surface mathbox">
    <summary><span class="sig">∑</span> show the math — one attention head</summary>
    <div class="eq">
      <i>q</i><sub><i>i</i></sub> = <i>W</i><sub>Q</sub><i>x</i><sub><i>i</i></sub>&emsp; <i
        >k</i
      ><sub><i>j</i></sub> = <i>W</i><sub>K</sub><i>x</i><sub><i>j</i></sub>&emsp; <i>v</i
      ><sub><i>j</i></sub> = <i>W</i><sub>V</sub><i>x</i><sub><i>j</i></sub>
      <div class="c">
        Each position's (normalized) pad is projected three ways: a <b>query</b> ("what am I looking
        for"), a <b>key</b> ("what I can be found by"), a <b>value</b> ("what I contribute if
        chosen"). In nanourl each is {numbers.headDim} numbers ({numbers.dModel} ÷ {numbers.heads}
        heads).
      </div>
      <i>s</i><sub><i>ij</i></sub> = <i>q</i><sub><i>i</i></sub>·<i>k</i><sub><i>j</i></sub> /
      √{numbers.headDim}
      <div class="c">Match score of position <i>j</i> for predictor <i>i</i>: a dot product, scaled down so scores don't explode with dimension.</div>
      <i>a</i><sub><i>ij</i></sub> = e<sup><i>s</i><sub>ij</sub></sup> / <span
        style="font-size:1.2em">∑</span
      ><sub><i>j′</i>≤<i>i</i></sub> e<sup><i>s</i><sub>ij′</sub></sup>
      &emsp;&emsp;(so every <i>a</i><sub><i>ij</i></sub> ≥ 0 and <span style="font-size:1.1em"
        >∑</span
      ><sub><i>j</i></sub> <i>a</i><sub><i>ij</i></sub> = 1)
      <div class="c">The softmax. That "= 1" is the sink's origin: there is no way for all weights to be small.</div>
      out<sub><i>i</i></sub> = <span style="font-size:1.2em">∑</span><sub><i>j</i>≤<i>i</i></sub> <i
        >a</i
      ><sub><i>ij</i></sub> <i>v</i><sub><i>j</i></sub>
      <div class="c">
        <b>Symbols:</b> <i>x</i><sub><i>i</i></sub> — position <i>i</i>'s normalized pad
        ({numbers.dModel} numbers) · <i>i</i> — the position doing the predicting; <i>j</i> — an
        earlier position in the same URL · <i>W</i><sub>Q</sub>, <i>W</i><sub>K</sub>, <i>W</i
        ><sub>V</sub> — learned weight matrices that squeeze {numbers.dModel} numbers down to
        {numbers.headDim} · <i>a</i>·<i>b</i> — dot product · <i>e</i> — 2.718… · ∑ — add up over
        the positions named under it.
      </div>
    </div>
  </details>
  <!-- No `breakout`: the schematic is ~640px wide and scales to whatever
       column it is given, so a wider card would only add empty space around
       it. -->
  <ScrollBox class="surface fig">
    <AttentionFig />
    <div class="cap">
      Schematic, not measured weights: one head predicting the story-id digits of this page's worked
      example leans on the host span, because the site decides what kind of id follows
      <code>item?id=</code> — Hacker News ids are eight-ish digits, other sites differ. The
      observatory draws the real thing (section 12).
    </div>
  </ScrollBox>

  <h3 id="layers">Layers: refinement passes</h3>
  <p>
    One <b>layer</b> = one round of attention (positions consulting each other) plus a "think" step
    where each position works on what it gathered, alone — a plain multiply-and-add stage, no looking
    around (the jargon is MLP). nanourl stacks {numbers.layers}. Early layers pick up local structure;
    later ones hold the big picture.
  </p>
  <p>
    Between layers, everything travels in a running {numbers.dModel}-number scratchpad each position
    carries: the <b>residual stream</b>. A layer never replaces it — it reads the pad, computes its
    attention and think-step contributions, and <b>adds</b> them on top, like notes accumulating on a
    whiteboard nobody erases. That pad is the <i>only</i> thing a layer hands the next, and by layer
    {numbers.layers} it holds everything the model has concluded about this position.
  </p>
  <ScrollBox class="surface fig">
    <pre class="pseudo">1  copy the pad and normalize the copy   (rescale so no channel drowns the rest)
2  attention: the {numbers.heads} heads read every position's normalized copy
   and produce one {numbers.dModel}-number "gathered" summary for this position
3  pad ← pad + gathered                  (first addition)
4  copy the pad again, normalize the copy
5  think step: stretch the copy to {numbers.dMlp} numbers, filter them
   against each other, squeeze back to {numbers.dModel}
6  pad ← pad + result                    (second addition)</pre>
    <div class="cap">
      Steps 1 and 4 normalize a <i>copy</i>: the pad itself is never rescaled, only added to, which is
      what lets every layer read it on the same footing. After layer {numbers.layers}, one last
      normalize prepares it for the readout.
    </div>
  </ScrollBox>
  <details class="surface mathbox">
    <summary><span class="sig">∑</span> show the math — one full layer</summary>
    <div class="eq">
      <i>x</i> ← <i>x</i> + <i>W</i><sub>O</sub>·[out<sup>(1)</sup> ‖ … ‖ out<sup
        >({numbers.heads})</sup
      >]&emsp; where each out<sup>(<i>h</i>)</sup> reads <i>x̂</i> = LN₁(<i>x</i>)
      <div class="c">
        Steps 1–3: the {numbers.heads} heads run on a normalized copy, their outputs are stitched
        together, mixed by one more matrix, and <b>added</b> to the pad.
      </div>
      <i>x</i> ← <i>x</i> + <i>W</i><sub>down</sub>·( silu(<i>W</i><sub>gate</sub><i>x̂</i>) ⊙ <i
        >W</i
      ><sub>up</sub><i>x̂</i> )&emsp; where <i>x̂</i> = LN₂(<i>x</i>),&ensp; silu(<i>z</i>) =
      <i>z</i>/(1+e<sup>−<i>z</i></sup>)
      <div class="c">
        Steps 4–6, the think step: stretch to {numbers.dMlp} numbers two ways, let one branch gate
        the other (⊙ is element-by-element multiply), squeeze back to {numbers.dModel}, add. This
        gated form is called SwiGLU.
      </div>
      LN(<i>x</i>) = <i>w</i> ⊙ (<i>x</i> − mean(<i>x</i>)) / std(<i>x</i>)
      <div class="c">
        <b>Symbols:</b> <i>x</i> — the pad ({numbers.dModel} numbers) · ← — "becomes" · ‖ — stitch
        side by side: {numbers.heads} head outputs of {numbers.headDim} numbers become
        {numbers.dModel} · <i>W</i><sub>O</sub> — a learned {numbers.dModel}→{numbers.dModel} mixing
        matrix; <i>W</i><sub>gate</sub>, <i>W</i><sub>up</sub> — learned
        {numbers.dModel}→{numbers.dMlp}; <i>W</i><sub>down</sub> — learned
        {numbers.dMlp}→{numbers.dModel} · ⊙ — multiply element by element · <i>x̂</i> — the
        normalized copy · mean, std — average and spread · <i>w</i> in LN — a learned volume knob
        per channel.
      </div>
    </div>
  </details>

  <h3 id="readout">Readout: one score per piece</h3>
  <p>
    After layer {numbers.layers}, the final {numbers.dModel}-number summary is compared against
    every piece's embedding, giving {fmtCount(numbers.vocab)} scores, and a fixed formula called the
    <b>softmax</b> converts scores into percentages that are all positive and sum to exactly 100% —
    real probabilities.
  </p>
  <details class="surface mathbox">
    <summary><span class="sig">∑</span> show the math — readout</summary>
    <div class="eq">
      <i>z</i> = <i>W</i><sub>wte</sub>·LN<sub>f</sub>(<i>x</i>)&emsp;({fmtCount(numbers.vocab)}
      scores)&emsp;&emsp; <i>p</i><sub><i>i</i></sub> = e<sup><i>z</i><sub>i</sub></sup> / <span
        style="font-size:1.2em">∑</span
      ><sub><i>j</i></sub> e<sup><i>z</i><sub>j</sub></sup>
      <div class="c">
        <b>Symbols:</b> <i>x</i> — the pad after layer {numbers.layers} · LN<sub>f</sub> — one final
        normalize · <i>W</i><sub>wte</sub> — the {fmtCount(numbers.vocab)}×{numbers.dModel} embedding
        table · <i>z</i><sub><i>i</i></sub> — piece <i>i</i>'s raw score · <i>p</i><sub><i>i</i></sub
        > — its probability after the softmax.
      </div>
      <div class="c">
        <i>W</i><sub>wte</sub> is the input embedding table again — "tied weights". Partly thrift: a
        separate output table would be another {numbers.vocab}×{numbers.dModel} =
        {fmtCount(tiedParams)} dials, {fmtShare(tiedSharePct / 100)} of the model and
        {fmtBytes(tiedBytes)} of the download, restating what the input table already encodes. Partly
        the right shape: a piece's embedding is what that piece means, so the natural test for "is it
        next?" is whether the pad points that way.
      </div>
    </div>
  </details>
  <p>
    Measured on this page's worked example: after
    <code>{numbers.hn.canonical.slice(0, numbers.hn.canonical.indexOf('item'))}</code> the readout
    gives <code>item</code> a {probPct(itemTok.bits)} probability. Compression consumes the whole
    list, not just the top guess.
  </p>
</Section>
