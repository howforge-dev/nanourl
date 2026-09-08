<script lang="ts">
  // Shown under an input the visitor has already typed into while the model
  // is still loading: the panel re-runs itself the moment the codec arrives
  // (Encode/Decode's `$effect` on `codec`), so the note only has to say so.
  let { action }: { action: 'shorten' | 'expand' } = $props();
  const wording = { shorten: 'your URL will be shortened', expand: 'your code will be expanded' } as const;
</script>

<div class="busy" role="status" aria-live="polite">loading the model… {wording[action]} once the model is ready</div>
