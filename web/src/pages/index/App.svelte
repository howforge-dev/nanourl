<script lang="ts">
  // Compressor page: owns the codec, the alphabet toggle and the active tab.
  // Encode.svelte, Decode.svelte, Dist.svelte and Redirect.svelte hold the
  // per-behaviour logic.
  import { onMount } from 'svelte';
  import { createCodecLoader, modelSizeDetail } from '../../lib/codec/codecState.svelte';
  import type { Alphabet } from '../../lib/codec/types';
  import Status from '../../lib/ui/Status.svelte';
  import PageHeader from '../../lib/ui/PageHeader.svelte';
  import Segmented from '../../lib/ui/Segmented.svelte';
  import Card from '../../lib/ui/Card.svelte';
  import Encode from './Encode.svelte';
  import Decode from './Decode.svelte';
  import Redirect from './Redirect.svelte';
  import Outlive from './Outlive.svelte';
  import { TESTID } from '../../lib/testids';
  import { ALPHABETS, DEFAULT_ALPHABET } from '../../lib/alphabet';

  type Tab = 'Encode' | 'Decode';

  // captured once at mount, before anything (including the model load) can
  // change location; the redirect overlay decides its own fate from this
  const initialHref = location.href;
  let showRedirect = $state(location.hash.length > 1);

  let alpha: Alphabet = $state(DEFAULT_ALPHABET);
  let tab: Tab = $state('Encode');

  // Segmented options are strings (they become tab/panel ids); the wasm
  // alphabet enum is numeric, so the mapping happens once, here.
  const TABS = [{ value: 'Encode', label: 'Encode' }, { value: 'Decode', label: 'Decode' }];
  const ALPHA_OPTIONS = ALPHABETS.map((a) => ({ value: String(a.id), label: a.key, title: a.blurb }));

  const loader = createCodecLoader({ readyDetail: modelSizeDetail });
  let codec = $derived(loader.codec);

  onMount(() => {
    // entering a #code on an already-open tab is a same-document navigation;
    // reload so the redirect flow runs
    addEventListener('hashchange', () => location.reload());
    loader.load();
  });
</script>

<PageHeader
  here="index"
/>


<!-- Two segmented controls, one component, deliberately two looks: the left
     one SWITCHES PANES (a real ARIA tablist), the right one CHANGES A SETTING
     the pane below re-renders under (a group of toggles). They sit in one row,
     so telling them apart at a glance is the point; see Segmented.svelte's
     `SegmentedLook`. -->
<div class="tabrow">
  <Segmented options={TABS} value={tab} onchange={(t) => (tab = t as Tab)} />
  <div class="spacer"></div>
  <!-- `alpha` is the E2E hook for the alphabet strip (e2e/index.smoke.spec.ts);
       the `tabs` strip is found by the look class the component already emits. -->
  <Segmented class="alpha" look="switch" label="output alphabet" options={ALPHA_OPTIONS} value={String(alpha)} onchange={(a) => (alpha = Number(a) as Alphabet)} />
</div>

<!-- role="tabpanel" + the id/aria-labelledby pair Segmented's aria-controls
     points at, so the strip above is a real tab widget rather than two
     buttons that happen to swap a div. -->
<Card
  id="panel-Encode"
  role="tabpanel"
  ariaLabelledby="tab-Encode"
  testid={TESTID.paneEncode}
  style={tab === 'Encode' ? undefined : 'display:none'}
>
  <Encode {codec} {alpha} onalpha={(a) => (alpha = a)} />
</Card>
<Card
  id="panel-Decode"
  role="tabpanel"
  ariaLabelledby="tab-Decode"
  testid={TESTID.paneDecode}
  style={tab === 'Decode' ? undefined : 'display:none'}
>
  <Decode {codec} {alpha} />
</Card>

<!-- Below both panes and outside every disclosure: the durability claim is
     the reason to use a link at all, so it cannot be something a visitor has
     to expand to find. -->
<Outlive />

{#if showRedirect}
  <Redirect href={initialHref} {loader} {alpha} onclose={() => (showRedirect = false)} />
{/if}

<Status text={loader.statusText} parts={loader.statusParts} fraction={loader.statusFraction} />

<style>
  .tabrow { display: flex; align-items: center; gap: var(--s-2); flex-wrap: wrap; margin-bottom: var(--s-4); }
  /* The strip's own bottom margin is for a tab strip that sits directly above
     its panel; here the row provides it. `:global` because the element is
     Segmented's, not this page's. */
  .tabrow :global(.tabs) { margin-bottom: 0; }
  .spacer { flex: 1; }
</style>
