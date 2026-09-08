import { loadStreaming, MODEL_BYTES, pickWasm, type LoadStats, type WasmPick } from './loader';
import { FAULTED_TIER, faultAction, infoThreadFault, THREAD_FAULT_UNRECOVERED } from './poison';
import { SELF_TEST_URL } from '../examples';
import { createSendGate } from './send-gate';
import { detectTier } from './tier';
import type * as T from './types';

export interface LoadOptions {
  /** Override the feature-detected tier (`detectTier()`'s result) instead of
   * probing the browser — used by the bench page's `?tier=`/`&w=` query
   * params to force a specific wasm build + worker count for measurement. */
  tier?: { relaxed: boolean; threads: number };
  /**
   * Called when a mid-session tier-3 fault has been handled: `next` is the
   * fresh, non-threaded instance every later call now goes to, or null when
   * even that could not load.
   *
   * The recovery itself is this class's job (it owns the worker and the
   * memory that have to be thrown away, and it is where the failed request is
   * replayed). This hook exists so the page can move its own reference and
   * re-render the status line — see `codecState.svelte.ts`.
   */
  onThreadFault?: (next: Codec | null) => void;
}

/** What `rpc()` returns once the worker is gone. Pages already render a
 * `Fail`'s `error` (an `.err` panel, a status line), so a dead codec surfaces
 * through the path they already have instead of hanging forever. */
const DEAD: T.Fail = { ok: false, error: 'the codec worker is gone — reload the page' };

/** What a call gets once a tier-3 fault has been detected and no replacement
 * instance could be loaded. Distinct from DEAD: the worker did not crash, the
 * wasm disowned itself, and there is nothing left to fall back to. */
const POISON_DEAD: T.Fail = { ok: false, error: THREAD_FAULT_UNRECOVERED };

// SELF_TEST_URL (src/lib/examples.ts) is encoded once right after `codec_init`
// succeeds, before `load()` hands the codec to its caller — it confirms a
// codec that compiled and initialized fine can actually do real work. Catches
// the "first-encode error" failure mode (e.g. a subtly broken threads dispatch
// that only shows up once real jobs run, not during setup) so it degrades the
// tier exactly like every other load-time failure below, instead of surfacing
// as a mysterious error on the visitor's first real encode.

/**
 * Dev/bench-only test hooks, read from `?mtfail=`.
 *
 * `handshake` makes the first spawned compute worker skip its ready
 * message (worker.ts/compute-worker.ts), so the coordinator's 'finish'
 * handshake wait times out with compute workers already spawned and spinning
 * — the scenario that stays untested without it (the
 * existing threads-tier-failure E2E instead aborts the mt wasm's own download,
 * which fails before any compute worker exists).
 *
 * `poison` makes the coordinator answer the first codec call AFTER
 * the load's own self-test with the wasm's poison result verbatim, exercising
 * the mid-session tier-3 fault path: terminate, drop the shared memory, reload
 * without threads, replay. It is a short-circuit in worker.ts rather than a
 * real fault because a real one cannot be provoked from JS at all — it needs a
 * compute worker to be descheduled past the bounded join, and a page cannot
 * terminate a worker it did not spawn, let alone stall one. The value being
 * tested is the CLIENT's response to the documented reply, and that is what a
 * verbatim reply tests.
 *
 * Honoured only in a dev build (`import.meta.env.DEV`) or on the bench page: a
 * real visitor's index/dream/model page in a production build never carries
 * these hooks' cost, but the E2E suite (which drives a production
 * `vite preview`) still needs a way to reach them.
 */
function mtFailMode(): string | null {
  if (typeof location === 'undefined') return null;
  if (!import.meta.env.DEV && !location.pathname.endsWith('/bench.html')) return null;
  return new URLSearchParams(location.search).get('mtfail');
}

