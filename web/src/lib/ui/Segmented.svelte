<script lang="ts" module>
  /** One option of a segmented control. */
  export interface SegmentedOption {
    /** the value reported to `onchange`, and the id suffix in `tabs` look */
    value: string;
    label: string;
    title?: string;
  }

  /**
   * The two jobs a segmented control does here, and why one component serves
   * both while still looking different in each.
   *
   * `tabs` SWITCHES WHAT IS SHOWN (Encode / Decode) — the ARIA tabs pattern:
   * `role=tablist`/`role=tab`, `aria-selected`, `aria-controls` pointing at a
   * `role=tabpanel`, roving tabindex and arrow-key navigation.
   *
   * `switch` CHANGES A SETTING that the panel below re-renders under (the
   * output alphabet) — a group of toggles: `role=group` with an accessible
   * name and `aria-pressed` per option. It is not a tablist: nothing it does
   * swaps a panel, and announcing it as one would be a lie.
   *
   * The two sit side by side in the compressor's control row, so they must
   * also be told apart at a glance — hence one joined strip for the setting
   * and separate rounded buttons for the panes. What they share is the button
   * chrome (`.btn*`, the same classes Button emits), the focus ring, and the
   * rule that the selected option is marked by three signals — colour, weight
   * and a third that survives a colour-blind or high-contrast rendering.
   */
  export type SegmentedLook = 'tabs' | 'switch';
</script>

<script lang="ts">
  let {
    options,
    value,
    onchange,
    look = 'tabs',
    /** the group's accessible name; required for `switch`, which has no
     *  visible label of its own */
    label,
    class: klass = '',
  }: {
    options: readonly SegmentedOption[];
    value: string;
    onchange: (value: string) => void;
    look?: SegmentedLook;
    label?: string;
    class?: string;
  } = $props();

  let buttons: HTMLButtonElement[] = $state([]);

  // Arrow keys move between tabs and activate, per the ARIA tabs pattern;
  // Home/End jump to the ends. Wraps around, like every native tab strip.
  // Only for `tabs`: a group of independent toggles does not take arrow keys
  // away from the browser's own focus order.
  function onkeydown(e: KeyboardEvent, i: number) {
    if (look !== 'tabs') return;
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    let next = -1;
    if (step !== 0) next = (i + step + options.length) % options.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = options.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onchange(options[next].value);
    buttons[next]?.focus();
  }
</script>

<div class="seg {look} {klass}" role={look === 'tabs' ? 'tablist' : 'group'} aria-label={label}>
  {#each options as o, i (o.value)}
    <button
      bind:this={buttons[i]}
      type="button"
      role={look === 'tabs' ? 'tab' : undefined}
      id={look === 'tabs' ? `tab-${o.value}` : undefined}
      aria-controls={look === 'tabs' ? `panel-${o.value}` : undefined}
      aria-selected={look === 'tabs' ? o.value === value : undefined}
      aria-pressed={look === 'tabs' ? undefined : o.value === value}
      tabindex={look === 'tabs' ? (o.value === value ? 0 : -1) : undefined}
      title={o.title}
      class="btn btn-secondary {look === 'tabs' ? 'btn-lg' : 'btn-md btn-flush'}"
      class:on={o.value === value}
      onclick={() => onchange(o.value)}
      onkeydown={(e) => onkeydown(e, i)}>{o.label}</button
    >
  {/each}
</div>

<style>
  /* The options are buttons and wear `.btn*` from app.css. What is this
     component's is the strip's layout and how the selected option is marked —
     three signals, never colour alone. */
  .seg { display: flex; flex-wrap: wrap; }
  /* Raised off the page, unlike a well: a control strip sits on the surface it
     switches, not in it. */
  .seg button { background: var(--card); }

  /* Panes: separate rounded buttons, the selected one underlined. */
  .tabs { gap: var(--s-2); margin-bottom: var(--s-4); }
  .tabs button.on {
    color: var(--txt);
    border-color: var(--acc);
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: var(--s-1);
    text-decoration-thickness: var(--stroke);
  }

  /* A setting: one joined strip with a single border, the selected option
     filled. */
  .switch { gap: 0; border: var(--border); border-radius: var(--r-4); overflow: hidden; }
  .switch button.on { background: var(--line); color: var(--txt); font-weight: 600; }
</style>
