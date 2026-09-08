<script lang="ts">
  import Section from '../Section.svelte';
  import { numbers } from '../../../lib/numbers';
  import { fmtCount, fmtExact } from '../../../lib/format';
  import Callout from '../../../lib/ui/Callout.svelte';
</script>

<Section id="lm">
  <h3 id="nn">First: what a neural network is</h3>
  <p>
    Forget the brain metaphors. A neural network is a calculator with millions of
    <b>adjustable dials</b>. Numbers flow in, get multiplied by dial settings, summed, bent by a
    simple rule that squashes negative values, and flow out, stage after stage. That bend is what
    makes stacking worthwhile: without a kink between stages a chain of multiply-and-adds collapses
    into one, and depth would buy nothing. With enough dials such a machine can approximate almost
    any relationship; the only question is how to set them.
  </p>
  <p>
    A toy version with two dials: score = 3.2 × (contains "news"?) + 1.1 × (ends in ".com"?), where
    each test scores 1 if true and 0 if not. Feed it <code>news.ycombinator.com</code> and it outputs
    4.3; feed it <code>example.org</code> and it outputs 0. Those two numbers, 3.2 and 1.1, are
    dials, and with better settings the machine scores better. nanourl is this machine with
    {fmtCount(numbers.params)} dials, its multiply-and-add stages stacked {numbers.layers} layers
    deep.
  </p>
  <p>
    Training is the answer, and it is mechanical: show the machine an example, measure how
    wrong its output is, nudge every dial a hair in whichever direction shrinks the error, repeat
    billions of times. What makes that feasible is calculus: one backward sweep
    (backpropagation) gives the right nudge for <i>all</i> {fmtCount(numbers.params)} dials at
    about the cost of running the model twice, not {fmtCount(numbers.params)} separate experiments.
    Nobody writes the rule "Hacker News URLs contain item?id="; it <i>emerges</i> in the dial settings
    because it reduced errors. "Parameters" and "weights" are these dials.
  </p>
  <h3>The contract</h3>
  <p>A language model is a neural network with one specific job:</p>
  <Callout>
    Given the tokens so far, output a probability for every one of the
    {fmtExact(numbers.vocab)} possible next pieces (all positive, summing to 1).
  </Callout>
  <p>
    Feed it <code>&lt;eos&gt;</code> (the model's one marker, which ends a URL and so also starts
    the next) and it says "the next piece is probably <code>https://</code>…". Feed it
    <code>&lt;eos&gt; https://</code> <code>com</code> and the distribution collapses onto
    <code>.</code>: <code>com</code> is a host label, and a host label is always followed by a dot.
    The model never "decides" anything; it only rates candidates, and training is what makes those
    ratings match reality. That took hours on {numbers.static.gpuCount} GPUs (graphics cards, the
    hardware this arithmetic runs fastest on). <i>Using</i> the trained model needs none of that: it
    is the multiply-and-add machine turning dials that are already set, which is why it runs in your
    browser.
  </p>
  <p>
    You can watch this contract directly: on the <a href="/">compressor</a>, encode a URL, open
    <i>advanced</i>, and click any token: the table shows the model's ranked guesses at that moment.
  </p>
</Section>