export class Codec {
  private w: Worker;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- internal RPC bookkeeping; public methods below are fully typed
  private pending = new Map<number, (r: any) => void>();
  private id = 0;
  private readonly ownInfo: T.Info;
  /** Static facts about the loaded model + build. A getter, not a field: after
   * a recovered tier-3 fault the running kernel is the successor's, and a
   * caller re-reading `info.kernel` must see that, not the tier that faulted. */
  get info(): T.Info {
    return this.successor ? this.successor.info : this.ownInfo;
  }
  /** Set once this instance can never answer another RPC: the worker fired
   * 'error'/'messageerror', or `terminate()` was called. `rpc()` checks it
   * and returns an immediate failure.
   *
   * Without it, `postMessage` to a terminated worker is silently dropped and
   * the returned promise — which has no rejection path and no timeout — never
   * settles. On mobile, where the browser kills the coordinator under memory
   * pressure after a successful load, the in-flight decode rejected cleanly
   * and the user saw an error; the *next* action (switch to the Encode tab,
   * type) then hung forever with the spinner running and the status line
   * still reading "model ready". */
  private dead = false;
  /** Name of the wasm asset actually fetched for this load (one of
   * manifest.wasm / wasmRelaxed / wasmMt) — lets the UI report which file is
   * really running instead of assuming the portable simd128 build. */
  private readonly ownWasmName: string;
  get wasmName(): string {
    return this.successor ? this.successor.wasmName : this.ownWasmName;
  }
  /** Set when this codec ended up on a lower tier than the one first
   * attempted, because that tier failed somewhere in its own load (shared-
   * memory instantiation, a spawned compute worker, a missing export, the
   * ready handshake timing out, or the post-load self-test encode above).
   * Names the tier that failed (`"threads"` or `"relaxed"`); `null` on a
   * clean first-attempt load. Pages show this so a degraded load is never
   * silent — see index/App.svelte's and dream/App.svelte's `statusText`.
   *
   * Also set to `"threads"` after a mid-session tier-3 fault, with
   * `degradedAfterFault` distinguishing the two — "failed to load" and
   * "faulted while running" are different things to tell a visitor. */
  private readonly ownDegradedFrom: string | null;
  get degradedFrom(): string | null {
    return this.successor ? this.successor.degradedFrom : this.ownDegradedFrom;
  }

  /** True when `degradedFrom` names a tier that ran and then faulted (the
   * codec poisoned itself mid-session) rather than one that failed to load. */
  private readonly ownDegradedAfterFault: boolean;
  get degradedAfterFault(): boolean {
    return this.successor ? this.successor.degradedAfterFault : this.ownDegradedAfterFault;
  }

  /** How the assets got here — total bytes, wall clock, and whether every one
   * of them was a Cache API hit. The status line says which, because "125 MB
   * in 7 s" and "125 MB from cache in 0.3 s" are the two experiences a
   * visitor can actually tell apart, and the old line said neither. */
  private readonly ownLoadStats: LoadStats;
  get loadStats(): LoadStats {
    return this.successor ? this.successor.loadStats : this.ownLoadStats;
  }

  /**
   * Set once a tier-3 fault has been recovered from: the instance every call
   * on this object is forwarded to.
   *
   * A page — and the bench page especially — holds the `Codec` it was handed
   * at load time and keeps calling it. Recovery has to build a *new* instance
   * (the poisoned one cannot be rebuilt over: `codec_init` returns 6 for any
   * `threads` value), so the old object stays as a forwarder rather than
   * every caller being asked to notice a swap. `info`, `degradedFrom` and the
   * rest are getters for the same reason: a caller re-reading `info.kernel`
   * after a fault must see the kernel that is actually running.
   */
  private successor: Codec | null = null;
  /** In-flight recovery, so concurrent poisoned replies share one rebuild
   *  instead of racing to spawn several codecs. */
  private recovery: Promise<Codec | null> | null = null;
  /** Kept so recovery can rebuild with the same reporting and the same
   *  caller-supplied tier floor. */
  private readonly onProgress: (p: T.Progress) => void;
  private readonly opts: LoadOptions;

