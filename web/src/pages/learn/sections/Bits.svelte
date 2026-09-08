<script lang="ts">
  import Section from '../Section.svelte';
  import Ref from '../Ref.svelte';
  import BitsChips from './figures/BitsChips.svelte';
</script>

<Section id="bits">
  <p>
    Information theory has one precise rule: an event with probability <i>p</i> carries
    <b>−log₂ p bits</b> of information. Three examples, using plain arithmetic and no particular
    model:
  </p>
  <ul>
    <li>Something 50% likely costs 1 bit (one yes/no question settles it).</li>
    <li>
      Something 99.9% likely costs about a 700th of a bit: nearly free, because you'd have guessed
      it anyway. (A fraction of a bit sounds impossible to pay; <Ref to="coder" /> shows how hundreds
      of cheap predictions share single bits.)
    </li>
    <li>Something 1-in-256 costs 8 bits, a full byte, because it was news.</li>
  </ul>
  <p>
    The logarithm is there because a bit is a halving: one yes/no question can at best cut the
    possibilities in half, so pinning down an event of probability <i>p</i> takes as many questions
    as there are halvings between 1 and <i>p</i>. The 1-in-256 case is binary search: "top half or
    bottom half?", eight times. The logarithm is also the only choice that makes bills add:
    independent surprises multiply their probabilities (a 1/2 event then a 1/4 event makes a 1/8
    sequence: 1 bit + 2 bits = 3 bits), and only a logarithm turns that × into +, which is what lets
    a URL's cost be a plain sum over its tokens.
  </p>
  <p>
    Compression is paying exactly that bill. Ordinary storage pays 8 bits per character
    however obvious it was; a compressor pays −log₂ p and pockets the difference. Better
    probabilities give a smaller total, which is why a <i>prediction machine</i> sits at the heart of
    a compressor: compression and prediction are the same problem.
  </p>
  <details class="surface mathbox">
    <summary><span class="sig">∑</span> show the math</summary>
    <div class="eq">
      bits(<i>p</i>) = −log₂ <i>p</i><br />
      total(URL) = <span style="font-size:1.2em">∑</span><sub><i>i</i></sub> −log₂ <i>p</i>(token<sub
        ><i>i</i></sub
      > | token₁ … token<sub><i>i</i>−1</sub>)
      <div class="c">
        The compressed size is the sum, over the URL's tokens, of the model's log-loss on each.
        Training minimizes exactly this quantity (the "cross-entropy loss"), which is why training
        the model and improving the compressor are the same job.
      </div>
      <div class="c">
        Symbols: <i>p</i> is a probability between 0 and 1 · log₂ is the base-2 logarithm ("how many
        doublings") · <span class="mv">∑</span><sub><i>i</i></sub> adds up, once per token
        <i>i</i> · the bar "|" reads "given": the model's probability for token <i>i</i> given
        everything before it.
      </div>
    </div>
  </details>
  <BitsChips />
</Section>
