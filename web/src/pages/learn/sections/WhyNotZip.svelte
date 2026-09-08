<script lang="ts">
  import Section from '../Section.svelte';
  import Ref from '../Ref.svelte';
  import { numbers } from '../../../lib/numbers';
  import { fmtMiB } from '../../../lib/format';
</script>

<Section id="whynotzip">
  <p>
    The compressors everyone already has (zip, gzip, bzip2, xz) work by finding
    repetition inside the input: this phrase appeared before, point back at it instead of
    spelling it again. A {numbers.hn.url_chars}-character URL contains almost no internal
    repetition, so there is nothing for them to find. Re-measured just now on
    <code>{numbers.hn.url}</code>:
  </p>
  <table>
    <tbody>
      <tr><th>method</th><th>output</th></tr>
      <tr>
        <td>raw deflate (zip's engine), max effort</td>
        <td
          >{numbers.zip.deflate} bytes ({numbers.zip.raw - numbers.zip.deflate >= 0 ? 'saves' : 'costs'}
          {Math.abs(numbers.zip.raw - numbers.zip.deflate)} vs the {numbers.zip.raw}-byte input)</td
        >
      </tr>
      <tr><td>gzip (deflate + its container)</td><td>{numbers.zip.gzip} bytes, <i>larger</i> than the input</td></tr>
      <tr><td>bzip2</td><td>{numbers.zip.bzip2} bytes, much larger</td></tr>
      <tr><td>xz</td><td>{numbers.zip.xz} bytes, much larger</td></tr>
      <tr>
        <td>nanourl</td>
        <td
          >{numbers.hn.coded_bits} bits ({Math.ceil(numbers.hn.coded_bits / 8)} bytes),
          written <code>{numbers.hn.coded}</code> in {numbers.hn.coded_chars} characters</td
        >
      </tr>
    </tbody>
  </table>
  <p>
    The difference is prior knowledge. A classical compressor arrives knowing nothing and must
    learn everything from the message itself, which is hopeless when the message is a few dozen
    characters. nanourl's model arrives already knowing what URLs look like (<Ref to="origin" />), and
    that knowledge lives in the {fmtMiB(numbers.artifactMiB)} you download once, not in each message:
    the download is paid once, and every message after it stays short.
  </p>
</Section>
