<script lang="ts">
  import Section from '../Section.svelte';
  import { numbers } from '../../../lib/numbers';
  import { fmtCount, fmtExact, fmtMiB, MIB } from '../../../lib/format';

  const bitsPerWeight = (numbers.artifactBytes * 8) / numbers.params;
  const chunkCount = Math.ceil(numbers.artifactBytes / (numbers.static.chunkMiB * MIB));
</script>

<Section id="small">
  <p>
    Trained weights are 32-bit numbers; {fmtCount(numbers.params)} of them would be
    {fmtMiB(numbers.f32MiB, 0)}. The shipped model stores each weight in {numbers.static.quantBits} bits
    (one of {numbers.static.quantLevels} levels, −{numbers.static.quantHalfRange} through
    +{numbers.static.quantHalfRange}, in groups of {numbers.static.groupSize} sharing a scale factor),
    after a short extra round of training (QAT, quantization-aware training) that teaches the network
    to stay accurate despite the rounding. Without that round, rounding to int4 costs about
    {numbers.static.int4RoundingNoTailPct}% worse compression; the QAT tail claws most of that
    back, to about {numbers.static.int4TailGapPct}% behind the full-precision model. On the
    held-out set the shipped file scores {numbers.bitsPerCharKernel} bits/char through the int4
    kernel ({numbers.bitsPerChar} with the same tailed weights read out unquantised) in a file
    {numbers.ratio.toFixed(1)}× smaller than those weights would be at full precision. Your browser
    runs it through WebAssembly, picking the fastest kernel it supports, and nothing ever leaves your
    machine. Speed is a property of your device, not of this page, so the figure that applies is the one
    your own machine gives: <a href="/bench.html">the benchmark page</a> measures it live.
  </p>
  <p>
    A concrete group: take {numbers.static.groupSize} neighbouring weights whose largest
    magnitude is 0.031. The group stores one scale, 0.031 ÷ {numbers.static.quantHalfRange} ≈ 0.0044,
    and each weight as the nearest step from −{numbers.static.quantHalfRange} to
    +{numbers.static.quantHalfRange}. A weight of 0.013 becomes step 3 and reads back as 0.0132.
    {numbers.static.quantLevels} levels is plenty when every group gets its own ruler.
  </p>
  <p>
    The download itself arrives in {chunkCount} chunks of up to {numbers.static.chunkMiB} MiB each,
    cached by the browser's Cache API after the first visit, so a returning visitor, or a second
    page on the same site, pays nothing.
  </p>
  <table>
    <tbody>
      <tr><th>metric</th><th>value</th></tr>
      <tr>
        <td>parameters</td>
        <td>{fmtCount(numbers.params)} ({numbers.layers} layers × {numbers.dModel} wide, {numbers.heads} heads)</td>
      </tr>
      <tr>
        <td>training data</td>
        <td>
          {fmtCount(numbers.trainTokens)} tokens ≈ {fmtCount(numbers.trainTokens / numbers.meanTokensPerUrl)}
          URLs' worth, sampled without epochs
        </td>
      </tr>
      <tr>
        <td>compression, held-out eval</td>
        <td>
          {numbers.bitsPerCharKernel} bits/char through the int4 kernel, {numbers.bitsPerChar} with the same
          weights unquantised (n={fmtExact(numbers.evalUrls - numbers.evalUrlsSkipped)})
        </td>
      </tr>
      <tr>
        <td>shipped size</td>
        <td>{fmtMiB(numbers.artifactMiB)} at {bitsPerWeight.toFixed(2)} bits/weight ({fmtMiB(numbers.f32MiB, 0)} at full precision)</td>
      </tr>
      <tr><td>decode guarantee</td><td>byte-exact, offline, in-browser</td></tr>
    </tbody>
  </table>
</Section>
