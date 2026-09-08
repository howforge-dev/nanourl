<script lang="ts">
  import Section from '../Section.svelte';
  import { numbers } from '../../../lib/numbers';
  import { fmtMiB } from '../../../lib/format';
</script>

<Section id="whynotzip" n={3} title="Why not just zip it?">
  <p>
    The compressors everyone already has — zip, gzip, bzip2, xz — work by finding
    <b>repetition inside the input</b>: this phrase appeared before, point back at it instead of
    spelling it again. A {numbers.hn.url_chars}-character URL contains almost no internal
    repetition, so there is nothing for them to find. Re-measured just now on
    <code>{numbers.hn.url}</code>:
  </p>
  <table>
    <tbody>
      <tr><th>method</th><th>output</th></tr>
      <tr>
        <td>raw deflate (zip's engine), max effort</td>
        <td class="n"
          >{numbers.zip.deflate} bytes ({numbers.zip.raw - numbers.zip.deflate >= 0 ? 'saves' : 'costs'}
          {Math.abs(numbers.zip.raw - numbers.zip.deflate)} vs the {numbers.zip.raw}-byte input)</td
        >
      </tr>
      <tr><td>gzip (deflate + its container)</td><td class="n">{numbers.zip.gzip} bytes — <i>larger</i> than the input</td></tr>
      <tr><td>bzip2</td><td class="n">{numbers.zip.bzip2} bytes — much larger</td></tr>
      <tr><td>xz</td><td class="n">{numbers.zip.xz} bytes — much larger</td></tr>
      <tr>
        <td>nanourl</td>
        <td class="n"
          ><b>{numbers.hn.coded_bits} bits</b> — that is {Math.ceil(numbers.hn.coded_bits / 8)} bytes,
          written <code>{numbers.hn.coded}</code> in {numbers.hn.coded_chars} characters</td
        >
      </tr>
    </tbody>
  </table>
  <p>
    The gap isn't cleverness, it's <b>prior knowledge</b>. A classical compressor arrives knowing
    nothing and must learn everything from the message itself — hopeless when the message is a few
    dozen characters. nanourl's model arrives already knowing what URLs look like (section 9), and
    that knowledge lives in the {fmtMiB(numbers.artifactMiB)} you download once, not in each message:
    a big shared dictionary, paid for once, buys tiny messages forever after.
  </p>
</Section>
