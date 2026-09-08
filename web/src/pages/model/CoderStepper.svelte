<script lang="ts">
  // Arithmetic coder stepper: walks the interval-halving coder one action at
  // a time, reusing the JS replica in web/src/lib/coderReplay.ts. Disabled
  // with an inline error (never silently wrong) if the replica's bitstr
  // doesn't reproduce the wasm's own bitstr exactly.

  import type { EncodeResult } from '../../lib/codec/types';
  import { replay, headerBits, type ReplayResult } from '../../lib/coderReplay';
  import type { TooltipApi } from './Tooltip.svelte';
  import { escapeHtml } from './Tooltip.svelte';
  import { costParts, fmtBits, fmtPct, fmtShare } from '../../lib/format';
  import Panel from '../../lib/ui/Panel.svelte';
  import Button from '../../lib/ui/Button.svelte';

  let {
    lastEnc,
    k,
    onSelectK,
    onProgress,
    tooltip,
  }: {
    lastEnc: EncodeResult | null;
    k: number;
    onSelectK: (i: number) => void;
    onProgress: (bits: number) => void;
    tooltip: TooltipApi;
  } = $props();

  let panel: ReturnType<typeof Panel> | undefined = $state();
  let open = $state(false);
  let openedOnce = false;

  let subB = $state(0);
  // undefined until the first effect run, which seeds it from k's current
  // value; a plain (non-reactive) tracker deliberately only capturing a
  // snapshot each time, not a live binding to the k prop.
  let lastSeenK: number | undefined;
  let pendingOverride: number | null = null;

  let replayResult: ReplayResult | null = $derived.by(() => {
    if (!lastEnc || !lastEnc.tokens.length || lastEnc.tokens[0].clo === undefined) return null;
    try {
      const r = replay(lastEnc.tokens, lastEnc.version);
      // strict equality: replay() includes coder.rs's finish() flush, so
      // the replica's bitstr must equal the wasm's exactly, not just prefix it
      const ok = r.bitstr === lastEnc.bitstr && r.steps.every((st, i) => st.emitted === lastEnc.tokens[i].emit);
      return ok ? r : null;
    } catch (e) {
      // Logged, not swallowed: the panel below tells the user "this is a bug
      // in coderReplay.ts", and without this that message carries zero
      // diagnostic. It also turns a drift into an E2E failure: every spec
      // asserts no console.error.
      // eslint-disable-next-line no-console -- see above; this is a "must never happen" path
      console.error('coderReplay threw against the wasm bitstream:', e);
      return null;
    }
  });
  let hasCoderData = $derived(!!lastEnc && lastEnc.tokens.length > 0 && lastEnc.tokens[0].clo !== undefined);
  let diverged = $derived(hasCoderData && !replayResult);

  $effect(() => {
    if (k !== lastSeenK) {
      lastSeenK = k;
      if (pendingOverride !== null) {
        subB = pendingOverride;
        pendingOverride = null;
      } else {
        subB = 0;
      }
    }
  });

  function selectToken(i: number): void {
    if (!lastEnc) return;
    onSelectK(Math.max(0, Math.min(lastEnc.tokens.length - 1, i)));
  }
  function stepPrevToken(): void {
    selectToken(k - 1);
  }
  function stepNextToken(): void {
    selectToken(k + 1);
  }
  /** Real renormalization actions for token `kk`, plus one extra reachable
   * sub-step on the LAST token only: coder.rs's finish() flush, which is
   * not part of any token's own renormalization loop but is the true final
   * state of the stream, so the stepper models it as one more click. */
  function maxSubFor(kk: number): number {
    if (!replayResult) return 0;
    const acts = replayResult.steps[kk]?.acts.length ?? 0;
    return lastEnc && kk === lastEnc.tokens.length - 1 ? acts + 1 : acts;
  }
  function stepForward(): void {
    if (!replayResult || !lastEnc) return;
    const maxSub = maxSubFor(k);
    if (subB < maxSub) subB++;
    else if (k < lastEnc.tokens.length - 1) selectToken(k + 1);
  }
  function stepBack(): void {
    if (!replayResult || !lastEnc) return;
    if (subB > 0) {
      subB--;
    } else if (k > 0) {
      const newK = k - 1;
      pendingOverride = maxSubFor(newK);
      selectToken(newK);
    }
  }

  function cumBits(upto: number): number {
    if (!lastEnc) return 0;
    let b = 0;
    for (let i = 0; i <= upto && i < lastEnc.tokens.length; i++) b += lastEnc.tokens[i].bits;
    return b;
  }

  interface Bar {
    lo: number;
    hi: number;
  }
  interface Zone {
    left: string;
    width: string;
    bg: string;
    border: string;
    color: string;
    text: string;
  }
  interface StepVM {
    label: string;
    before: Bar;
    after: Bar;
    slice: Bar | null; // the bright zoom slice, only meaningful on subB===0
    zoom: boolean;
    zone: Zone | null;
    actionHtml: string;
    afterCaption: string;
    bitstreamHtml: string;
    stepBitsHtml: string;
    progressPct: number;
    writtenForB64: number;
  }

  let vm: StepVM | null = $derived.by(() => {
    if (!lastEnc || !replayResult) return null;
    const n = lastEnc.tokens.length;
    const t = lastEnc.tokens[k];
    const st = replayResult.steps[k];
    if (!t || !st) return null;
    const realActs = st.acts.length; // this token's own renormalization actions
    const extMaxSub = maxSubFor(k); // + 1 on the last token, for the finish() pseudo-step below
    const clampedSubB = Math.max(0, Math.min(extMaxSub, subB));
    const isFinishStep = k === n - 1 && clampedSubB === realActs + 1;

    const label = `token <b>${k + 1}/${n}</b>: encoding <b class="mono">${escapeHtml(t.piece)}</b> (${fmtBits(t.bits, 1, 'bits')}) · <b>${cumBits(k).toFixed(1)}</b>/${lastEnc.coded_bits} bits so far`;
    const hdr = headerBits(lastEnc.version);
    const done = cumBits(k);
    const total = lastEnc.coded_bits;

    // coder.rs's finish() (pending += 1; emit(low < QUARTER ? 0 : 1)) isn't
    // part of any token's renormalization loop, so it's modeled as one more
    // reachable step past the last token's real actions rather than folded
    // into the branches below.
    if (isFinishStep) {
      const lastKnown: Bar = realActs > 0 ? st.acts[realActs - 1] : { lo: st.post[0], hi: st.post[1] };
      const prevWritten = realActs > 0 ? st.acts[realActs - 1].emitted : st.emitted;
      const stepStart = st.prevEmitted;
      const written = replayResult.bitstr.length; // the full stream; finish() is always the true end
      const { bit: finishBit, flush } = replayResult.finish;
      const flipped = finishBit === '0' ? '1' : '0';
      const actionHtml =
        `<b>finish:</b> the stream must pin down exactly where the interval ended up, so the coder appends one ` +
        `final settle bit (<b style="color:var(--ok)">writes ${finishBit}</b>), then ${flush} complementary ` +
        `bit${flush > 1 ? 's' : ''} (<b style="color:var(--ok)">${flipped.repeat(flush)}</b>) that resolve whatever ` +
        `was still deferred and complete the stream`;
      const bitstreamHtml =
        `<span style="color:var(--warn)">1</span>` +
        `<span style="color:var(--ok)">${hdr}</span>` +
        `<span>${lastEnc.bitstr.slice(0, stepStart)}</span>` +
        `<span style="color:var(--ok);background:rgba(63,185,80,.14)">${lastEnc.bitstr.slice(stepStart, prevWritten)}</span>` +
        `<span style="color:var(--ink);background:var(--ok);border-radius:var(--r-1);padding:0 1px;font-weight:700">${lastEnc.bitstr.slice(prevWritten, written)}</span>`;
      const stepBitsHtml =
        `written <b>${written}</b> of ${total} payload bits` +
        ` · after this token the interval is 2<sup>−${done.toFixed(1)}</sup> of the original line, worth <b>${done.toFixed(1)}</b> bits`;
      return {
        label,
        before: lastKnown,
        after: lastKnown,
        slice: null,
        zoom: false,
        zone: null,
        actionHtml,
        afterCaption: 'after: the stream is complete; every deferred bit is now resolved',
        bitstreamHtml,
        stepBitsHtml,
        progressPct: 100,
        writtenForB64: written,
      };
    }

    const before: Bar = clampedSubB === 0 ? { lo: st.pre[0], hi: st.pre[1] } : clampedSubB === 1 ? { lo: st.post[0], hi: st.post[1] } : st.acts[clampedSubB - 2];
    const after: Bar = clampedSubB === 0 ? { lo: st.post[0], hi: st.post[1] } : st.acts[clampedSubB - 1];

    let zone: Zone | null = null;
    let actionHtml: string;
    let slice: Bar | null = null;
    if (clampedSubB === 0) {
      slice = after;
      const fr = t.chi! - t.clo!;
      actionHtml =
        `<b>zoom:</b> the model gives this token the bright slice of the current interval (${fmtPct(fr, t.bits)} of it = ${fmtBits(t.bits, 1, 'bits')}); the coder makes that slice the new interval` +
        (realActs === 0
          ? `. The new interval still straddles 1/2 too loosely to settle any bit, so this token's information gets written by ${k === n - 1 ? 'the final flush' : 'later tokens'}`
          : '');
    } else {
      const a = st.acts[clampedSubB - 1];
      if (a.t === 'E3') {
        zone = {
          left: '25%',
          width: '50%',
          bg: 'rgba(210,153,34,.3)',
          border: '1px dashed var(--warn)',
          color: 'var(--warn)',
          text: '1/4 – 3/4 straddle zone',
        };
        actionHtml =
          'the interval hugs 1/2 (inside the shaded amber zone): the next stream bits are either 0<i>111…</i> or 1<i>000…</i>, undecidable until a later step. The coder <b style="color:var(--warn)">defers one bit</b> (amber ? in the stream) and doubles around 1/2';
      } else {
        zone = {
          left: a.t === '0' ? '0' : '50%',
          width: '50%',
          bg: 'rgba(88,166,255,.28)',
          border: '1px dashed var(--acc)',
          color: 'var(--acc)',
          text: (a.t === '0' ? 'left' : 'right') + ' half (settled)',
        };
        actionHtml =
          `the whole interval sits in the ${a.t === '0' ? 'left' : 'right'} half (shaded blue above). That half is now certain, so the coder <b style="color:var(--ok)">writes ${a.t}</b>` +
          (a.flush
            ? `, which also resolves the ${a.flush} deferred bit${a.flush > 1 ? 's' : ''}: the amber ?${a.flush > 1 ? 's' : ''} → <b style="color:var(--ok)">${(a.t === '0' ? '1' : '0').repeat(a.flush)}</b> (a carry works exactly like 0.0999… vs 0.1000… in decimal)`
            : '') +
          `, then doubles the kept half to full width`;
      }
    }

    const afterCaption =
      clampedSubB === 0
        ? 'after the zoom: the slice is the new working interval (same number line)'
        : st.acts[clampedSubB - 1].t === 'E3'
          ? 'after: the middle of the line stretched ×2; the interval is re-centered around 1/2'
          : `after: the kept ${st.acts[clampedSubB - 1].t === '0' ? 'left' : 'right'} half stretched to become the new 0–1 line, so the interval appears twice as wide`;

    const written = clampedSubB === 0 ? st.prevEmitted : st.acts[clampedSubB - 1].emitted;
    const pendNow = clampedSubB === 0 ? (k > 0 ? replayResult!.steps[k - 1].pend : 0) : st.acts[clampedSubB - 1].pend;
    const stepStart = st.prevEmitted;
    const prevWritten = clampedSubB === 0 ? written : clampedSubB === 1 ? st.prevEmitted : st.acts[clampedSubB - 2].emitted;

    const bitstreamHtml =
      `<span style="color:var(--warn)">1</span>` +
      `<span style="color:var(--ok)">${hdr}</span>` +
      `<span>${lastEnc.bitstr.slice(0, stepStart)}</span>` +
      `<span style="color:var(--ok);background:rgba(63,185,80,.14)">${lastEnc.bitstr.slice(stepStart, prevWritten)}</span>` +
      `<span style="color:var(--ink);background:var(--ok);border-radius:var(--r-1);padding:0 1px;font-weight:700">${lastEnc.bitstr.slice(prevWritten, written)}</span>` +
      (pendNow
        ? `<span style="color:var(--dim)" title="the next written bit: its value decides the deferred ?s">·</span>` +
          `<span style="color:var(--warn)" title="deferred bits, which will be the complement of the next written bit">${'?'.repeat(pendNow)}</span>`
        : '') +
      `<span style="color:var(--dim)">${'·'.repeat(Math.max(0, lastEnc.bitstr.length - written - pendNow - (pendNow ? 1 : 0)))}</span>`;

    const stepBitsHtml =
      `written <b>${written}</b> of ${total} payload bits` +
      (pendNow ? ` (+${pendNow} deferred)` : '') +
      ` · after this token the interval is 2<sup>−${done.toFixed(1)}</sup> of the original line, worth <b>${done.toFixed(1)}</b> bits`;

    return {
      label,
      before,
      after,
      slice,
      zoom: clampedSubB === 0,
      zone,
      actionHtml,
      afterCaption,
      bitstreamHtml,
      stepBitsHtml,
      progressPct: Math.min(100, (written / total) * 100),
      writtenForB64: written,
    };
  });

  $effect(() => {
    if (vm) onProgress(vm.writtenForB64);
    else if (lastEnc) onProgress(lastEnc.bitstr.length);
  });

  function barStyle(b: Bar): string {
    return `left:${b.lo * 100}%;width:${Math.max(0.15, (b.hi - b.lo) * 100)}%`;
  }

  function binFrac(f: number, n: number): string {
    let out = '.';
    for (let i = 0; i < n; i++) {
      f *= 2;
      const bit = f >= 1 ? 1 : 0;
      out += bit;
      if (bit) f -= 1;
    }
    return out + '…₂';
  }

  function ivalHover(which: 'A' | 'B') {
    return (ev: MouseEvent) => {
      if (!vm) return;
      const el = ev.currentTarget as HTMLElement;
      const r = el.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
      const iv = which === 'A' ? vm.before : vm.after;
      const w = iv.hi - iv.lo;
      const inIv = f >= iv.lo && f < iv.hi;
      let html = `position ${f.toFixed(5)} = ${binFrac(f, 12)}<br>`;
      if (vm.zoom && which === 'A' && vm.slice && f >= vm.slice.lo && f < vm.slice.hi) {
        const sw = vm.slice.hi - vm.slice.lo;
        html += `inside the token's slice [${vm.slice.lo.toFixed(5)}, ${vm.slice.hi.toFixed(5)}), <span style="white-space:nowrap">width 2<sup>−${(-Math.log2(sw)).toFixed(1)}</sup></span>`;
      } else if (inIv) {
        html += `inside the working interval [${iv.lo.toFixed(5)}, ${iv.hi.toFixed(5)}), <span style="white-space:nowrap">width 2<sup>−${(-Math.log2(w)).toFixed(1)}</sup></span>; everything the URL has said so far survives in here`;
      } else {
        html += `outside the working interval: URLs that made different choices live here`;
      }
      tooltip.show(ev, html);
    };
  }

  // ---- the finished stream, divided by token ----
  function onTapeMove(ev: MouseEvent, i: number): void {
    if (!lastEnc) return;
    const t = lastEnc.tokens[i];
    const total = lastEnc.tokens.reduce((a, tt) => a + tt.bits, 0) || 1;
    tooltip.show(ev, `<b>${escapeHtml(t.piece)}</b> · ${fmtBits(t.bits, 1, 'bits')} · ${fmtShare(t.bits / total)} of the stream`);
  }
  let tapeTotal = $derived(lastEnc ? lastEnc.tokens.reduce((a, t) => a + t.bits, 0) || 1 : 1);

  export async function focus(): Promise<void> {
    await panel?.focus();
  }

  // The coder is a walkthrough: first open starts at step 1 (token 0), while
  // the page default (last token) stays best for attention/readout.
  $effect(() => {
    if (open && !openedOnce && lastEnc) {
      openedOnce = true;
      if (k !== 0) selectToken(0);
    }
  });
