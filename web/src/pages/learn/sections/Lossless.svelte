<script lang="ts">
  import Section from '../Section.svelte';
  import { numbers } from '../../../lib/numbers';
  import Callout from '../../../lib/ui/Callout.svelte';
</script>

<Section id="lossless" n={8} title="Why it's perfectly lossless">
  <p>"AI" usually connotes <i>approximately right</i>. Compression tolerates zero approximation, and nanourl is exact for two reasons:</p>
  <ul>
    <li>
      <b>The model never replaces the data — it only prices it.</b> Every piece of the original URL
      is encoded, however improbable the model found it. A bad prediction costs extra bits, never
      correctness.
    </li>
    <li>
      <b>Encoder and decoder must agree bit-for-bit</b>, and they do: probabilities are rounded onto
      a fixed {numbers.static.probGridBits}-bit integer grid, the interval arithmetic is pure integer
      math, and the neural network's weights are quantized to a fixed int4 grid ({numbers.static.groupSize}-weight
      groups, a shared scale per group) rather than left as floating point — the same grid on every
      device, run in a fixed operation order, with even the exponential function hand-vendored
      because the platform's own libm differs subtly between a laptop and a browser. A fuzz harness
      (<code>rust/urlcodec/fuzz/run_tiers.sh</code>) pushes hundreds of generated URLs through every
      build we ship — native, both single-threaded WebAssembly kernels, and the threaded one — and
      compares not just the coded string but the model's raw scores at every step. Zero mismatches.
    </li>
  </ul>
  <p>
    To feel how tight that coupling is: change one weight in the decoder's copy. A slice boundary
    moves by a hair, the code number <i>v</i> falls one slice over at some step, the decoder emits a
    different token — and from there it feeds the wrong context back into the model, so
    <i>everything after is gibberish</i>. One wrong dial, total loss. That is the knife-edge the
    determinism work above exists to stand on.
  </p>
  <Callout tone="warn">
    The one real coupling: a code is tied to the exact model version that made it. That's why every
    stream carries a version tag (currently {numbers.static.streamVersion}), and why both files are
    addressed by their own content hash — model <code>{numbers.artifactSha256.slice(0, 12)}…</code>,
    tokenizer <code>{numbers.tokenizerSha256.slice(0, 12)}…</code> — rather than by a name a future
    version could quietly replace.
  </Callout>
</Section>
