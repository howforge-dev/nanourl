<script lang="ts">
  // A paint: one colour, or a gradient — linear at an angle or radial —
  // through two to five colour stops. The one editor for the data modules,
  // both parts of the corners and the background, so the four cannot drift
  // apart in what they offer.
  import ColorField from '../../lib/ui/ColorField.svelte';
  import Button from '../../lib/ui/Button.svelte';
  import Hint from '../../lib/ui/Hint.svelte';
  import Segmented from '../../lib/ui/Segmented.svelte';
  import TextField from '../../lib/ui/TextField.svelte';
  import { HINTS } from '../../lib/qr/hints';
  import { GRADIENT_TYPES, STOPS_MAX, STOPS_MIN, defaultGradient, sanitizePaint, type Gradient, type Paint } from '../../lib/qr/options';

  let {
    paint,
    /** Names the paint in the fields' accessible names and the hint ids. */
    name,
    describedBy,
    onchange,
  }: { paint: Paint; name: string; describedBy?: string; onchange: (p: Paint) => void } = $props();

  const KIND = [
    { value: 'solid', label: 'colour' },
    { value: 'gradient', label: 'gradient' },
  ];
  const TYPES = GRADIENT_TYPES.map((t) => ({ value: t, label: t }));

  /** Every edit goes through `sanitizePaint`, so a stop's offset or a
   *  rotation typed out of range comes back clamped. */
  const emit = (p: Paint): void => onchange(sanitizePaint(p, paint));
  const withGradient = (g: Gradient | null): void => emit({ ...paint, gradient: g });
  const stopAt = (i: number, patch: Partial<{ offset: number; color: string }>): void => {
    const g = paint.gradient;
    if (!g) return;
    withGradient({ ...g, stops: g.stops.map((st, k) => (k === i ? { ...st, ...patch } : st)) });
  };
  const fieldValue = (e: Event): string => (e.currentTarget as HTMLInputElement).value;
  const id = (part: string): string => `hint-${name}-${part}`;
</script>

<div class="paint">
  <div class="row">
    <Segmented look="switch" label="{name} paint" {describedBy} options={KIND} value={paint.gradient ? 'gradient' : 'solid'} onchange={(v) => withGradient(v === 'gradient' ? defaultGradient(paint.color) : null)} />
    {#if !paint.gradient}
      <ColorField label="{name} colour" {describedBy} value={paint.color} onchange={(c) => emit({ ...paint, color: c })} />
    {/if}
  </div>
  {#if paint.gradient}
    {@const g = paint.gradient}
    <div class="row">
      <span class="lbl">type<Hint id={id('type')} text={HINTS.gradient} /></span>
      <Segmented look="switch" label="{name} gradient type" describedBy={id('type')} options={TYPES} value={g.type} onchange={(v) => withGradient({ ...g, type: v as Gradient['type'] })} />
      {#if g.type === 'linear'}
        <span class="lbl">angle<Hint id={id('rotation')} text={HINTS.rotation} /></span>
        <span class="num">
          <TextField type="number" min={0} max={359} ariaLabel="{name} gradient angle in degrees" describedBy={id('rotation')} value={g.rotation} onchange={(e) => withGradient({ ...g, rotation: Number(fieldValue(e)) })} />
        </span>
        <span class="dim">°</span>
      {/if}
    </div>
    <div class="stops">
      <span class="lbl">stops<Hint id={id('stops')} text={HINTS.stops} /></span>
      {#each g.stops as st, i (i)}
        <div class="row stop">
          <span class="num">
            <TextField type="number" min={0} max={1} step={0.05} ariaLabel="{name} stop {i + 1} offset" describedBy={id('stops')} value={st.offset} onchange={(e) => stopAt(i, { offset: Number(fieldValue(e)) })} />
          </span>
          <ColorField label="{name} stop {i + 1} colour" describedBy={id('stops')} value={st.color} onchange={(c) => stopAt(i, { color: c })} />
          {#if g.stops.length > STOPS_MIN}
            <Button size="sm" variant="ghost" ariaLabel="remove {name} stop {i + 1}" onclick={() => withGradient({ ...g, stops: g.stops.filter((_, k) => k !== i) })}>×</Button>
          {/if}
        </div>
      {/each}
      {#if g.stops.length < STOPS_MAX}
        <Button size="sm" onclick={() => withGradient({ ...g, stops: [...g.stops, { offset: 1, color: g.stops[g.stops.length - 1].color }] })}>add stop</Button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .paint { display: flex; flex-direction: column; gap: var(--s-2); }
  .row { display: flex; align-items: center; flex-wrap: wrap; gap: var(--s-2); }
  .stops { display: flex; flex-direction: column; gap: var(--s-1); }
  .lbl { color: var(--dim); font-size: var(--fs-xs); }
  .num { width: 5.5em; }
  .dim { font-size: var(--fs-xs); }
</style>
