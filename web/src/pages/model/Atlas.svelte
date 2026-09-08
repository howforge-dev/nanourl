<script module lang="ts">
  // Classification taxonomy for atlas colouring: regex on the piece's
  // display text, first match wins. A fixed list, not derived from the
  // current example: a piece's class never changes as you type a different
  // URL, only which points get a blue "in this URL" ring.
  interface ClassDef {
    name: string;
    color: string;
    test: (piece: string) => boolean;
  }
  // Each TLD appears once: a repeated alternative in a regex only slows
  // matching, it never changes what matches.
  const TLD_RE =
    /^(com|org|net|io|de|uk|jp|edu|gov|ru|fr|co|us|info|cn|br|au|nl|it|es|ca|ch|se|pl|cz|in|kr|tw|nz|ie|at|be|dk|fi|no|pt|gr|hu|ro|mx|ar|za|tr|il|ua|sk|si|hr|lt|lv|ee|bg|rs|by|kz|vn|th|id|my|sg|hk|ph|pk|bd|lk|ae|sa|eg|ma|ng|ke|mil|biz|name|mobi|xyz|app|dev|online|site|store|tech|top|club|live|news|blog)$/;
  const DELIM_RE = /^[!#$%&'()*+,\-./:;=?@[\]^_`{|}~]$/;
  const CLASSES: ClassDef[] = [
    { name: 'eos', color: COLOR.dim, test: (p) => p === '<eos>' },
    { name: 'scheme', color: COLOR.ok, test: (p) => p === 'https://' || p === 'http://' },
    { name: 'escape', color: COLOR.bad, test: (p) => /^%[0-9A-Fa-f]{2}$/.test(p) },
    { name: 'delimiter', color: COLOR.warn, test: (p) => DELIM_RE.test(p) },
    { name: 'tld', color: COLOR.acc, test: (p) => TLD_RE.test(p) },
    { name: 'digits', color: FIGURE.violet, test: (p) => /^[0-9]+$/.test(p) },
    { name: 'word', color: FIGURE.cyan, test: (p) => /^[A-Za-z]+$/.test(p) },
    { name: 'mixed', color: FIGURE.slate, test: () => true },
  ];

  // GPT-2's byte<->unicode table (HF's ByteLevel pretokenizer alphabet):
  // printable bytes map to themselves, the rest to codepoints 256, 257, ...
  // in ascending byte order. Needed to turn tokenizer.json's stored piece
  // strings back into display text, independent of the wasm codec, since
  // the atlas needs every vocab id's piece, not just the current URL's.
  function byteDecoder(): (tok: string) => string {
    const printable = new Set<number>();
    for (let i = 33; i <= 126; i++) printable.add(i);
    for (let i = 161; i <= 172; i++) printable.add(i);
    for (let i = 174; i <= 255; i++) printable.add(i);
    const charToByte = new Map<string, number>();
    let n = 0;
    for (let b = 0; b < 256; b++) {
      if (printable.has(b)) charToByte.set(String.fromCharCode(b), b);
      else {
        charToByte.set(String.fromCodePoint(256 + n), b);
        n++;
      }
    }
    return (tok: string): string => {
      const bytes: number[] = [];
      for (const ch of tok) bytes.push(charToByte.get(ch) ?? 63);
      try {
        return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
      } catch {
        return tok;
      }
    };
  }
</script>

<script lang="ts">
  // Embedding atlas: every piece's wte embedding, UMAP-projected to 2D by
  // training/atlas.py, fetched lazily (atlas.bin + tokenizer.json, both cached
  // asset fetches) on first open rather than eagerly at page load.
  import { onDestroy, onMount, tick } from 'svelte';
  import type { Info, Tok } from '../../lib/codec/types';
  import { fetchAsset, type Manifest } from '../../lib/codec/loader';
  import rawManifest from '../../lib/assets.json';

  // assets.json's shape is inferred from whatever the file currently
  // contains (it's regenerated per-environment by `task web:assets` and
  // gitignored), so assert the stable contract instead of trusting that
  // literal inference, matching loader.ts's own cast of the same import.
  const manifest = rawManifest as Manifest;
  import type { TooltipApi } from './Tooltip.svelte';
  import { escapeHtml } from './Tooltip.svelte';
  import { fmtExact } from '../../lib/format';
  import Panel from '../../lib/ui/Panel.svelte';
  import Button from '../../lib/ui/Button.svelte';
  import Chip from '../../lib/ui/Chip.svelte';
  import ScrollBox from '../../lib/ui/ScrollBox.svelte';
  import TextField from '../../lib/ui/TextField.svelte';
  import { CANVAS_FONT, COLOR, FIGURE } from '../../lib/ui/tokens';

  let {
    info,
    tokens,
    tooltip,
  }: {
    info: Info;
    tokens: Tok[];
    tooltip: TooltipApi;
  } = $props();

  let panel: ReturnType<typeof Panel> | undefined = $state();
  let open = $state(false);
  let computed = $state(false);
  let fetching = $state(false);
  let error = $state('');

  let pieces: string[] = [];
  let pieceToId = new Map<string, number>();
  let classes: Uint8Array | null = null;
  let atlasXY: Uint16Array | null = null;

  let clsOn: boolean[] = $state(CLASSES.map(() => true));
  let view = $state({ x0: 0, y0: 0, x1: 65535, y1: 65535 });
  let dragA: { x: number; y: number } | null = $state(null);
  let dragB: { x: number; y: number } | null = $state(null);
  let query = $state('');
  let hits: number[] | null = $state(null);
  let redrawTick = $state(0); // bumped to force a redraw without changing view/hits/etc

  let canvasEl: HTMLCanvasElement | undefined = $state();
  let wrapEl: HTMLDivElement | undefined = $state();

  let inputIds = $derived.by(() => {
    if (!computed) return [] as number[];
    const seen = new Set<number>();
    for (const t of tokens) {
      const id = pieceToId.get(t.piece);
      if (id !== undefined) seen.add(id);
    }
    return [...seen];
  });

  let zoomed = $derived(view.x0 > 0 || view.y0 > 0 || view.x1 < 65535 || view.y1 < 65535);

  async function loadAtlas(): Promise<void> {
    const atlasEntry = manifest.atlas;
    if (!atlasEntry) {
      error = 'atlas not built: run `task web:assets ATLAS=atlas/atlas.bin` after `uv run --extra atlas python -m training.atlas ...`';
      return;
    }
    fetching = true;
    try {
      const [tokBytes, atlasBytes] = await Promise.all([fetchAsset(manifest.tokenizer, () => {}), fetchAsset(atlasEntry, () => {})]);
      const tj = JSON.parse(new TextDecoder().decode(tokBytes)) as { model: { vocab: Record<string, number> } };
      const dec = byteDecoder();
      const arr = new Array<string>(info.vocab).fill('');
      for (const [tokStr, id] of Object.entries(tj.model.vocab)) {
        if (id >= 0 && id < info.vocab) arr[id] = dec(tokStr);
      }
      arr[0] = '<eos>'; // id 0 is always <eos> (settled tokenizer decision)
      pieces = arr;
      const p2i = new Map<string, number>();
      arr.forEach((pc, id) => {
        if (!p2i.has(pc)) p2i.set(pc, id);
      });
      pieceToId = p2i;
      const cls = new Uint8Array(info.vocab);
      for (let i = 0; i < info.vocab; i++) {
        const p = arr[i];
        for (let c = 0; c < CLASSES.length; c++) {
          if (CLASSES[c].test(p)) {
            cls[i] = c;
            break;
          }
        }
      }
      classes = cls;
      // <u16 x, u16 y> per token, in id order; anything else is a stale or
      // mismatched atlas.bin (wrong vocab, truncated download) and must not
      // be silently truncated/reinterpreted into a wrong-looking scatter.
      const expectedBytes = info.vocab * 4;
      if (atlasBytes.byteLength !== expectedBytes) {
        throw new Error(`atlas.bin is ${atlasBytes.byteLength} bytes, expected ${expectedBytes} (vocab ${info.vocab} × 4); rebuild it with training/atlas.py`);
      }
      atlasXY = new Uint16Array(atlasBytes.buffer, atlasBytes.byteOffset, info.vocab * 2);
      computed = true;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      fetching = false;
    }
  }

  $effect(() => {
    if (open && !computed && !fetching && !error) void loadAtlas();
  });

  const atlasS = (): number => Math.min(920, Math.max(340, (wrapEl?.clientWidth ?? document.body.clientWidth) - 20));

  function draw(): void {
    if (!computed || !atlasXY || !classes || !canvasEl) return;
    const S = atlasS();
    const cv = canvasEl;
    cv.width = S * 2;
    cv.height = S * 2;
    const g = cv.getContext('2d');
    if (!g) return;
    g.fillStyle = COLOR.bg;
    g.fillRect(0, 0, S * 2, S * 2);
    const vx = view.x1 - view.x0;
    const vy = view.y1 - view.y0;
    const px = (x: number) => ((x - view.x0) / vx) * (S * 2 - 4);
    const py = (y: number) => ((y - view.y0) / vy) * (S * 2 - 4);
    const ps = Math.min(7, Math.max(2, 2 * Math.sqrt(65535 / vx)));
    const cols = CLASSES.map((c) => c.color);
    const visible: number[] = [];
    g.globalAlpha = 0.6;
    for (let i = 0; i < info.vocab; i++) {
      const c = classes[i];
      if (!clsOn[c]) continue;
      const x = atlasXY[2 * i];
      const y = atlasXY[2 * i + 1];
      if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
      g.fillStyle = cols[c];
      g.fillRect(px(x), py(y), ps, ps);
      if (visible.length <= 240) visible.push(i);
    }
    g.globalAlpha = 1;
    if (visible.length && visible.length <= 240 && zoomed) {
      g.font = CANVAS_FONT;
      g.fillStyle = COLOR.txt;
      for (const i of visible) g.fillText(pieces[i].slice(0, 26), px(atlasXY[2 * i]) + ps + 5, py(atlasXY[2 * i + 1]) + ps + 4);
    }
    if (inputIds.length) {
      g.strokeStyle = COLOR.acc;
      g.lineWidth = 2;
      for (const i of inputIds) {
        const x = atlasXY[2 * i];
        const y = atlasXY[2 * i + 1];
        if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
        g.beginPath();
        g.arc(px(x) + ps / 2, py(y) + ps / 2, ps + 6, 0, 7);
        g.stroke();
      }
      g.lineWidth = 1;
    }
    if (hits) {
      g.strokeStyle = COLOR.txt;
      for (const i of hits) {
        const x = atlasXY[2 * i];
        const y = atlasXY[2 * i + 1];
        if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
        g.beginPath();
        g.arc(px(x) + ps / 2, py(y) + ps / 2, ps + 4, 0, 7);
        g.stroke();
      }
    }
    if (dragA && dragB) {
      g.strokeStyle = COLOR.acc;
      g.setLineDash([8, 5]);
      g.lineWidth = 2;
      g.strokeRect(
        px(Math.min(dragA.x, dragB.x)),
        py(Math.min(dragA.y, dragB.y)),
        Math.abs(px(dragA.x) - px(dragB.x)),
        Math.abs(py(dragA.y) - py(dragB.y)),
      );
      g.setLineDash([]);
      g.lineWidth = 1;
    }
  }

  $effect(() => {
    if (!open) return;
    void computed;
    void view;
    void dragA;
    void dragB;
    void hits;
    void clsOn;
    void inputIds;
    void redrawTick;
    void tick().then(draw);
  });

  function atlasPos(ev: MouseEvent): { x: number; y: number } {
    const r = canvasEl!.getBoundingClientRect();
    const S = atlasS();
    return {
      x: view.x0 + ((ev.clientX - r.left) / S) * (view.x1 - view.x0),
      y: view.y0 + ((ev.clientY - r.top) / S) * (view.y1 - view.y0),
    };
  }
  function onDown(ev: MouseEvent): void {
    dragA = atlasPos(ev);
    dragB = null;
    ev.preventDefault();
  }
  function onMove(ev: MouseEvent): void {
    if (!computed || !atlasXY || !classes) return;
    if (dragA) {
      dragB = atlasPos(ev);
      return;
    }
    const m = atlasPos(ev);
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < info.vocab; i++) {
      if (!clsOn[classes[i]]) continue;
      const dx = atlasXY[2 * i] - m.x;
      const dy = atlasXY[2 * i + 1] - m.y;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    const reach = (view.x1 - view.x0) / 40;
    if (best < 0 || bd > reach * reach) {
      tooltip.hide();
      return;
    }
    tooltip.show(ev, `<b>${escapeHtml(pieces[best])}</b> · id ${best} · ${CLASSES[classes[best]].name}`);
  }
  function onUp(ev: MouseEvent): void {
    if (!dragA) return;
    const b = atlasPos(ev);
    const w = Math.abs(b.x - dragA.x);
    const h = Math.abs(b.y - dragA.y);
    if (w > 200 && h > 200) {
      const side = Math.max(w, h, 400);
      const cx = (dragA.x + b.x) / 2;
      const cy = (dragA.y + b.y) / 2;
      view = { x0: cx - side / 2, y0: cy - side / 2, x1: cx + side / 2, y1: cy + side / 2 };
    }
    dragA = null;
    dragB = null;
  }
  function onLeave(): void {
    tooltip.hide();
    if (dragA) {
      dragA = null;
      dragB = null;
    }
  }
  function resetView(): void {
    view = { x0: 0, y0: 0, x1: 65535, y1: 65535 };
  }
  function onQueryInput(e: Event): void {
    const q = (e.currentTarget as HTMLInputElement).value;
    query = q;
    if (q.length >= 2 && computed) {
      const found: number[] = [];
      for (let i = 0; i < info.vocab && found.length < 400; i++) if (pieces[i].includes(q)) found.push(i);
      hits = found;
    } else {
      hits = null;
    }
  }

  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  function onResize(): void {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      redrawTick++;
    }, 200);
  }
  onMount(() => {
    addEventListener('resize', onResize);
  });
  onDestroy(() => {
    removeEventListener('resize', onResize);
    if (resizeTimer) clearTimeout(resizeTimer);
  });

  export async function focus(): Promise<void> {
    await panel?.focus();
  }
