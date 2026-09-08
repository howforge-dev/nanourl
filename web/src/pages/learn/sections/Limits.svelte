<script lang="ts">
  import Section from '../Section.svelte';
  import { numbers } from '../../../lib/numbers';
  import { paramsM } from '../../../lib/format';

  // real data: numbers.hn always has a "000000" piece (the worked HN
  // example's story-id digits) — fail loudly at build time if that ever
  // stops being true, rather than showing a placeholder in the rendered page
  const digits = numbers.hn.tokens.find((t) => t.piece === '000000');
  if (!digits) throw new Error('lib/numbers.ts: expected a "000000" token in numbers.hn.tokens');
</script>

<Section id="limits" n={11} title="What it's bad at">
  <p>Knowing where the gains stop is part of understanding the system:</p>
  <ul>
    <li>
      <b>True randomness is incompressible</b> — by anyone, ever. The worked example's
      <code>000000</code> piece alone costs {digits.bits.toFixed(1)} bits: the model strips the
      predictable shell and pays full price for the random core. A URL that is <i>mostly</i> random id
      — a UUID link, a signed token — barely compresses.
    </li>
    <li>
      <b>Hosts it has never seen cost several bits per character.</b> The model falls back to
      spelling them out letter by letter with only generic URL statistics to lean on. Popular hosts
      are nearly free; your weekend project's domain is not.
    </li>
    <li>
      <b>It only knows URLs.</b> Any text encodes — the tokenizer bottoms out at single bytes — but
      prose or JSON pays badly through this model. The prior <i>is</i> the product.
    </li>
    <li>
      <b>The worst case is capped, not avoided</b>: the probability floor from section 7 means no
      token can cost more than {numbers.static.probGridBits} bits, however wrong the model's guess.
      Pathological inputs get bounded damage, not miracles.
    </li>
    <li>
      <b>Codes are tied to their model version</b> (section 8). A shortened URL is a contract with
      one exact set of {paramsM(numbers.params)} numbers; the stream's version tag
      and the site's content-hashed model files enforce it.
    </li>
  </ul>
</Section>
