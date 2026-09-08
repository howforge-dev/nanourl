<script lang="ts">
  // Static content page: no codec, no model load (this page
  // needs no codec). Every figure it quotes comes from lib/numbers.ts.
  import Toc from './Toc.svelte';
  import PageHeader from '../../lib/ui/PageHeader.svelte';
  import Idea from './sections/Idea.svelte';
  import Bits from './sections/Bits.svelte';
  import WhyNotZip from './sections/WhyNotZip.svelte';
  import Tokens from './sections/Tokens.svelte';
  import Lm from './sections/Lm.svelte';
  import Transformer from './sections/Transformer.svelte';
  import Coder from './sections/Coder.svelte';
  import Lossless from './sections/Lossless.svelte';
  import Origin from './sections/Origin.svelte';
  import Small from './sections/Small.svelte';
  import Limits from './sections/Limits.svelte';
  import Viz from './sections/Viz.svelte';
</script>

<PageHeader
  here="learn"
/>

<Toc />

<Idea />
<Bits />
<WhyNotZip />
<Tokens />
<Lm />
<Transformer />
<Coder />
<Lossless />
<Origin />
<Small />
<Limits />
<Viz />