  private constructor(
    w: Worker,
    info: T.Info,
    wasmName: string,
    degradedFrom: string | null,
    loadStats: LoadStats,
    onProgress: (p: T.Progress) => void,
    opts: LoadOptions,
    degradedAfterFault: boolean,
  ) {
    this.w = w;
    this.ownInfo = info;
    this.ownWasmName = wasmName;
    this.ownDegradedFrom = degradedFrom;
    this.ownLoadStats = loadStats;
    this.onProgress = onProgress;
    this.opts = opts;
    this.ownDegradedAfterFault = degradedAfterFault;
  }

  /** True once this codec can no longer answer an RPC (worker crashed, or
   * `terminate()` was called). Pages can show "reload" rather than a spinner
   * that will never stop. */
  get isDead(): boolean {
    return this.successor ? this.successor.isDead : this.dead;
  }

  /**
   * Load the codec. The threads tier must degrade, never fail the whole app:
   * any problem loading it — a `WebAssembly.Memory` allocation that throws,
   * a compute worker that fails to spawn or instantiate, a build missing an
   * export the coordinator relies on, the ready handshake timing out, or the
   * post-load self-test encode above failing — retries once with threads
   * forced off (landing on relaxed if available, else the portable simd128
   * build every manifest has). A relaxed-tier failure degrades once more, to
   * simd. Simd itself has nowhere left to fall back to, so only a simd
   * failure actually rejects this promise.
   */
  static async load(onProgress: (p: T.Progress) => void, opts: LoadOptions = {}): Promise<Codec> {
    const requested = opts.tier ?? detectTier();
    return Codec.attemptWithFallback(onProgress, opts, requested, null, false);
  }

  private static async attemptWithFallback(
    onProgress: (p: T.Progress) => void,
    opts: LoadOptions,
    tier: { relaxed: boolean; threads: number },
    degradedFrom: string | null,
    afterFault: boolean,
  ): Promise<Codec> {
    const picked = pickWasm(tier);
    try {
      return await Codec.attemptOnce(onProgress, opts, picked, degradedFrom, afterFault);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (picked.kind === 'threads') {
        onProgress({ fraction: 0, text: `threads tier failed (${message}) — retrying without threads…` });
        return Codec.attemptWithFallback(onProgress, opts, { relaxed: tier.relaxed, threads: 0 }, FAULTED_TIER, afterFault);
      }
      if (picked.kind === 'relaxed') {
        onProgress({ fraction: 0, text: `relaxed tier failed (${message}) — retrying on portable simd128…` });
        return Codec.attemptWithFallback(onProgress, opts, { relaxed: false, threads: 0 }, 'relaxed', afterFault);
      }
      throw err; // simd itself failed — nothing left to degrade to
    }
  }

