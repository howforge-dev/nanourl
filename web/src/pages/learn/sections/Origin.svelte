<script lang="ts">
  import Section from '../Section.svelte';
  import { numbers } from '../../../lib/numbers';
  import { fmtCount, fmtMiB } from '../../../lib/format';
</script>

<Section id="origin" n={9} title="Where the model came from">
  <p>The model is trained from scratch, for this one job. The pipeline, end to end:</p>
  <ol>
    <li>
      <b>Collect.</b> URLs from a Common-Crawl-derived corpus, hash-partitioned into shards so no URL
      votes twice and the split described next is possible without re-scanning anything.
    </li>
    <li>
      <b>Split first, train second.</b> Shard {numbers.evalShard} ({numbers.evalSource}) is held back
      and never shown to the model — disjoint from the training shards by construction, since the
      dataset is hash-partitioned on the URL itself. Every compression figure on these pages is
      measured on that held-back shard.
    </li>
    <li>
      <b>Train the tokenizer</b> on a sample, freezing the {fmtCount(numbers.vocab)}-piece
      dictionary (section 4).
    </li>
    <li>
      <b>Train the model</b>: {fmtCount(numbers.trainTokens)} tokens — about
      {fmtCount(numbers.trainTokens / numbers.meanTokensPerUrl)} URLs' worth, drawn as random windows
      from a much larger corpus, so most URLs are seen once or not at all — on
      {numbers.static.gpuCount} GPUs, minimizing exactly the bits-per-character bill from section 2.
      The training objective and the product metric are the same number.
    </li>
    <li>
      <b>Shrink and ship</b>: quantize to {numbers.static.quantBits}-bit weights (with a short extra QAT round of training so
      the model adapts to the rounding — section 10), package as one
      {fmtMiB(numbers.artifactMiB)} file, addressed by content hash so a browser can never mix model
      versions.
    </li>
  </ol>
</Section>
