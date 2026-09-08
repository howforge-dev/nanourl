<script lang="ts">
  // Dream page: owns the codec and hosts the dream loop's controls/results.
  // The model run backwards — instead of encoding a URL you give it, it
  // samples one token at a time until <eos>, inventing URLs from what it was
  // trained on. The index page's App.svelte holds the codec-load pattern this
  // mirrors; Dream.svelte holds the loop itself.
  import { onMount } from 'svelte';
  import PageHeader from '../../lib/ui/PageHeader.svelte';
  import { createCodecLoader, modelSizeDetail } from '../../lib/codec/codecState.svelte';
  import Status from '../../lib/ui/Status.svelte';
  import Card from '../../lib/ui/Card.svelte';
  import Dream from './Dream.svelte';
  import { paramsM } from '../../lib/format';

  const loader = createCodecLoader({ readyDetail: modelSizeDetail });
  let codec = $derived(loader.codec);

  onMount(() => loader.load());
</script>

<PageHeader
  here="dream"
/>


{#if codec}
  <Card>
    <Dream {codec} />
  </Card>
  <p class="caption">
    Every URL here was invented by a {paramsM(codec.info.params)}-parameter model that has only ever
    seen URLs, not page content. They can look real, be nonsense, or echo the spammier corners of the crawl.
    <span class="warn-text">The page fetches nothing and links nothing</span> unless it starts with http(s); the rest is plain text.
  </p>
{/if}

<Status text={loader.statusText} parts={loader.statusParts} fraction={loader.statusFraction} />