  private static async attemptOnce(
    onProgress: (p: T.Progress) => void,
    opts: LoadOptions,
    picked: WasmPick,
    degradedFrom: string | null,
    afterFault: boolean,
  ): Promise<Codec> {
    const { entry: wasmEntry, threads: useThreads } = picked;

    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see field comment above
    const pending = new Map<number, (r: any) => void>();
    // Set by the worker-death handler below; the constructed Codec adopts it
    // so an RPC issued after a crash fails immediately instead of hanging.
    let died = false;
    let onDeath: () => void = () => {};
    w.onmessage = (e) => {
      const res = pending.get(e.data.id);
      if (res) {
        pending.delete(e.data.id);
        res(e.data.r);
      }
    };
    const failAll = (message: string) => {
      for (const res of pending.values()) res({ ok: false, error: message });
      pending.clear();
    };
    w.onerror = w.onmessageerror = (e: ErrorEvent | MessageEvent) => {
      const message = 'message' in e && e.message ? e.message : 'crashed';
      // a worker that fired 'error'/'messageerror' has nothing left to give a
      // reply to any pending RPC — terminate rather than leave it dangling
      died = true;
      onDeath();
      w.terminate();
      failAll('worker: ' + message);
    };

    // Handshake with the worker (see worker.ts's header comment): 'setup' (id
    // 1) hands over the wasm bytes the moment they land — well before the
    // model chunks are done — so compile+instantiate overlaps the download
    // instead of following it. Chunks that arrive before the worker's reply
    // (it owns wasm memory and must exist before the first byte lands there)
    // are queued by the gate and flushed the instant setup succeeds; if setup
    // fails instead, the gate is discarded — permanently — and a broken
    // worker never receives a chunk/tokenizer send.
    //
    // Both live outside the `try` so the catch below can shut them down: any
    // failure at all must stop the download and stop queueing for a worker
    // that is about to be terminated.
    const gate = createSendGate();
    const abort = new AbortController();

    try {
      const setupReply = new Promise<{ ok: true } | T.Fail>((res) => {
        pending.set(1, (r) => {
          if (r.ok) {
            gate.open();
          } else {
            gate.discard();
            abort.abort();
          }
          res(r);
        });
      });
      // A worker that dies mid-download is just as doomed as a failed 'setup'.
      onDeath = () => {
        gate.discard();
        abort.abort();
      };

      // Race, don't sequence. Awaiting `loadStreaming` to
      // completion before the 'setup' reply was even looked at — and setup
      // typically fails within a second of the wasm arriving (the threads
      // tier's 1 GiB shared-memory reservation is the common case). So a
      // phone that could not have the threads tier still downloaded all ~125
      // MiB of a model it was about to discard, then re-downloaded it for the
      // relaxed attempt if `caches` was unavailable or quota-capped — with the
      // progress bar restarting at 0%. The recovery path was more likely to
      // OOM-kill the tab than the original failure.
      // Rejects on a failed setup and otherwise stays PENDING FOREVER. It
      // must never resolve: `Promise.race` settles on the first settled
      // promise, resolved or rejected, so a `setupReply.then(...)` that
      // resolves on success would win the race the instant the wasm landed
      // and let 'finish' — and with it codec_init — run over a model still
      // being downloaded (rc 2 "bad model", or rc 3 when the tokenizer had
      // not arrived either).
      const setupFailure = new Promise<never>((_, reject) => {
        void setupReply.then((r) => {
          if (!r.ok) reject(new Error(r.error));
        });
      });
      setupFailure.catch(() => {}); // the race below is what reports it
      // `setupFailure` never resolves, so the race's value is loadStreaming's.
      const stats = await Promise.race([
        loadStreaming(
          wasmEntry,
          {
            onWasm: (wasm) => {
              w.postMessage(
                { id: 1, op: 'setup', wasm, modelBytes: MODEL_BYTES, threads: useThreads, mtFailHandshake: mtFailMode() === 'handshake', mtFailPoison: mtFailMode() === 'poison' },
                [wasm.buffer],
              );
            },
            onChunk: (offset, bytes) => {
              gate.send(() => w.postMessage({ op: 'chunk', offset, bytes }, [bytes.buffer]));
            },
            onTokenizer: (bytes) => {
              gate.send(() => w.postMessage({ op: 'tokenizer', bytes }, [bytes.buffer]));
            },
            onProgress,
          },
          abort.signal,
        ),
        setupFailure,
      ]);

      const setup = await setupReply;
      if (!setup.ok) throw new Error(setup.error);

      // Instantiating the wasm and (on the threads tier) spawning + barriering
      // N compute workers is seconds of work on a cold cache; naming the tier
      // makes that wait legible instead of a stalled-looking full bar.
      const startingText = useThreads > 0 ? `starting codec (threads:${useThreads})…` : 'starting codec…';
      onProgress({ fraction: 1, text: startingText, parts: [{ text: startingText }] });
      const info: T.Info | T.Fail = await new Promise((res) => {
        pending.set(2, res);
        w.postMessage({ id: 2, op: 'finish' });
      });
      if (!info.ok) throw new Error(info.error);
      // `codec_info` answers on a poisoned instance — that is the whole point
      // of it being outside `with_codec`'s gate — so a load can "succeed"
      // against a codec that will refuse the very first encode. Treat it as
      // this attempt failing, which puts it through the same degrade chain as
      // every other threads-tier failure below.
      if (infoThreadFault(info)) {
        throw new Error(`codec_info reports a tier-3 fault (threads_error=${String((info as unknown as { threads_error?: number }).threads_error)})`);
      }

      // Self-test: see SELF_TEST_URL's comment. Uses id 3 directly (this
      // runs before the Codec object — and its rpc()-driven id counter —
      // exists), so the constructed Codec must start its own counter above 3.
      const selfTest: T.EncodeResult | T.Fail = await new Promise((res) => {
        pending.set(3, res);
        w.postMessage({ id: 3, op: 'enc', str: SELF_TEST_URL, alpha: 1 });
      });
      if (!selfTest.ok) throw new Error(`self-test encode failed: ${selfTest.error}`);

      const c = new Codec(w, info, wasmEntry.name, degradedFrom, stats, onProgress, opts, afterFault);
      c.pending = pending;
      c.id = 3;
      c.dead = died;
      // hand the death handler over to the constructed instance
      onDeath = () => {
        c.dead = true;
      };
      return c;
    } catch (err) {
      // A failure downloading, in 'setup', 'finish', or the self-test above
      // leaves a coordinator worker (and, in the mt build, the compute
      // workers it spawned off its memory — terminating the parent takes
      // them with it) with nothing left to do; don't leak it, and don't
      // leave any pending RPC unresolved. The caller (attemptWithFallback)
      // decides whether this failure degrades to a lower tier or is final.
      gate.discard();
      abort.abort();
      w.terminate();
      failAll(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  /** Post one message to this instance's own worker and await its reply. */
  private send<R>(msg: object): Promise<R> {
    // A postMessage to a terminated worker is silently dropped, and the
    // promise below has no rejection path and no timeout — so without this
    // guard every call after a worker death hangs forever. See `dead`.
    if (this.dead) return Promise.resolve(DEAD as R);
    return new Promise((res) => {
      const id = ++this.id;
      this.pending.set(id, res);
      this.w.postMessage({ ...msg, id });
    });
  }

  /**
   * Every codec call, with the tier-3 fault handling around it.
   *
   * A poisoned instance answers `{"ok":false,"code":"instance_poisoned",…}` to
   * everything and can never be rebuilt (see poison.ts). So on the first such
   * reply this instance is thrown away, a fresh one is loaded off the
   * shared-memory path, and the request that hit the fault is replayed once on
   * it — the visitor sees a slower answer, not an error. Every later call on
   * this object is forwarded to the replacement.
   */
  private async rpc<R>(msg: object): Promise<R> {
    if (this.successor) return this.successor.rpc<R>(msg);
    // A fault detected by another in-flight call: wait for that one recovery
    // rather than racing it, then go to whatever it produced.
    if (this.recovery) {
      const next = await this.recovery;
      return next ? next.rpc<R>(msg) : (POISON_DEAD as R);
    }
    if (this.dead) return Promise.resolve(DEAD as R);

    const r = await this.send<R>(msg);
    // Re-read AFTER the await: a sibling call may have hit the fault while
    // this one was in flight, in which case our own teardown settled this
    // promise with `terminated` rather than answering it.
    const sibling = this.inFlightRecovery();
    switch (faultAction(r, sibling !== null)) {
      case 'return':
        return r;
      case 'recover': {
        const next = await this.recoverFromThreadFault();
        // Replay ONCE, and through `send`, not `rpc` — so a replacement that
        // somehow poisoned too could never recover again, which on a
        // non-threaded build could only loop.
        return next ? next.send<R>(msg) : r;
      }
      case 'replay': {
        const next = await sibling;
        return next ? next.send<R>(msg) : (POISON_DEAD as R);
      }
    }
  }

  /** `this.recovery`, read through a call so the narrowing from `rpc`'s early
   *  guard does not survive the `await` in between — a sibling can set it
   *  while this call is in flight, which is the whole point. */
  private inFlightRecovery(): Promise<Codec | null> | null {
    return this.recovery;
  }

  /**
   * Discard this poisoned instance and load a replacement without threads.
   *
   * Terminating the coordinator takes its compute workers with it (the HTML
   * spec's "terminate a worker" algorithm cascades), and dropping the last
   * reference to the worker drops the `WebAssembly.Memory` they shared — which
   * is the whole requirement: a straggler may still be writing into that
   * memory, and `codec_init` refuses to rebuild over it at ANY width.
   *
   * Memoized, so several calls that all come back poisoned share one rebuild.
   */
  private recoverFromThreadFault(): Promise<Codec | null> {
    this.recovery ??= (async () => {
      // eslint-disable-next-line no-console -- a kernel that faulted mid-session and got swapped underneath the page is exactly what a bug report needs to say
      console.warn('nanourl: the threads kernel faulted mid-session; discarding the instance and reloading without it');
      const tier = this.opts.tier;
      this.terminateOwn();
      let next: Codec | null = null;
      try {
        next = await Codec.attemptWithFallback(
          this.onProgress,
          // Drop `threads` and keep everything else: a caller that forced
          // `relaxed` still gets relaxed, and only the tier that can fault is
          // taken away.
          { ...this.opts, tier: { relaxed: tier?.relaxed ?? detectTier().relaxed, threads: 0 } },
          { relaxed: tier?.relaxed ?? detectTier().relaxed, threads: 0 },
          FAULTED_TIER,
          true,
        );
        this.successor = next;
      } catch {
        // Nothing left to run on. The poison reply is what the caller gets,
        // and `isDead` stays true, so the page shows an error rather than a
        // spinner that will never stop.
        next = null;
      }
      this.opts.onThreadFault?.(next);
      return next;
    })();
    return this.recovery;
  }

  encode(url: string, alpha: T.Alphabet): Promise<T.EncodeResult | T.Fail> {
    return this.rpc({ op: 'enc', str: url, alpha });
  }
  decode(code: string, alpha: T.Alphabet): Promise<T.DecodeResult | T.Fail> {
    return this.rpc({ op: 'dec', str: code, alpha });
  }
  dist(url: string, k: number, n = this.info.vocab): Promise<T.DistResult | T.Fail> {
    return this.rpc({ op: 'dist', str: url, k, n });
  }
  trace(url: string, k: number): Promise<T.TraceResult | T.Fail> {
    return this.rpc({ op: 'trace', str: url, k });
  }
  sample(seed: number, temp: number, topK: number, maxTokens: number, prefix: string): Promise<T.SampleResult | T.Fail> {
    return this.rpc({ op: 'sample', str: prefix, seed, temp, topK, maxTokens });
  }

  /** Tear down the coordinator worker (and, per the HTML spec's "terminate a
   * worker" algorithm, any compute workers it spawned off shared memory in
   * the mt build). Used by the bench page when switching tiers, so an old
   * tier's workers don't keep running — and keep holding onto a ~1 GiB
   * shared memory — after a new one has loaded. Fails every RPC still
   * awaiting a reply instead of leaving it dangling, same as the onerror
   * path above — a caller that terminates mid-RPC (the bench page's "run
   * all tiers" is one `await` away from this) still gets a settled promise. */
  terminate(): void {
    this.successor?.terminate();
    this.terminateOwn();
  }

  /** Tear down only this instance's own worker, leaving any successor alone —
   *  what recovery needs, since the successor is what replaces it. */
  private terminateOwn(): void {
    this.dead = true;
    for (const res of this.pending.values()) res({ ok: false, error: 'terminated' });
    this.pending.clear();
    this.w.terminate();
  }
}
