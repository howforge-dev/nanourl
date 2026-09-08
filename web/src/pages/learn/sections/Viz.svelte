<script lang="ts">
  import Section from '../Section.svelte';
  import Ref from '../Ref.svelte';
  import { numbers } from '../../../lib/numbers';
  import { fmtExact, fmtMiB } from '../../../lib/format';
</script>

<Section id="viz">
  <p>
    Everything above has a live counterpart on the <a href="/model.html">observatory</a>, with the
    same weights running locally:
  </p>
  <ul>
    <li>
      Token chips: <Ref to="tokens" />'s pieces, each priced in bits (<Ref to="bits" />). Click one to inspect
      the moment the model predicted it.
    </li>
    <li>
      Attention: <Ref to="transformer" />'s looking-back weights, raw, as {numbers.layers} layer tiles ×
      {numbers.heads} head rows, one column per earlier token in the same URL; brighter = more
      weight. Look for the bright first column (the <code>&lt;eos&gt;</code> resting sink) and for
      heads that lock onto the host whenever digits are being predicted.
    </li>
    <li>
      Residual stream: <Ref to="transformer" />'s whiteboard, photographed after each of the
      {numbers.layers} layers. {numbers.dModel} numbers per row is too many dots, so each cell shows
      the strongest of several neighbouring channels: blue positive, amber negative, brighter for
      larger. A stripe that persists top-to-bottom is a note an early layer wrote and every later one
      kept.
    </li>
    <li>
      Arithmetic coder: <Ref to="coder" /> one step at a time. Watch the interval narrow, the bits
      leave the stream, and an amber <code>?</code> mark a deferred bit until a later token resolves
      it.
    </li>
    <li>
      Position embedding: <Ref to="transformer" />'s wpe table, the {numbers.block} position vectors
      projected to 2D trace an ordered path, so position is a learned ruler, not
      {numbers.block} arbitrary labels.
    </li>
    <li>
      Architecture: the full pipeline, every tensor at its real dimensions and its share of
      the {fmtMiB(numbers.artifactMiB)} download.
    </li>
    <li>
      Embedding atlas: <Ref to="transformer" />'s geometry, all {fmtExact(numbers.vocab)} piece-embeddings
      on one map. Drag a box to zoom; labels appear up close.
    </li>
  </ul>
  <p>
    The <a href="/">compressor</a> itself is the end-to-end product: paste a URL, get the string,
    and share it as a redirect link; the same model decodes it exactly, in the recipient's browser.
  </p>
</Section>
