<script lang="ts">
  // Copy-to-clipboard button: clipboard API with an execCommand fallback for
  // insecure contexts, flashing "copied ✓" / "copy failed" for 1200 ms.
  import Button from './Button.svelte';

  let { text }: { text: string } = $props();

  let label = $state('copy');
  let status: 'ok' | 'fail' | null = $state(null);

  function copyText(s: string): Promise<boolean> {
    if (navigator.clipboard) return navigator.clipboard.writeText(s).then(() => true, () => false);
    const ta = document.createElement('textarea'); // insecure-context fallback
    ta.value = s;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return Promise.resolve(ok);
  }

  function onclick() {
    copyText(text).then((ok) => {
      label = ok ? 'copied ✓' : 'copy failed';
      status = ok ? 'ok' : 'fail';
      setTimeout(() => {
        label = 'copy';
        status = null;
      }, 1200);
    });
  }
</script>

<!-- The label reverts after 1200 ms and is the only feedback this control
     gives, so it is announced; `tone` carries the same verdict in colour. -->
<span aria-live="polite">
  <Button size="sm" tone={status === 'ok' ? 'ok' : status === 'fail' ? 'bad' : 'default'} {onclick}>{label}</Button>
</span>