</script>

<Panel bind:this={panel} bind:open title="arithmetic coder">
  {#snippet sub()}
    step through the encoding: at every token the number line is split into slices (one per candidate piece,
    width = its probability) and the interval zooms into the slice of the piece the URL actually contains. Thin
    slice = many bits, fat slice = almost free
  {/snippet}
  {#if open}
    {#if !lastEnc}
      <p class="note">select a token above…</p>
    {:else if diverged}
      <p class="err" role="alert">
        stepper unavailable: the page-side coder replay did not match the wasm bitstream. This is a bug in
        web/src/lib/coderReplay.ts, not in the compressed URL, so the panel refuses to show a stepper that might lie.
      </p>
    {:else if vm}
      <div class="row nowrap">
        <Button size="sm" title="previous token" onclick={stepPrevToken} disabled={k === 0}>«</Button>
        <span class="row mid">
          <Button size="sm" tone="accent" title="one coder action back" onclick={stepBack}>⏴ prev step</Button>
          <Button size="sm" tone="accent" title="one coder action forward" onclick={stepForward}>next step ⏵</Button>
          <!-- eslint-disable-next-line svelte/no-at-html-tags -- vm.label is built in this file's own script from static template fragments plus escapeHtml()'d piece text; no unescaped user input reaches it -->
          <span class="stat">{@html vm.label}</span>
        </span>
        <Button size="sm" title="next token" onclick={stepNextToken} disabled={k === lastEnc.tokens.length - 1}>»</Button>
      </div>

      <div class="h2sub cap">the number line before this step</div>
      <div class="ival">
        {#if vm.zone}
          <div class="zone" style:left={vm.zone.left} style:width={vm.zone.width} style:background={vm.zone.bg} style:border-left={vm.zone.border} style:border-right={vm.zone.border} style:color={vm.zone.color}>
            {vm.zone.text}
          </div>
        {/if}
        <div class="slice dim" style={barStyle(vm.before)}></div>
        {#if vm.slice}<div class="slice" style={barStyle(vm.slice)}></div>{/if}
        <div class="tick" style:left="25%"></div>
        <div class="tick" style:left="50%"></div>
        <div class="tick" style:left="75%"></div>
        <div class="tlab" style:left="var(--s-1)">0</div>
        <div class="tlab" style="left:calc(25% + var(--s-half))">1/4</div>
        <div class="tlab" style="left:calc(50% + var(--s-half))">1/2</div>
        <div class="tlab" style="left:calc(75% + var(--s-half))">3/4</div>
        <div class="tlab" style:right="var(--s-1)">1</div>
        <div class="hoverlayer" role="presentation" onmousemove={ivalHover('A')} onmouseleave={() => tooltip.hide()}></div>
      </div>
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- vm.actionHtml is built in this file's own script from static template fragments; no user-controlled text is interpolated into it -->
      <div class="stat block">{@html vm.actionHtml}</div>
      <div class="h2sub cap">{vm.afterCaption}</div>
      <div class="ival">
        <div class="slice" style={barStyle(vm.after)}></div>
        <div class="tick" style:left="50%"></div>
        <div class="tlab" style:left="var(--s-1)">0</div>
        <div class="tlab" style="left:calc(50% + var(--s-half))">1/2</div>
        <div class="tlab" style:right="var(--s-1)">1</div>
        <div class="hoverlayer" role="presentation" onmousemove={ivalHover('B')} onmouseleave={() => tooltip.hide()}></div>
      </div>

      <div class="h2sub cap">
        the bit stream, as the coder writes it (<span class="warn-text">guard bit</span> ·
        <span class="ok">version</span> · payload; an amber <span class="warn-text">?</span> is a deferred bit waiting on
        a carry, a dim <span class="dim">·</span> a bit not yet written):
      </div>
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- vm.bitstreamHtml is built in this file's own script from the coder's own 0/1 bitstring plus static markup; no user-controlled text -->
      <div class="bitstream well">{@html vm.bitstreamHtml}</div>
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- vm.stepBitsHtml is built in this file's own script from numeric formatting plus static markup; no user-controlled text -->
      <div class="stat block">{@html vm.stepBitsHtml}</div>
      <div class="bitsprog"><div style:width="{vm.progressPct}%"></div></div>

      <div class="h2sub" style="margin-bottom:var(--s-1)">
        the finished stream, divided by token (click a slice to jump the stepper there):
      </div>
      <div class="tape">
        {#each lastEnc.tokens as t, i (i)}
          <button
            class="seg btn-bare"
            class:sel={i === k}
            aria-label={`jump to token ${i + 1}: ${t.piece}`}
            style:width="{(t.bits / tapeTotal) * 100}%"
            style:background={t.piece === '<eos>' ? 'rgba(63,185,80,.7)' : i % 2 ? 'rgba(88,166,255,.75)' : 'rgba(88,166,255,.45)'}
            onmousemove={(ev) => onTapeMove(ev, i)}
            onmouseleave={() => tooltip.hide()}
            onclick={() => selectToken(i)}
          ></button>
        {/each}
      </div>
      {@const cost = costParts(lastEnc.model_bits, lastEnc.coded_bits)}
      <div class="stat">
        model <b>{cost.model}</b> bits + coder overhead <b>{cost.overhead}</b> →
        <b>{cost.total}</b> bits
      </div>
    {/if}
  {/if}
</Panel>

<style>
  .row.nowrap { flex-wrap: nowrap; justify-content: space-between; margin-top: var(--s-3); }
  .row.mid { display: flex; gap: var(--s-3); align-items: center; min-width: 0; }
  .cap { margin: var(--s-3) 0 var(--s-half); }
  .ival {
    position: relative;
    height: calc(3 * var(--s-3));
    background: var(--sunken);
    border: var(--border);
    border-radius: var(--r-3);
    overflow: hidden;
  }
  .ival .slice { position: absolute; top: 0; height: 100%; background: rgba(63, 185, 80, 0.85); }
  .ival .slice.dim { background: rgba(63, 185, 80, 0.28); }
  .ival .zone { position: absolute; top: 0; height: 100%; font: var(--fs-micro) var(--font-mono); text-align: center; padding-top: var(--s-half); }
  .ival .tick { position: absolute; top: 0; height: 100%; border-left: 1px dashed var(--line-2); /* hairline */ }
  .ival .tlab { position: absolute; bottom: 1px; /* hairline */ font: var(--fs-micro) var(--font-mono); color: var(--dim); }
  .ival .hoverlayer { position: absolute; inset: 0; }
  .stat.block { display: block; margin: var(--s-1) 0; }
  .bitstream {
    font: var(--fs-sm) / 1.9 var(--font-mono);
    word-break: break-all;
    border-radius: var(--r-3);
    padding: var(--s-2) var(--s-3);
  }
  .bitsprog { height: var(--s-1); background: var(--line); border-radius: var(--r-1); margin: var(--s-1) 0 var(--s-4); }
  .bitsprog > div { height: 100%; background: var(--acc); border-radius: var(--r-1); }
  .tape { display: flex; height: var(--s-6); border-radius: var(--r-3); overflow: hidden; border: var(--border); }
  /* `.btn-bare` (app.css) supplies the reset and the shared focus ring; the
     tape supplies the height and the paint. Both outlines are drawn INSIDE the
     segment: the tape is a single rounded box and a ring outside one slice of
     it would overlap its neighbours. */
  .tape .seg { height: 100%; }
  .tape .seg.sel { outline: var(--stroke) solid var(--txt); outline-offset: calc(-1 * var(--stroke)); }
  .tape .seg:focus-visible { outline-offset: calc(-1 * var(--stroke)); }
</style>
