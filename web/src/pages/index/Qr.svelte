<script lang="ts">
  // The QR code of the current redirect link: a collapsible section of the
  // Encode pane, drawn by our own renderer (lib/qr/render.ts) from the matrix
  // node-qrcode builds, under one persisted settings object (lib/qr/options.ts)
  // that every control here edits and `qrOptions` turns into what the
  // builder, the on-screen symbol and the exports each take.
  //
  // What goes into the code is `qrText`'s business (lib/alphabet.ts): for
  // qr-alpha the base is uppercased so the whole link, bar the '#', rides in
  // QR alphanumeric mode. The readout under the symbol shows that text and
  // the segments the library chose for it, which is where qr-alpha's density
  // shows; the caption and centre label are drawn, never encoded.
  import QRCode from 'qrcode';
  import { tick } from 'svelte';
  import type { Alphabet } from '../../lib/codec/types';
  import { qrText } from '../../lib/alphabet';
  import {
    CENTRE_LABEL_MAX,
    EC_LEVELS,
    EC_RECOVERS,
    EYE_STYLES,
    MARGIN_MAX,
    MASK_MAX,
    MODULE_STYLES,
    SCALE_MAX,
    SCALE_MIN,
    VERSION_MAX,
    VERSION_MIN,
    WIDTH_MAX,
    WIDTH_MIN,
    applyCentreLabel,
    applyStyle,
    exportName,
    hasPlate,
    loadSettings,
    qrOptions,
    sanitize,
    saveSettings,
    type EcLevel,
    type EyeStyle,
    type ModuleStyle,
    type QrSettings,
  } from '../../lib/qr/options';
  import { renderSvg } from '../../lib/qr/render';
  import Button from '../../lib/ui/Button.svelte';
  import Chip from '../../lib/ui/Chip.svelte';
  import Segmented from '../../lib/ui/Segmented.svelte';
  import TextField from '../../lib/ui/TextField.svelte';
  import { TESTID } from '../../lib/testids';

  let { link, code, alpha }: { link: string; code: string; alpha: Alphabet } = $props();

  let open = $state(false);
  let settings: QrSettings = $state(loadSettings());
  // Persist on every change. `saveSettings` serialises the whole object, so
  // the effect depends on every field.
  $effect(() => saveSettings(settings));

  // The two hex fields hold what is typed; the settings take a value only
  // once it is a colour, so a half-typed one neither snaps back nor renders.
  let darkText = $state('');
  let lightText = $state('');
  $effect(() => {
    darkText = settings.dark;
    lightText = settings.light;
  });
  const HEX = /^#[0-9a-f]{6}$/i;

  let text = $derived(qrText(link, alpha));
  let bytes = $derived(new TextEncoder().encode(text).length);
  let opts = $derived(qrOptions(settings));

  // The matrix. `create` throws for a forced version too small for the text,
  // which is an answer to show under the field, not a failure of the page.
  let built = $derived.by(() => {
    if (!text) return { qr: null, error: null };
    try {
      return { qr: QRCode.create(text, opts.create), error: null };
    } catch (e) {
      return { qr: null, error: e instanceof Error ? e.message.trim().replace(/\s+/g, ' ') : String(e) };
    }
  });
  let screen = $derived(built.qr ? renderSvg(built.qr.modules, opts.screen) : null);
  let exported = $derived(built.qr ? renderSvg(built.qr.modules, opts.export) : null);
  let segments = $derived(built.qr ? built.qr.segments.map((s) => ({ mode: s.mode.id, length: s.getLength() })) : []);
  let svgHref = $derived(exported ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(exported.svg) : '');

  // A plate — the logo or a label — needs level H to stay readable; the
  // presets raise it, and this is the warning when it has been lowered.
  let lowered = $derived(hasPlate(settings) && settings.level !== 'H');

  const STYLE_OPTIONS = MODULE_STYLES.map((s) => ({ value: s, label: s }));
  const EYE_OPTIONS = EYE_STYLES.map((s) => ({ value: s, label: s }));
  const LEVEL_OPTIONS = EC_LEVELS.map((l) => ({ value: l, label: l, title: `recovers ${EC_RECOVERS[l]} of the symbol` }));
  const MASK_OPTIONS = [{ value: 'auto', label: 'auto' }, ...Array.from({ length: MASK_MAX + 1 }, (_, i) => ({ value: String(i), label: String(i) }))];
  const ON_OFF = [
    { value: 'off', label: 'off' },
    { value: 'on', label: 'on' },
  ];
  const LIGHT_OPTIONS = [
    { value: 'colour', label: 'colour' },
    { value: 'transparent', label: 'transparent' },
  ];

  /** One field changed: re-validate the whole object, so every clamp and
   *  parse lives in `sanitize` rather than in each handler. */
  const set = (field: keyof QrSettings, value: unknown): void => {
    settings = sanitize({ ...settings, [field]: value });
  };
  const fieldValue = (e: Event): string => (e.currentTarget as HTMLInputElement).value;

  // PNG export: our SVG rasterised through an <img> onto a canvas at the
  // export scale. Built on the first click for the current symbol, then the
  // anchor downloads it; cleared whenever the symbol changes.
  let pngHref = $state('');
  let pngError = $state('');
  $effect(() => {
    void exported;
    pngHref = '';
    pngError = '';
  });
  async function rasterize(svg: string, width: number, height: number): Promise<string> {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('the browser could not draw the SVG'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width);
    canvas.height = Math.round(height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2D canvas in this browser');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  }
  async function onPng(e: MouseEvent): Promise<void> {
    if (pngHref || !exported) return;
    e.preventDefault();
    const a = e.currentTarget as HTMLAnchorElement;
    try {
      pngHref = await rasterize(exported.svg, exported.width * settings.scale, exported.height * settings.scale);
    } catch (err) {
      pngError = err instanceof Error ? err.message : String(err);
      return;
    }
    await tick();
    a.click();
  }

  let shortLink = $derived(link.replace(/^https?:\/\//, ''));
</script>

<details bind:open data-testid={TESTID.qr}>
  <summary>QR code — scan the link</summary>
  {#if open}
    <div class="symbol" data-testid={TESTID.qrSvg} style:width="{settings.width}px">
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- our own renderer's SVG of our own link, with every text escaped -->
      {@html screen?.svg ?? ''}
    </div>
    {#if built.error}<div class="err" role="alert" data-testid={TESTID.qrError}>cannot build this code: {built.error}</div>{/if}

    <!-- The readout: exactly the text in the symbol, and how the library
         segmented it. Caption and label are not in here — they are drawn. -->
    <div class="readout">
      <div class="text" data-testid={TESTID.qrText}>{text}</div>
      <div class="segs" data-testid={TESTID.qrInfo}>
        {#if built.qr}
          <span class="stat"
            >version <b>{built.qr.version}</b>, <b>{built.qr.modules.size}×{built.qr.modules.size}</b> modules · <b>{bytes}</b> bytes of text</span
          >
          {#each segments as seg, i (i)}
            <Chip mono title="{seg.mode} mode, {seg.length} characters">{seg.mode} · {seg.length}</Chip>
          {/each}
        {/if}
      </div>
    </div>

    <div class="controls">
      <span class="lbl">style</span>
      <Segmented look="switch" label="module style" options={STYLE_OPTIONS} value={settings.style} onchange={(v) => (settings = applyStyle(settings, v as ModuleStyle))} />
      <span class="lbl">eyes</span>
      <Segmented look="switch" label="finder style" options={EYE_OPTIONS} value={settings.eyes} onchange={(v) => set('eyes', v as EyeStyle)} />
      <span class="lbl">gradient</span>
      <Segmented look="switch" label="gradient" options={ON_OFF} value={settings.gradient ? 'on' : 'off'} onchange={(v) => set('gradient', v === 'on')} />
      <span class="lbl">error correction</span>
      <div>
        <Segmented look="switch" label="error correction" options={LEVEL_OPTIONS} value={settings.level} onchange={(v) => set('level', v as EcLevel)} />
        {#if lowered}
          <div class="warn-text caption" role="status" data-testid={TESTID.qrWarning}>
            below H the {settings.centreLabel.trim() ? 'label' : 'logo'} on the plate may make the code unreadable
          </div>
        {/if}
      </div>
      <span class="lbl">version</span>
      <div class="num">
        <TextField
          type="text"
          ariaLabel="QR version, {VERSION_MIN} to {VERSION_MAX}, or empty for automatic"
          placeholder="auto"
          value={settings.version === null ? '' : String(settings.version)}
          oninput={(e) => set('version', fieldValue(e))}
        />
      </div>
      <span class="lbl">mask</span>
      <Segmented look="switch" label="mask pattern" options={MASK_OPTIONS} value={settings.mask === null ? 'auto' : String(settings.mask)} onchange={(v) => set('mask', v)} />
      <span class="lbl">size</span>
      <div class="row">
        <div class="num">
          <TextField type="number" min={WIDTH_MIN} max={WIDTH_MAX} ariaLabel="on-screen width in pixels" value={settings.width} oninput={(e) => set('width', fieldValue(e))} />
        </div>
        <span class="dim">px on screen ·</span>
        <div class="num">
          <TextField type="number" min={SCALE_MIN} max={SCALE_MAX} ariaLabel="export scale in pixels per module" value={settings.scale} oninput={(e) => set('scale', fieldValue(e))} />
        </div>
        <span class="dim">px per module in the PNG ·</span>
        <div class="num">
          <TextField type="number" min={0} max={MARGIN_MAX} ariaLabel="quiet zone in modules" value={settings.margin} oninput={(e) => set('margin', fieldValue(e))} />
        </div>
        <span class="dim">modules of quiet zone</span>
      </div>
      <span class="lbl">colours</span>
      <div class="row">
        <div class="hex">
          <TextField ariaLabel="dark colour, as #rrggbb" bind:value={darkText} oninput={() => HEX.test(darkText) && set('dark', darkText)} />
        </div>
        <span class="dim">dark ·</span>
        <div class="hex">
          <TextField ariaLabel="light colour, as #rrggbb" bind:value={lightText} oninput={() => HEX.test(lightText) && set('light', lightText)} />
        </div>
        <span class="dim">light</span>
        <Segmented look="switch" label="light modules" options={LIGHT_OPTIONS} value={settings.transparentLight ? 'transparent' : 'colour'} onchange={(v) => set('transparentLight', v === 'transparent')} />
      </div>
      <span class="lbl">caption</span>
      <TextField sans ariaLabel="caption drawn under the code" placeholder={shortLink} value={settings.caption} oninput={(e) => set('caption', fieldValue(e))} />
      <span class="lbl">centre label</span>
      <div>
        <div class="row">
          <div class="hex">
            <TextField
              sans
              ariaLabel="short text drawn on the centre plate in place of the logo"
              value={settings.centreLabel}
              oninput={(e) => (settings = applyCentreLabel(settings, fieldValue(e)))}
            />
          </div>
          <span class="dim" data-testid={TESTID.qrLabelCount}>{settings.centreLabel.length}/{CENTRE_LABEL_MAX}</span>
        </div>
        {#if screen?.error}<div class="err" role="alert" data-testid={TESTID.qrLabelError}>{screen.error}</div>{/if}
      </div>
      <span class="lbl">export</span>
      <div class="row">
        <Button size="sm" href={pngHref || '#'} download={exportName(code, 'png')} onclick={onPng} testid={TESTID.qrPng} disabled={!exported}>Download PNG</Button>
        <Button size="sm" href={svgHref || '#'} download={exportName(code, 'svg')} testid={TESTID.qrSvgDownload} disabled={!exported}>Download SVG</Button>
        {#if pngError}<span class="err" role="alert">{pngError}</span>{/if}
      </div>
    </div>
  {/if}
</details>

<style>
  /* The symbol takes the chosen width and no more than the column; the
     inline SVG's viewBox does the rest. Its own quiet zone is the light
     colour the renderer paints, so the box adds none. */
  .symbol { max-width: 100%; margin-top: var(--s-3); }
  .symbol :global(svg) { display: block; width: 100%; height: auto; }
  .readout { margin-top: var(--s-3); }
  .text { font-family: var(--font-mono); font-size: var(--fs-sm); overflow-wrap: anywhere; }
  .segs { display: flex; align-items: center; flex-wrap: wrap; gap: var(--s-2); margin-top: var(--s-1); }
  .segs .stat { margin: 0; }
  /* Label column, control column; one column on a phone. */
  .controls {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    align-items: center;
    column-gap: var(--s-4);
    row-gap: var(--s-3);
    margin-top: var(--s-4);
  }
  .lbl { color: var(--dim); font-size: var(--fs-sm); }
  .row { display: flex; align-items: center; flex-wrap: wrap; gap: var(--s-2); }
  .row .dim { font-size: var(--fs-xs); }
  .num { width: 5.5em; }
  .hex { width: 9em; }
  @media (max-width: 480px) {
    .controls { grid-template-columns: minmax(0, 1fr); row-gap: var(--s-1); }
    .lbl { margin-top: var(--s-2); }
  }
</style>
