<script lang="ts">
  import Section from '../Section.svelte';
  import { numbers } from '../../../lib/numbers';
  import { fmtCount } from '../../../lib/format';

  // This tokenizer's own pieces for the worked HN example, not a made-up
  // generic one — same slicing convention as AttentionFig.svelte. Hosts are
  // stored TLD-first and maximally split, so "ycombinator.com"
  // is not one token but several: com · . · y · com · bin · ator.
  const tld = numbers.hn.tokens[1].piece; // "com"
  const dot = numbers.hn.tokens[2].piece; // "."
  const host = numbers.hn.tokens
    .slice(3, 7)
    .map((t) => t.piece)
    .join(''); // "ycombinator"
  const path = numbers.hn.tokens
    .slice(10, 14)
    .map((t) => t.piece)
    .join(''); // "item?id="
  // Tokens are what training consumed; "URLs' worth" is that token count at
  // this tokenizer's measured mean. Never a pass count: training draws random
  // windows from a corpus many times larger, with no epochs, so most URLs are
  // seen once or never.
  const urlEquivalents = numbers.trainTokens / numbers.meanTokensPerUrl;
</script>

<Section id="idea" n={1} title="The whole idea in one paragraph">
  <p>
    A URL like <code>{numbers.hn.url}</code> looks like {numbers.hn.url_chars} characters of arbitrary
    text, but almost none of it is a surprise. nanourl stores hosts TLD-first, so the URL opens
    <code>https://</code> · <code>{tld}</code> · <code>{dot}</code> · <code>{host}</code> — and by
    then a Hacker News link is a strong guess, which makes <code>{path}</code> nearly certain. So
    nanourl trains a <b>neural network</b> — a program whose behaviour comes from hundreds of millions
    of adjustable numbers rather than hand-written rules — on {fmtCount(numbers.trainTokens)} tokens
    of real URLs, about {fmtCount(urlEquivalents)} URLs' worth, until it is an expert at this one
    guessing game. Then <b>arithmetic coding</b>, a classical technique, turns "how surprised was the
    model" into a short string: predictable pieces cost almost nothing, surprising ones cost more.
    The same model, run by whoever receives the string, plays the game backwards and recovers the URL
    <b>exactly</b>.
  </p>
</Section>