</script>

<Panel bind:this={panel} bind:open title="embedding atlas">
  {#snippet sub()}
    all {fmtExact(info.vocab)} piece embeddings from the shipped weights, UMAP-projected to 2D. Hover to
    identify, drag a box to zoom (labels appear up close), double-click to reset;
    <span class="acc">blue rings</span> mark the current URL's tokens
  {/snippet}
  {#if open}
    {#if error}
      <p class="err" role="alert">{error}</p>
    {:else if !computed}
      <p class="note">{fetching ? 'loading atlas…' : 'computing…'}</p>
    {:else}
      <div class="legend">
        {#each CLASSES as c, i (c.name)}
          <!-- aria-pressed: which classes are shown was conveyed by opacity
               alone. -->
          <Chip pressed={clsOn[i]} muted={!clsOn[i]} onclick={() => (clsOn = clsOn.map((v, j) => (j === i ? !v : v)))}>
            <i style:background={c.color}></i>{c.name}
          </Chip>
        {/each}
      </div>
      <TextField
        value={query}
        oninput={onQueryInput}
        ariaLabel="search token pieces in the atlas"
        placeholder="search pieces… e.g. com or item"
      />
      {#if zoomed}
        <span class="reset"><Button size="sm" tone="accent" onclick={resetView}>reset zoom</Button></span>
      {/if}
      <ScrollBox style="margin-top: var(--s-3)" bind:element={wrapEl}>
        <canvas
          class="attn"
          bind:this={canvasEl}
          style:width="{atlasS()}px"
          style:height="{atlasS()}px"
          onmousedown={onDown}
          onmousemove={onMove}
          onmouseup={onUp}
          onmouseleave={onLeave}
          ondblclick={resetView}
        ></canvas>
      </ScrollBox>
    {/if}
  {/if}
</Panel>

<style>
  .legend { display: flex; flex-wrap: wrap; gap: var(--s-2); margin: var(--s-3) 0; }
  /* The swatch that says which class a chip toggles. */
  .legend i { width: var(--s-2); height: var(--s-2); border-radius: 50%; display: inline-block; }
  .reset { display: inline-block; margin-left: var(--s-2); }
</style>
