<script lang="ts">
  // The QR code of the current redirect link: a collapsible section of the
  // Encode pane, drawn by our own renderer (lib/qr/render.ts) from the matrix
  // node-qrcode builds, under one persisted settings object (lib/qr/options.ts)
  // that every control here edits and `qrOptions` turns into what the
  // builder, the on-screen symbol and the exports each take. The controls
  // are grouped the way qr-code-styling groups its options, so a person who
  // knows that tool finds the same knobs; every label carries a `Hint`.
  //
  // The settings are the single truth and the renderer draws them verbatim:
  // a preset overwrites them, "invert colours" rewrites them, and nothing
  // is transformed on the way to the screen or a file.
  //
  // What goes into the code is `qrText`'s business (lib/alphabet.ts): for
  // qr-alpha the base is uppercased so the whole link, bar the '#', rides in
  // QR alphanumeric mode. The readout under the symbol shows that text and
  // the segments the library chose for it, which is where qr-alpha's density
  // shows; the caption, the label and the image are drawn, never encoded.
  import QRCode from 'qrcode';
  import { tick, untrack } from 'svelte';
  import type { Alphabet } from '../../lib/codec/types';
  import { QR_ALPHA, qrText } from '../../lib/alphabet';
  import { EC_LABEL, HINTS, type HintKey } from '../../lib/qr/hints';
  import {
    CENTRE_LABEL_MAX,
    CORNER_TYPES,
    EC_LEVELS,
    EC_RECOVERS,
    EXPORT_FORMATS,
    IMAGE_MARGIN_MAX,
    IMAGE_MAX_BYTES,
    IMAGE_SOURCES,
    MARGIN_MAX,
    MARGIN_PICKS,
    MASK_MAX,
    MIME,
    MODES,
    MODE_NOTE_BYTE,
    MODULE_STYLES,
    PADDING_MAX,
    PRESETS,
    PRESET_TABLE,
    SCALE_MAX,
    SCALE_MIN,
    SHAPES,
    VERSION_MAX,
    VERSION_MIN,
    WIDTH_MAX,
    WIDTH_MIN,
    applyCentreLabel,
    applyImageSource,
    applyPreset,
    applyStyle,
    exportName,
    hasPlate,
    invertColours,
    isUnscannable,
    loadSettings,
    maxImageSize,
    presetOf,
    qrOptions,
    sanitize,
    saveSettings,
    solid,
    type CornerType,
    type EcLevel,
    type ExportFormat,
    type ImageSource,
    type Mode,
    type ModuleStyle,
    type Paint,
    type QrSettings,
    type Shape,
  } from '../../lib/qr/options';
  import { bounded as boundedField } from '../../lib/qr/fields';
  import { circlePadding, renderSvg } from '../../lib/qr/render';
  import Button from '../../lib/ui/Button.svelte';
  import Callout from '../../lib/ui/Callout.svelte';
  import Chip from '../../lib/ui/Chip.svelte';
  import Hint from '../../lib/ui/Hint.svelte';
  import Segmented from '../../lib/ui/Segmented.svelte';
  import TextField from '../../lib/ui/TextField.svelte';
  import QrPaint from './QrPaint.svelte';
  import { TESTID } from '../../lib/testids';

  let {
    link,
    /** The same URL's link in qr-alpha when the result is in another
     *  alphabet, for the callout that offers the switch; '' while unknown. */
    altLink = '',
    code,
    alpha,
    onalpha,
  }: { link: string; altLink?: string; code: string; alpha: Alphabet; onalpha?: (a: Alphabet) => void } = $props();

  let open = $state(false);
  let settings: QrSettings = $state(loadSettings());
  // Persist on every change. `saveSettings` serialises the whole object, so
  // the effect depends on every field.
  $effect(() => saveSettings(settings));

  let text = $derived(qrText(link, alpha, { scheme: settings.scheme }));
  let bytes = $derived(new TextEncoder().encode(text).length);

  // The matrix. `create` throws for a forced version too small for the text,
  // which is an answer to show under the field, not a failure of the page.
  const build = (t: string, s: QrSettings) => {
    const o = qrOptions(s);
    return QRCode.create(o.segments(t), o.create);
  };
  let built = $derived.by(() => {
    if (!text) return { qr: null, error: null };
    try {
      return { qr: build(text, settings), error: null };
    } catch (e) {
      return { qr: null, error: e instanceof Error ? e.message.trim().replace(/\s+/g, ' ') : String(e) };
    }
  });
  // How many pixels a module gets on screen, for the image margin, which is
  // set in pixels; the document's width in modules follows from the settings.
  let modulesAcross = $derived.by(() => {
    const size = built.qr?.modules.size ?? 21;
    const padding = Math.max(settings.padding, settings.shape === 'circle' ? circlePadding(size, settings.margin) : 0);
    return size + 2 * (settings.margin + padding);
  });
  let opts = $derived(qrOptions(settings, settings.width / modulesAcross));
  let screen = $derived(built.qr ? renderSvg(built.qr.modules, opts.screen) : null);
  let exported = $derived(built.qr ? renderSvg(built.qr.modules, opts.export) : null);
  let segments = $derived(built.qr ? built.qr.segments.map((s) => ({ mode: s.mode.id, length: s.getLength() })) : []);
  /** How the text is packed, in words: QR stores capitals and digits in a
   *  compact mode and everything else as plain bytes, which is the whole
   *  reason qr-alpha exists. */
  let packing = $derived.by(() => {
    const total = segments.reduce((n, s) => n + s.length, 0);
    const plain = segments.filter((s) => s.mode === 'Byte').reduce((n, s) => n + s.length, 0);
    if (!total) return '';
    if (plain === total) return `all ${total} characters stored as plain bytes; the compact mode needs capital letters and digits only`;
    if (plain === 0) return `all ${total} characters stored in the compact mode for capitals and digits`;
    return `${total - plain} of ${total} characters stored in the compact mode for capitals and digits, ${plain} as plain bytes`;
  });
  let svgHref = $derived(exported ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(exported.svg) : '');
  /** The on-screen width: the setting, snapped to whole pixels per module
   *  when asked. */
  let displayWidth = $derived(screen && settings.roundSize ? Math.max(1, Math.floor(settings.width / screen.width)) * screen.width : settings.width);

  // A plate (the logo, an image or a label) needs level H to stay
  // readable; the presets raise it, and this is the warning when it has
  // been lowered.
  let lowered = $derived(hasPlate(settings) && settings.level !== 'H');
  let imageClamped = $derived(settings.imageSource !== 'none' && settings.imageSize > maxImageSize(settings.level));

  // The offer to switch to qr-alpha: the same link's symbol in qr-alpha
  // against this one, from the two matrices.
  let dismissed = $state(readDismissed());
  function readDismissed(): boolean {
    try {
      return sessionStorage.getItem('nanourl.qr.offer') === 'dismissed';
    } catch {
      return false;
    }
  }
  function dismiss(): void {
    dismissed = true;
    try {
      sessionStorage.setItem('nanourl.qr.offer', 'dismissed');
    } catch {
      // no session storage: the offer returns next time, which is harmless
    }
  }
  let offer = $derived.by(() => {
    if (alpha === QR_ALPHA || !altLink || !built.qr || dismissed) return null;
    try {
      const alt = build(qrText(altLink, QR_ALPHA, { scheme: settings.scheme }), settings);
      const here = built.qr;
      const gain = alt.version < here.version;
      return { gain, from: here, to: alt };
    } catch {
      return null;
    }
  });

  const opt = <T extends string>(values: readonly T[]) => values.map((v) => ({ value: v, label: v }));
  const STYLE_OPTIONS = opt(MODULE_STYLES);
  const CORNER_OPTIONS = opt(CORNER_TYPES);
  const SHAPE_OPTIONS = opt(SHAPES);
  const MODE_OPTIONS = opt(MODES);
  const FORMAT_OPTIONS = opt(EXPORT_FORMATS);
  const IMAGE_OPTIONS = opt(IMAGE_SOURCES);
  const LEVEL_OPTIONS = EC_LEVELS.map((l) => ({ value: l, label: EC_LABEL(l), title: `recovers ${EC_RECOVERS[l]} of the symbol` }));
  const MASK_OPTIONS = [{ value: 'auto', label: 'auto' }, ...Array.from({ length: MASK_MAX + 1 }, (_, i) => ({ value: String(i), label: String(i) }))];
  const MARGIN_OPTIONS = MARGIN_PICKS.map((m) => ({ value: String(m), label: String(m) }));
  const ON_OFF = [
    { value: 'off', label: 'off' },
    { value: 'on', label: 'on' },
  ];
  const INHERIT = [
    { value: 'inherit', label: 'same as dots' },
    { value: 'own', label: 'own' },
  ];

  /** One field changed: re-validate the whole object, so every clamp and
   *  parse lives in `sanitize` rather than in each handler. */
  const set = (field: keyof QrSettings, value: unknown): void => {
    settings = sanitize({ ...settings, [field]: value });
  };
  const fieldValue = (e: Event): string => (e.currentTarget as HTMLInputElement).value;
  /** A bounded number field (lib/qr/fields.ts), applying into `settings`. */
  const bounded = (field: keyof QrSettings, lo: number, hi: number, integer = true) =>
    boundedField((v) => set(field, v), lo, hi, { integer, emptyIsAuto: field === 'version' });
  const hintId = (key: HintKey): string => `hint-${key}`;

  // --- image upload ---------------------------------------------------------
  let imageError = $state('');
  function onFile(e: Event): void {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > IMAGE_MAX_BYTES) {
      imageError = `${file.name} is ${Math.round(file.size / 1024)} KB; the most an image can be is ${Math.round(IMAGE_MAX_BYTES / 1024)} KB`;
      return;
    }
    imageError = '';
    const reader = new FileReader();
    reader.onload = () => {
      settings = applyImageSource({ ...settings, imageData: String(reader.result) }, 'upload');
    };
    reader.onerror = () => {
      imageError = `${file.name} could not be read`;
    };
    reader.readAsDataURL(file);
  }

  // --- export ---------------------------------------------------------------
  // Raster formats: our SVG rasterised through an <img> onto a canvas at the
  // export scale, then `toBlob` in the chosen format. Built on the first
  // click for the current symbol, then the anchor downloads it; cleared, and
  // its object URL released, whenever the symbol or the format changes.
  let rasterUrl = $state('');
  let exportError = $state('');
  let copyMessage = $state('');
  $effect(() => {
    void exported;
    void settings.format;
    void settings.quality;
    // untracked: the effect answers to the symbol and the format, not to
    // the URL it releases, or setting the URL would re-run it and drop it
    const old = untrack(() => rasterUrl);
    if (old) URL.revokeObjectURL(old);
    rasterUrl = '';
    exportError = '';
    copyMessage = '';
  });
  async function rasterize(svg: string, width: number, height: number, type: string, quality: number): Promise<Blob> {
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
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(`the browser cannot write ${type}`))), type, quality);
    });
  }
  const rasterBlob = (format: ExportFormat): Promise<Blob> => {
    if (!exported) throw new Error('nothing to export');
    return rasterize(exported.svg, exported.width * settings.scale, exported.height * settings.scale, MIME[format], settings.quality);
  };
  let downloadHref = $derived(settings.format === 'svg' ? svgHref || '#' : rasterUrl || '#');
  let downloadName = $derived(exportName(settings.fileName, code, settings.format));
  async function onDownload(e: MouseEvent): Promise<void> {
    if (settings.format === 'svg' || rasterUrl || !exported) return;
    e.preventDefault();
    const a = e.currentTarget as HTMLAnchorElement;
    try {
      rasterUrl = URL.createObjectURL(await rasterBlob(settings.format));
    } catch (err) {
      exportError = err instanceof Error ? err.message : String(err);
      return;
    }
    await tick();
    a.click();
  }
  async function onCopy(): Promise<void> {
    copyMessage = '';
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
      copyMessage = 'this browser cannot copy images to the clipboard; download the PNG instead';
      return;
    }
    try {
      const blob = await rasterBlob('png');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      copyMessage = 'copied ✓';
    } catch (err) {
      copyMessage = `copy failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  let shortLink = $derived(link.replace(/^https?:\/\//, ''));
  /** The preset the settings are, exactly, for the pressed chip; none once
   *  any control has changed them. */
  let currentPreset = $derived(presetOf(settings));
</script>

{#snippet lbl(key: HintKey, label: string)}
  <span class="lbl">{label}<Hint id={hintId(key)} text={HINTS[key]} /></span>
{/snippet}

<details bind:open data-testid={TESTID.qr}>
  <summary>QR code: scan the link</summary>
  {#if open}
    {#if offer}
      <div data-testid={TESTID.qrOffer}>
        <Callout>
          {#if offer.gain}
            A smaller QR is possible. Switching this link to the qr-alpha alphabet shrinks it from {offer.from.modules.size}×{offer.from.modules.size} to
            {offer.to.modules.size}×{offer.to.modules.size} squares, because QR codes store capital letters and digits more compactly.
            <span class="offer-actions">
              <Button size="sm" variant="primary" testid={TESTID.qrSwitch} onclick={() => onalpha?.(QR_ALPHA)}>switch to qr-alpha</Button>
              <Button size="sm" variant="ghost" onclick={dismiss}>dismiss</Button>
            </span>
          {:else}
            Switching this link to the qr-alpha alphabet would not make the QR smaller: it stays {offer.from.modules.size}×{offer.from.modules.size} squares.
            <span class="offer-actions"><Button size="sm" variant="ghost" onclick={dismiss}>dismiss</Button></span>
          {/if}
        </Callout>
      </div>
    {/if}

    <!-- Two columns on a wide viewport, the preview column (symbol and
         readout, nothing taller) sticky, so a control at the bottom of the
         options can be adjusted while the symbol stays in view; on a narrow
         one the preview sticks to the top of the viewport, capped to keep
         the controls usable under it. -->
    <div class="body">
    <div class="preview" data-testid={TESTID.qrPreview}>
    <div class="symbol" data-testid={TESTID.qrSvg} style:width="{displayWidth}px">
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- our own renderer's SVG of our own link, with every text escaped -->
      {@html screen?.svg ?? ''}
    </div>
    {#if built.error}<div class="err" role="alert" data-testid={TESTID.qrError}>cannot build this code: {built.error}</div>{/if}
    {#if isUnscannable(settings)}
      <div class="warn-text caption" role="status" data-testid={TESTID.qrUnscannable}>dotted corners on dotted modules leave too little for a scanner to find the corners by; pick another corner or module type</div>
    {/if}

    <!-- The readout: exactly the text in the symbol, and how the library
         segmented it. Caption, label and image are not in here; they are
         drawn. -->
    <div class="readout">
      <div class="text" data-testid={TESTID.qrText}>{text}</div>
      <div class="segs" data-testid={TESTID.qrInfo}>
        {#if built.qr}
          <span class="stat"
            ><b>{built.qr.modules.size}×{built.qr.modules.size}</b> squares (version {built.qr.version}) · level <b>{settings.level}</b> survives
            <b>{EC_RECOVERS[settings.level]}</b> damage · {packing}</span
          >
        {/if}
      </div>
    </div>

    </div>
    <div class="options">
    <div class="row presets">
      {@render lbl('presets', 'presets')}
      {#each PRESETS as name (name)}
        <span class="preset">
          <Chip pressed={currentPreset === name} selected={currentPreset === name} testid="qr-preset-{name}" ariaLabel="preset {name}" describedBy="hint-preset-{name}" onclick={() => (settings = applyPreset(name))}>{name}</Chip
          ><Hint id="hint-preset-{name}" text={PRESET_TABLE[name].hint} />
        </span>
      {/each}
      <Button size="sm" variant="ghost" describedBy={hintId('presets')} testid={TESTID.qrReset} onclick={() => (settings = sanitize(null))}>reset</Button>
    </div>

    <details class="group" open data-testid="qr-group-main">
      <summary>Main</summary>
      <div class="controls">
        {@render lbl('size', 'size')}
        <div class="row">
          <span class="num"><TextField type="number" min={WIDTH_MIN} max={WIDTH_MAX} ariaLabel="on-screen width in pixels" describedBy={hintId('size')} value={settings.width} {...bounded('width', WIDTH_MIN, WIDTH_MAX)} /></span>
          <span class="dim">px</span>
        </div>
        {@render lbl('margin', 'quiet zone')}
        <div class="row">
          <Segmented look="switch" label="quiet zone picks" describedBy={hintId('margin')} options={MARGIN_OPTIONS} value={String(settings.margin)} onchange={(v) => set('margin', v)} />
          <span class="num"><TextField type="number" min={0} max={MARGIN_MAX} ariaLabel="quiet zone in modules" describedBy={hintId('margin')} value={settings.margin} {...bounded('margin', 0, MARGIN_MAX)} /></span>
        </div>
        {@render lbl('padding', 'frame padding')}
        <div class="row">
          <span class="num"><TextField type="number" min={0} max={PADDING_MAX} ariaLabel="frame padding in modules" describedBy={hintId('padding')} value={settings.padding} {...bounded('padding', 0, PADDING_MAX)} /></span>
        </div>
        {@render lbl('shape', 'shape')}
        <Segmented look="switch" label="shape" describedBy={hintId('shape')} options={SHAPE_OPTIONS} value={settings.shape} onchange={(v) => set('shape', v as Shape)} />
        {@render lbl('version', 'version')}
        <div class="num">
          <TextField
            type="text"
            ariaLabel="QR version, {VERSION_MIN} to {VERSION_MAX}, or empty for automatic"
            describedBy={hintId('version')}
            placeholder="auto"
            value={settings.version === null ? '' : String(settings.version)}
            {...bounded('version', VERSION_MIN, VERSION_MAX)}
          />
        </div>
        {@render lbl('level', 'error correction')}
        <div>
          <Segmented look="switch" label="error correction" describedBy={hintId('level')} options={LEVEL_OPTIONS} value={settings.level} onchange={(v) => set('level', v as EcLevel)} />
          {#if lowered}
            <div class="warn-text caption" role="status" data-testid={TESTID.qrWarning}>
              below H the {settings.centreLabel.trim() ? 'label' : 'picture'} on the plate may make the code unreadable
            </div>
          {/if}
        </div>
        {@render lbl('mode', 'mode')}
        <div>
          <Segmented look="switch" label="segment mode" describedBy={hintId('mode')} options={MODE_OPTIONS} value={settings.mode} onchange={(v) => set('mode', v as Mode)} />
          {#if settings.mode === 'byte'}
            <div class="caption" role="status" data-testid={TESTID.qrModeNote}>byte mode {MODE_NOTE_BYTE}: {bytes} bytes in one segment</div>
          {/if}
        </div>
        {@render lbl('scheme', 'scheme in the text')}
        <Segmented look="switch" label="scheme in the QR text" describedBy={hintId('scheme')} options={ON_OFF} value={settings.scheme ? 'on' : 'off'} onchange={(v) => set('scheme', v === 'on')} />
        {@render lbl('mask', 'mask')}
        <Segmented look="switch" label="mask pattern" describedBy={hintId('mask')} options={MASK_OPTIONS} value={settings.mask === null ? 'auto' : String(settings.mask)} onchange={(v) => set('mask', v)} />
      </div>
    </details>

    <details class="group" data-testid="qr-group-dots">
      <summary>Dots</summary>
      <div class="controls">
        {@render lbl('style', 'type')}
        <Segmented look="switch" label="module style" describedBy={hintId('style')} options={STYLE_OPTIONS} value={settings.style} onchange={(v) => (settings = applyStyle(settings, v as ModuleStyle))} />
        {@render lbl('roundSize', 'round size')}
        <Segmented look="switch" label="round size" describedBy={hintId('roundSize')} options={ON_OFF} value={settings.roundSize ? 'on' : 'off'} onchange={(v) => set('roundSize', v === 'on')} />
        {@render lbl('dots', 'paint')}
        <QrPaint name="dots" describedBy={hintId('dots')} paint={settings.dots} onchange={(p) => set('dots', p)} />
      </div>
    </details>

    <details class="group" data-testid="qr-group-corners-square">
      <summary>Corners square</summary>
      <div class="controls">
        {@render lbl('cornersSquare', 'type')}
        <Segmented look="switch" label="corners square type" describedBy={hintId('cornersSquare')} options={CORNER_OPTIONS} value={settings.cornersSquareType} onchange={(v) => set('cornersSquareType', v as CornerType)} />
        {@render lbl('inherit', 'paint')}
        <div class="stack">
          <Segmented look="switch" label="corners square paint source" describedBy={hintId('inherit')} options={INHERIT} value={settings.cornersSquare ? 'own' : 'inherit'} onchange={(v) => set('cornersSquare', v === 'own' ? solid(settings.dots.color) : null)} />
          {#if settings.cornersSquare}
            <QrPaint name="corners square" describedBy={hintId('inherit')} paint={settings.cornersSquare} onchange={(p: Paint) => set('cornersSquare', p)} />
          {/if}
        </div>
      </div>
    </details>

    <details class="group" data-testid="qr-group-corners-dot">
      <summary>Corners dot</summary>
      <div class="controls">
        {@render lbl('cornersDot', 'type')}
        <Segmented look="switch" label="corners dot type" describedBy={hintId('cornersDot')} options={CORNER_OPTIONS} value={settings.cornersDotType} onchange={(v) => set('cornersDotType', v as CornerType)} />
        {@render lbl('inherit', 'paint')}
        <div class="stack">
          <Segmented look="switch" label="corners dot paint source" describedBy={hintId('inherit')} options={INHERIT} value={settings.cornersDot ? 'own' : 'inherit'} onchange={(v) => set('cornersDot', v === 'own' ? solid(settings.dots.color) : null)} />
          {#if settings.cornersDot}
            <QrPaint name="corners dot" describedBy={hintId('inherit')} paint={settings.cornersDot} onchange={(p: Paint) => set('cornersDot', p)} />
          {/if}
        </div>
      </div>
    </details>

    <details class="group" data-testid="qr-group-background">
      <summary>Background</summary>
      <div class="controls">
        {@render lbl('background', 'paint')}
        <div class="stack">
          <Segmented look="switch" label="background" describedBy={hintId('background')} options={[{ value: 'paint', label: 'paint' }, { value: 'transparent', label: 'transparent' }]} value={settings.transparent ? 'transparent' : 'paint'} onchange={(v) => set('transparent', v === 'transparent')} />
          {#if !settings.transparent}
            <QrPaint name="background" describedBy={hintId('background')} paint={settings.background} onchange={(p) => set('background', p)} />
          {/if}
        </div>
        {@render lbl('backgroundRound', 'round corners')}
        <div class="row">
          <span class="num"><TextField type="number" min={0} max={1} step={0.05} ariaLabel="background corner radius, 0 to 1" describedBy={hintId('backgroundRound')} value={settings.backgroundRound} {...bounded('backgroundRound', 0, 1, false)} /></span>
        </div>
        {@render lbl('invert', 'invert')}
        <div>
          <Button size="sm" describedBy={hintId('invert')} testid={TESTID.qrInvert} onclick={() => (settings = invertColours(settings))}>invert colours</Button>
          <div class="caption" data-testid={TESTID.qrDarkNote}>an inverted (light-on-dark) code needs a scanner that reads it; most phone cameras do, some scanners do not</div>
        </div>
      </div>
    </details>

    <details class="group" data-testid="qr-group-image">
      <summary>Image</summary>
      <div class="controls">
        {@render lbl('image', 'picture')}
        <div class="stack">
          <Segmented look="switch" label="picture" describedBy={hintId('image')} options={IMAGE_OPTIONS} value={settings.imageSource} onchange={(v) => (settings = applyImageSource(settings, v as ImageSource))} />
          {#if settings.imageSource === 'upload'}
            <input type="file" accept="image/*" aria-label="upload image" aria-describedby={hintId('image')} data-testid={TESTID.qrImageFile} oninput={onFile} />
            {#if imageError}<div class="err" role="alert" data-testid={TESTID.qrImageError}>{imageError}</div>{/if}
            {#if !settings.imageData}<div class="caption">choose a file up to {Math.round(IMAGE_MAX_BYTES / 1024)} KB</div>{/if}
          {/if}
        </div>
        {@render lbl('imageSize', 'size')}
        <div>
          <div class="row">
            <span class="num"><TextField type="number" min={0} max={1} step={0.05} ariaLabel="image size as a share of the code, 0 to 1" describedBy={hintId('imageSize')} value={settings.imageSize} {...bounded('imageSize', 0, 1, false)} /></span>
          </div>
          {#if imageClamped}
            <div class="warn-text caption" role="status" data-testid={TESTID.qrImageWarning}>
              drawn at {maxImageSize(settings.level).toFixed(2)}: level {settings.level} cannot lose more of the code than that
            </div>
          {/if}
        </div>
        {@render lbl('imageMargin', 'margin')}
        <div class="row">
          <span class="num"><TextField type="number" min={0} max={IMAGE_MARGIN_MAX} ariaLabel="image margin in pixels" describedBy={hintId('imageMargin')} value={settings.imageMargin} {...bounded('imageMargin', 0, IMAGE_MARGIN_MAX)} /></span>
          <span class="dim">px</span>
        </div>
        {@render lbl('hideBackgroundDots', 'hide dots behind')}
        <Segmented look="switch" label="hide background dots" describedBy={hintId('hideBackgroundDots')} options={ON_OFF} value={settings.hideBackgroundDots ? 'on' : 'off'} onchange={(v) => set('hideBackgroundDots', v === 'on')} />
      </div>
    </details>

    <details class="group" data-testid="qr-group-text">
      <summary>Text</summary>
      <div class="controls">
        {@render lbl('caption', 'caption')}
        <TextField sans ariaLabel="caption drawn under the code" describedBy={hintId('caption')} placeholder={shortLink} value={settings.caption} oninput={(e) => set('caption', fieldValue(e))} />
        {@render lbl('centreLabel', 'centre label')}
        <div>
          <div class="row">
            <span class="hex">
              <TextField
                sans
                ariaLabel="short text drawn on the centre plate in place of the picture"
                describedBy={hintId('centreLabel')}
                value={settings.centreLabel}
                oninput={(e) => (settings = applyCentreLabel(settings, fieldValue(e)))}
              />
            </span>
            <span class="dim" data-testid={TESTID.qrLabelCount}>{settings.centreLabel.length}/{CENTRE_LABEL_MAX}</span>
          </div>
          {#if screen?.error}<div class="err" role="alert" data-testid={TESTID.qrLabelError}>{screen.error}</div>{/if}
        </div>
      </div>
    </details>

    <details class="group" data-testid="qr-group-export">
      <summary>Export</summary>
      <div class="controls">
        {@render lbl('format', 'format')}
        <Segmented look="switch" label="export format" describedBy={hintId('format')} options={FORMAT_OPTIONS} value={settings.format} onchange={(v) => set('format', v as ExportFormat)} />
        {#if settings.format === 'jpeg' || settings.format === 'webp'}
          {@render lbl('quality', 'quality')}
          <div class="row">
            <span class="num"><TextField type="number" min={0.05} max={1} step={0.05} ariaLabel="{settings.format} quality, 0.05 to 1" describedBy={hintId('quality')} value={settings.quality} {...bounded('quality', 0.05, 1, false)} /></span>
          </div>
        {/if}
        {#if settings.format !== 'svg'}
          {@render lbl('scale', 'export scale')}
          <div class="row">
            <span class="num"><TextField type="number" min={SCALE_MIN} max={SCALE_MAX} ariaLabel="export scale in pixels per module" describedBy={hintId('scale')} value={settings.scale} {...bounded('scale', SCALE_MIN, SCALE_MAX)} /></span>
            <span class="dim">px per module{#if exported}, {exported.width * settings.scale}×{exported.height * settings.scale} px{/if}</span>
          </div>
        {/if}
        {@render lbl('fileName', 'file name')}
        <div class="row">
          <span class="hex"><TextField sans ariaLabel="file name" describedBy={hintId('fileName')} placeholder={exportName('', code, settings.format)} value={settings.fileName} oninput={(e) => set('fileName', fieldValue(e))} /></span>
          <span class="dim">{downloadName}</span>
        </div>
        {@render lbl('save', 'save')}
        <div class="row">
          <Button size="sm" href={downloadHref} download={downloadName} describedBy={hintId('save')} onclick={onDownload} testid={TESTID.qrDownload} disabled={!exported}>Download {settings.format.toUpperCase()}</Button>
          <Button size="sm" href={svgHref || '#'} download={exportName(settings.fileName, code, 'svg')} describedBy={hintId('save')} testid={TESTID.qrSvgDownload} disabled={!exported}>SVG</Button>
          <Button size="sm" describedBy={hintId('save')} onclick={onCopy} testid={TESTID.qrCopy} disabled={!exported}>Copy image</Button>
          {#if copyMessage}<span class="dim" role="status">{copyMessage}</span>{/if}
          {#if exportError}<span class="err" role="alert">{exportError}</span>{/if}
        </div>
      </div>
    </details>
    </div>
    </div>
  {/if}
</details>

<style>
  /* The symbol takes the chosen width and no more than the column; the
     inline SVG's viewBox does the rest. It carries no padding of its own:
     the quiet zone and the frame padding inside the document are the only
     framing, so the picture is not framed twice. */
  .symbol { max-width: 100%; margin-top: var(--s-3); }
  .symbol :global(svg) { display: block; width: 100%; height: auto; }
  /* One column, the preview stuck to the top of the viewport over the
     controls and capped at about 40% of its height: the symbol scales down
     while stuck, the readout scrolls if it must. */
  .body { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-4); }
  .preview {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--card);
    border-bottom: var(--border);
    padding-bottom: var(--s-2);
    max-height: 40vh;
    overflow: auto;
  }
  .preview .symbol :global(svg) { max-height: 26vh; width: auto; margin: 0 auto; }
  /* Two columns on a wide viewport: the preview beside the options, stuck
     a little below the top, no cap needed. */
  @media (min-width: 900px) {
    .body { grid-template-columns: minmax(0, 320px) minmax(0, 1fr); align-items: start; }
    .preview { top: var(--s-3); max-height: none; overflow: visible; border-bottom: 0; background: none; padding-bottom: 0; }
    .preview .symbol :global(svg) { max-height: none; width: 100%; }
  }
  .readout { margin-top: var(--s-3); }
  .text { font-family: var(--font-mono); font-size: var(--fs-sm); overflow-wrap: anywhere; }
  .segs { display: flex; align-items: center; flex-wrap: wrap; gap: var(--s-2); margin-top: var(--s-1); }
  .segs .stat { margin: 0; }
  .presets { margin-bottom: var(--s-3); }
  .preset { display: inline-flex; align-items: center; }
  .offer-actions { display: inline-flex; gap: var(--s-2); margin-left: var(--s-2); vertical-align: middle; }
  /* Collapsible groups, the way qr-code-styling arranges its options. The
     site's one <details> chrome applies, but a group is subordinate to the
     section it sits in: a rule down its left edge and a smaller, spaced
     summary keep it from reading as a sibling of "QR code" or "advanced". */
  .group { margin-top: var(--s-2); padding-left: var(--s-3); border-left: var(--border); }
  .group > summary { font-size: var(--fs-xs); letter-spacing: 0.04em; text-transform: uppercase; }
  /* Label column, control column; one column on a phone. */
  .controls {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    /* Label text and the first control's text share a baseline, whatever
       the control's height. */
    align-items: baseline;
    column-gap: var(--s-4);
    row-gap: var(--s-3);
    margin-top: var(--s-3);
  }
  .lbl { color: var(--dim); font-size: var(--fs-sm); white-space: nowrap; }
  .row { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--s-2); }
  .stack { display: flex; flex-direction: column; gap: var(--s-2); }
  .row .dim { font-size: var(--fs-xs); }
  .num { width: 5.5em; display: inline-block; }
  .hex { width: 11em; display: inline-block; }
  @media (max-width: 480px) {
    .controls { grid-template-columns: minmax(0, 1fr); row-gap: var(--s-1); }
    .lbl { margin-top: var(--s-2); }
  }
</style>
