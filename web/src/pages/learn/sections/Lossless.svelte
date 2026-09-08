<script lang="ts">
  import Section from '../Section.svelte';
  import { numbers } from '../../../lib/numbers';
  import Callout from '../../../lib/ui/Callout.svelte';
</script>

<Section id="lossless">
  <p>"AI" usually connotes <i>approximately right</i>. Compression tolerates zero approximation, and nanourl is exact for two reasons:</p>
  <ul>
    <li>
      The model only prices the data; it never replaces it. Every piece of the original URL
      is encoded, however improbable the model found it. A bad prediction costs extra bits, never
      correctness.
    </li>
    <li>
      Encoder and decoder must agree bit-for-bit, and they do: probabilities are rounded onto
      a fixed {numbers.static.probGridBits}-bit integer grid, the interval arithmetic is pure integer
      math, and the neural network's weights are quantized to a fixed int4 grid ({numbers.static.groupSize}-weight
      groups, a shared scale per group) rather than left as floating point. The same grid runs on
      every device, in a fixed operation order, with even the exponential function hand-vendored
      because the platform's own libm differs subtly between a laptop and a browser. A fuzz harness
      (<code>rust/urlcodec/fuzz/run_tiers.sh</code>) pushes hundreds of generated URLs through every
      build we ship (native, both single-threaded WebAssembly kernels, and the threaded one) and
      compares the model's raw scores at every step as well as the coded string, with zero
      mismatches.
    </li>
  </ul>
  <p>
    The coupling is tight: change one weight in the decoder's copy. A slice boundary moves by
    a hair, the code number <i>v</i> falls one slice over at some step, and the decoder emits a
    different token. From there it feeds the wrong context back into the model, so
    <i>everything after is gibberish</i>. One wrong dial loses the whole URL, which is why the
    determinism work above exists.
  </p>
  <Callout tone="warn">
    A code is tied to the exact model version that made it. That's why every stream carries a
    version tag (currently {numbers.static.streamVersion}), and why both files are addressed by
    their own content hash (model <code>{numbers.artifactSha256.slice(0, 12)}…</code>, tokenizer
    <code>{numbers.tokenizerSha256.slice(0, 12)}…</code>) rather than by a name a future version
    could replace.
  </Callout>
</Section>
