<script lang="ts">
  import Section from '../Section.svelte';
  import { numbers } from '../../../lib/numbers';
  import { fmtCount } from '../../../lib/format';
  import ScrollBox from '../../../lib/ui/ScrollBox.svelte';
  import Chip from '../../../lib/ui/Chip.svelte';

  // real worked pieces, dropping the trailing <eos> marker for the reading list
  const pieces = numbers.hn.tokens.filter((t) => t.piece !== '<eos>').map((t) => t.piece);
</script>

<Section id="tokens" n={4} title="Tokens: the model's alphabet">
  <p>
    The model doesn't read characters one at a time, and it doesn't see the URL you typed either.
    Two exact, reversible transforms run first:
  </p>
  <ol>
    <li>
      <b>Canonicalisation</b> reorders host labels TLD-first, so the vocabulary's host hierarchy
      matches the naming tree: <code>https://www.example.com/a</code> becomes
      <code>https://com.example.www/a</code>. It's an <b>involution</b> —
      canonicalising twice returns the original — so one function serves both directions and they
      cannot disagree.
    </li>
    <li>
      <b>Structural pre-split</b> cuts at {numbers.static.rfcDelimiters} punctuation characters —
      RFC 3986's gen- and sub-delimiters, the older "unwise" set, <code>%</code>, and
      <code>.</code> <code>-</code> <code>_</code>, which are split anyway so host labels and slug
      joints become reusable pieces. Each becomes its own piece; <code>http://</code>,
      <code>https://</code> and a well-formed <code>%XX</code> escape stay whole. What survives is
      exactly a run of alphanumerics.
    </li>
  </ol>
  <p>
    Only then does <b>byte-pair encoding</b> (BPE) run, chopping each alphanumeric run into pieces
    from a fixed dictionary of {fmtCount(numbers.vocab)} entries, at most
    {numbers.static.maxTokenLength} characters each. The dictionary was built once by repeatedly
    merging the most frequent adjacent pair across tens of millions of URLs: common fragments earn
    their own entry, rare text falls back to smaller ones, down to single bytes — so <i>any</i> text
    can be encoded.
  </p>
  <ScrollBox class="surface fig">
    <pre class="pseudo"><b
        >BUILD-DICTIONARY(tens of millions of pre-split URLs)</b
      >   <span class="dim"># done once, before training</span>
  dictionary ← the 256 single bytes, plus &lt;eos&gt;
  repeat until the dictionary has {fmtCount(numbers.vocab)} entries:
      count every adjacent pair of entries across all the pre-split pieces
      take the most frequent pair and glue it into ONE new entry
      (skip it if the result would exceed {numbers.static.maxTokenLength} characters)
      record the merge — its position in this list is its <b>priority</b>

<b>TOKENIZE(url)</b>                        <span class="dim"># every encode and decode</span>
  url ← canonicalise(url), then structurally pre-split it
  symbols ← each surviving run of bytes, one symbol per byte
  loop:
      among all adjacent pairs in symbols, find the one whose
      recorded merge has the earliest priority
      if no pair has a recorded merge: stop
      merge every occurrence of that pair
  return symbols — each is now a dictionary piece</pre>
    <div class="cap">
      Priority is the determinism story: when several merges could apply, the earliest-learned one
      always wins, so the same URL splits the same way on every machine, forever — which the decoder
      depends on. A pre-split boundary is a hard barrier: BPE never merges across one.
    </div>
  </ScrollBox>
  <p>The real thing, on the worked example this page uses throughout:</p>
  <ScrollBox class="surface fig">
    <div class="cap head">
      <code>{numbers.hn.url}</code>
      → canonical <code>{numbers.hn.canonical}</code>
      → {pieces.length} pieces
    </div>
    <div class="chips">
      {#each pieces as p, i (p + i)}
        <Chip mono pre>{p}</Chip>
      {/each}
    </div>
    <div class="cap">
      <code>ycombinator</code> did not earn one big piece: BPE only ever sees the alphanumeric run
      between delimiters, and here it merges that run into <code>y</code> · <code>com</code> ·
      <code>bin</code> · <code>ator</code>. The {fmtCount(numbers.vocab)} entries still go to whatever
      recurs often enough to earn one — pieces just compete for them one delimiter-run at a time
      rather than across a whole label.
    </div>
  </ScrollBox>
  <p>
    Both properties the codec needs: tokenization is <b>deterministic</b> and <b>reversible</b> —
    glue the pieces back together, undo the canonicalisation, and the exact original bytes return. It
    averages {numbers.meanTokensPerUrl.toFixed(1)} tokens per URL on the training data.
  </p>
</Section>

<style>
  /* The chips are Chip.svelte; this is only how they are laid out. */
  .chips { display: flex; flex-wrap: wrap; gap: var(--s-2); }
</style>
