//! Browser-facing wasm library: hand-rolled C ABI (no wasm-bindgen: the
//! module stays tiny and dependency-free). JS copies the model + tokenizer
//! bytes in, then calls codec_encode/codec_decode with UTF-8 in and JSON out.
//!
//! One global codec instance, one reusable result buffer. Every entry point
//! returns (ptr << 32 | len) into wasm memory.
//!
//! Two wasm builds come out of this file: the single-threaded tiers 1-2
//! (stable rust, own memory) and the tier-3 `urlcodec-mt.wasm` (nightly,
//! `-Zbuild-std`, imported shared memory) whose extra exports
//! (`thread_setup` / `worker_main`) let JS park N worker instances in
//! `threads::worker_loop`. Everything else is identical in both.

// `memory.atomic.wait32` / `memory.atomic.notify` are still unstable in
// core::arch::wasm32. Only the mt build (nightly, +atomics) turns this on;
// the stable single-thread builds never see the attribute.
#![cfg_attr(
    all(target_arch = "wasm32", target_feature = "atomics"),
    feature(stdarch_wasm_atomic_wait)
)]
// ported nanourl code: lints allowed crate-wide so the gate stays meaningful for new code
#![allow(dead_code)]
#![allow(clippy::needless_range_loop)]
#![allow(clippy::missing_safety_doc)]
#![allow(clippy::approx_constant)]
#![allow(clippy::assign_op_pattern)]
#![allow(clippy::unnecessary_map_or)]
#![allow(clippy::field_reassign_with_default)]
// `coder` (and its `Encoder`/`Decoder`) is public so abi_test.rs can build a
// version-1 stream directly; that visibility is what makes clippy's
// public-API lint fire on the ported new()s.
#![allow(clippy::new_without_default)]
// clippy 1.98 added `chunks_exact_to_as_chunks`, which fires on the two
// fixed-order f32 reductions in model.rs. Those chunk sizes ARE the
// determinism guarantee (see model.rs's header) and are not rewritten for
// a style lint. `unknown_lints` is allowed alongside it so an older clippy,
// which does not know the name, does not fail the same gate.
#![allow(unknown_lints)]
#![allow(clippy::chunks_exact_to_as_chunks)]

pub mod canonical;
pub mod coder;
pub mod fuzzgen;
mod model;
pub mod sample;
// Target-independent job protocol (its failure paths are tested on the host);
// only the two functions that plug QuantMat into it are wasm-only.
mod threads;
pub mod tok;

use coder::{quantize, Decoder, Encoder, PROB_BITS};
use model::{softmax64, Chained, Model, StepTrace};
use tok::Tok;

struct WCodec {
    model: Model,
    tok: Tok,
    cache: Chained,
}

static mut CODEC: Option<WCodec> = None;
static mut RESULT: Vec<u8> = Vec::new();
static mut KERNEL: &str = "scalar"; // SIMD tier, set in codec_init from model::kernel_name()
static mut WORKERS: u32 = 0; // tier-3 compute workers, from codec_init's `threads`
static mut DIGESTS: bool = false; // parity digests, from codec_init's DIGEST_BIT
static mut ARTIFACT_BYTES: usize = 0;

/// `codec_init`'s `threads` word, bit 17: fold the two per-step parity
/// digests during `codec_encode`. OFF in production: it is ~98 KB of
/// byte-at-a-time hashing per step (32 KB of logits + 64 KB of `cum`) on the
/// coordinator, unparallelised, which is pure Amdahl serial time against a
/// ~6 ms/token threaded kernel. The fuzz harnesses set it; nothing else
/// should. With it off, `dist_hash`/`logit_hash` are reported as "off", and
/// `fuzz/compare_tiers.py` refuses to pass a run whose digest columns are not
/// real hashes, so the gate cannot silently "agree" on a disabled digest.
pub const DIGEST_BIT: i32 = 1 << 17;

/// What `codec_info().kernel` reports: the compile-time SIMD tier, plus the
/// runtime worker count when tier 3 is active. `threads:0` never appears:
/// zero workers IS the single-threaded tier, and saying so twice would make
/// two different builds report the same string.
#[allow(static_mut_refs)]
fn kernel_label() -> String {
    // Read the LIVE worker count on the mt build: if the ready barrier gave
    // up mid-session, threading was switched off and saying "threads:4" would
    // be a lie in exactly the situation someone is trying to diagnose.
    let w = threads::workers();
    unsafe {
        if w > 0 {
            format!("threads:{w}")
        } else {
            KERNEL.to_string()
        }
    }
}

/// FNV-1a/64 over raw little-endian words. Used for the two per-case parity
/// hashes below; integer-only, so every runtime that agrees on the inputs
/// agrees on the digest.
struct Fnv {
    h: u64,
    on: bool,
}

impl Fnv {
    /// `on = false` makes every fold a single predictable branch and reports
    /// "off" instead of a digest, so the production encode pays nothing for
    /// instrumentation it is not using (see DIGEST_BIT).
    fn new(on: bool) -> Self {
        Fnv {
            h: 0xcbf2_9ce4_8422_2325,
            on,
        }
    }
    #[inline]
    fn bytes(&mut self, bs: &[u8]) {
        for &b in bs {
            self.h ^= b as u64;
            self.h = self.h.wrapping_mul(0x1000_0000_01b3);
        }
    }
    /// Every step's quantized cumulative table, exactly as the coder sees it.
    #[inline]
    fn cum(&mut self, cum: &[u64]) {
        if !self.on {
            return;
        }
        for &c in cum {
            self.bytes(&c.to_le_bytes());
        }
    }
    /// Every step's raw logits by BIT PATTERN: the hash that proves
    /// the int4 kernel itself is bit-identical across tiers, before softmax
    /// and quantization can round a difference away.
    #[inline]
    fn logits(&mut self, logits: &[f32]) {
        if !self.on {
            return;
        }
        for &v in logits {
            self.bytes(&v.to_bits().to_le_bytes());
        }
    }
    fn hex(&self) -> String {
        if self.on {
            format!("{:016x}", self.h)
        } else {
            "off".to_string()
        }
    }
}

#[allow(static_mut_refs)]
fn set_result(s: String) -> u64 {
    unsafe {
        RESULT = s.into_bytes();
        ((RESULT.as_ptr() as u64) << 32) | RESULT.len() as u64
    }
}

/// Native-side access to the last result: the packed ptr<<32|len return
/// only round-trips on 32-bit (wasm) pointers, so the fuzz harness reads
/// the buffer directly instead.
#[allow(static_mut_refs)]
pub fn last_result_str() -> String {
    unsafe { String::from_utf8_lossy(&RESULT).into_owned() }
}

fn err_json(msg: &str) -> u64 {
    set_result(serde_json::json!({ "ok": false, "error": msg }).to_string())
}

/// The one answer a poisoned instance ever gives.
///
/// **`"code": "instance_poisoned"` is the documented, machine-readable
/// signal**, and the only error string in this ABI that carries a `code`
/// field. A client that sees it must throw the whole instance away (module,
/// workers and `WebAssembly.Memory`) and, if it wants to keep going, build a
/// new one at a lower tier. Retrying against the same instance will only get
/// this again; `codec_init` over the same memory returns 6 for the same
/// reason.
///
/// It is a `&'static str`, so it lives in the module's DATA SECTION and
/// [`poison_result`] allocates nothing. That is deliberate: after a fault a
/// straggler may still be finishing one block inside a `Model::step` local
/// that has since been freed, and the one message the client must receive
/// intact is this one. Building it on the heap would put it exactly where
/// those bytes went back to.
const POISONED_JSON: &str = concat!(
    r#"{"ok":false,"code":"instance_poisoned","#,
    r#""error":"a tier-3 compute worker was lost (codec_info().threads_error = 2). "#,
    r#"This instance is poisoned and will answer every call with this error: "#,
    r#"discard it - module, workers and memory - and rebuild at a lower tier."}"#,
);

/// [`POISONED_JSON`] as the packed `ptr << 32 | len` every entry point
/// returns. No allocation, no `RESULT` write: see the constant's doc.
fn poison_result() -> u64 {
    ((POISONED_JSON.as_ptr() as u64) << 32) | POISONED_JSON.len() as u64
}

/// Answer with the poison result and leave, before touching anything a lost
/// participant could still be writing. Used inside the entry-point closures
/// (which return the packed result), immediately after every `feed`.
macro_rules! bail_if_poisoned {
    () => {
        if threads::poisoned() {
            return poison_result();
        }
    };
}

/// Fuzz-harness case generator: same compiled code on every runtime.
#[no_mangle]
pub extern "C" fn fuzz_url(seed: u64, idx: u64) -> u64 {
    set_result(fuzzgen::gen_url(seed, idx))
}

/// Model observatory: replay <eos> + the first k URL tokens and trace the
/// FINAL step: the forward pass whose logits predict token k. Returns per
/// layer: every head's attention row over the cached positions, residual
/// L2 norms (entering / after attention / after MLP), and the residual
/// stream at layer exit. Position labels come with the response so the
/// client needs no window bookkeeping (re-chained long URLs included).
#[no_mangle]
pub unsafe extern "C" fn codec_trace(p: *const u8, l: usize, k: i32) -> u64 {
    let url = match std::str::from_utf8(std::slice::from_raw_parts(p, l)) {
        Ok(s) => s.to_string(),
        Err(_) => return err_json("input not UTF-8"),
    };
    with_codec(|c| {
        let can = canonical::canonical(&url);
        let ids = match c.tok.encode(&can) {
            Ok(v) => v,
            Err(e) => return err_json(&e),
        };
        let k = (k.max(0) as usize).min(ids.len());
        let eos = c.tok.eos_id as usize;
        c.cache.reset();
        let mut trace = StepTrace::default();
        let toks: Vec<usize> = std::iter::once(eos)
            .chain(ids[..k].iter().map(|&i| i as usize))
            .collect();
        for (i, &t) in toks.iter().enumerate() {
            if i + 1 == toks.len() {
                c.cache.feed_traced(&c.model, t, &mut trace);
            } else {
                c.cache.feed(&c.model, t);
            }
            bail_if_poisoned!();
        }
        let piece = |i: usize| -> String {
            if i == eos {
                "<eos>".into()
            } else {
                c.tok.piece(i as u32)
            }
        };
        let pieces: Vec<String> = c.cache.window_toks().iter().map(|&t| piece(t)).collect();
        let r4 = |v: f32| (v as f64 * 1e4).round() / 1e4;
        let r3 = |v: f32| (v as f64 * 1e3).round() / 1e3;
        let layers: Vec<_> = trace
            .layers
            .iter()
            .map(|lt| {
                serde_json::json!({
                    "attn": lt.attn.iter()
                        .map(|row| row.iter().map(|&w| r4(w)).collect::<Vec<_>>())
                        .collect::<Vec<_>>(),
                    "norm_in": r3(lt.norm_in),
                    "norm_attn": r3(lt.norm_attn),
                    "norm_mlp": r3(lt.norm_mlp),
                    "x": lt.x.iter().map(|&v| r3(v)).collect::<Vec<_>>(),
                })
            })
            .collect();
        set_result(
            serde_json::json!({
                "ok": true,
                "k": k,
                "pieces": pieces,
                "pred": if k < ids.len() { piece(ids[k] as usize) } else { "<eos>".into() },
                "layers": layers,
            })
            .to_string(),
        )
    })
}

#[no_mangle]
pub extern "C" fn ualloc(n: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(n);
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

#[no_mangle]
pub unsafe extern "C" fn ufree(p: *mut u8, n: usize) {
    drop(Vec::from_raw_parts(p, 0, n));
}

/// Build the global codec from model (.nurl v2/v3) + tokenizer.json bytes.
/// Returns 0 on success; on failure call codec_encode etc. is invalid and the
/// error JSON is retrievable via the returned packed ptr from codec_last().
///
/// `threads`: bit 16 is "relaxed available" (informational only: the JS
/// loader already chose between urlcodec.wasm and urlcodec-relaxed.wasm
/// before this call, so it cannot change which SIMD tier this build takes;
/// `codec_info().kernel` stays truthful from `model::kernel_name()`'s
/// compile-time `cfg`). Bit 17 is [`DIGEST_BIT`] (test instrumentation, off
/// in production). `threads & 0xFFFF` is W, the number of compute workers
/// already parked in `worker_main`; 0 (the default, and the only value the
/// non-shared builds accept) keeps every gemv on this thread.
///
/// # The W contract, which the loader MUST honour
/// Spawn workers with ids `1..=W`, then **poll `threads_ready()` until it
/// equals W (to a deadline)** before calling this. `threads_ready()` is a
/// true COUNT of the workers that reached the worker loop, so "equals W" is
/// the real barrier, not `max(id)`, which reaches W as soon as the
/// highest-numbered worker registers and is therefore satisfiable with the
/// others still booting.
///
/// A loader that cannot reach W may retry with a smaller W, but it must then
/// have spawned ids `1..=W'` and no others: `codec_init` also rejects a
/// registered set that is not exactly `1..=N` (a gap, or a duplicate id from
/// a respawn), because a job only completes when every id `<= W` reports.
/// Spawning more workers than W is safe (the extras sit every job out).
///
/// Returns 0 on success; 1 bad tokenizer UTF-8, 2 bad model, 3 bad
/// tokenizer JSON, 4 W exceeds the registered workers (or the registered ids
/// are not `1..=N`), 5 the tokenizer's vocabulary does not match the model's,
/// 6 **this instance is poisoned by a tier-3 fault**.
///
/// **6 is terminal, for ANY `threads` value, and it is checked first.** Once
/// the bounded join has reported `JOIN_TIMEOUT` a compute worker may still be
/// finishing a block somewhere in this linear memory, and nothing can tell us
/// when: `Worker.terminate()` returns immediately and gives no completion
/// signal, and there is no join for a wasm thread. Rebuilding a codec on top
/// of that, even single-threaded, would put fresh weights and a fresh
/// tokenizer into bytes a straggler is still writing. So the instance is
/// written off: drop the module, the workers and the `WebAssembly.Memory`
/// together and instantiate again (the web loader already builds a new memory
/// per tier attempt, which is why this costs nothing in practice).
/// `codec_info` keeps working and keeps reporting `threads_error`, so the
/// client can see why.
///
/// Nothing is written to the globals until every check has passed, so a
/// rejected init leaves the previous codec exactly as it was.
#[no_mangle]
#[allow(static_mut_refs)]
pub unsafe extern "C" fn codec_init(
    mp: *const u8,
    ml: usize,
    tp: *const u8,
    tl: usize,
    threads: i32,
) -> i32 {
    // First, before even looking at the inputs: a poisoned instance is not
    // rebuildable at any W. See the doc above.
    if threads::poisoned() {
        return 6;
    }
    let mbytes = std::slice::from_raw_parts(mp, ml);
    let tbytes = std::slice::from_raw_parts(tp, tl);
    let tjson = match std::str::from_utf8(tbytes) {
        Ok(s) => s,
        Err(_) => return 1,
    };
    let model = match Model::load_bytes(mbytes) {
        Ok(m) => m,
        Err(_) => return 2,
    };
    let tok = match Tok::load_str(tjson) {
        Ok(b) => b,
        Err(_) => return 3,
    };
    let w = (threads & 0xFFFF) as u32;

    // ---- everything below must pass BEFORE any global is touched ----

    // The two artifacts are fetched as separate hashed assets, so a stale
    // cached tokenizer against a new model is a live path. Every id the
    // tokenizer can emit indexes `cum[id + 1]` (a table sized by the model)
    // and `wte.row_f32(id, ..)` (rows sized by the model), and this target is
    // `panic-strategy: abort`: an over-long tokenizer traps the module with
    // no JSON, no return code and no diagnostic, poisoning the instance. One
    // comparison here turns that into an error code.
    if tok.vocab_size() != model.cfg.vocab {
        return 5;
    }

    #[cfg(all(target_arch = "wasm32", target_feature = "atomics"))]
    {
        if w > 0 {
            // Refuse a W the loader cannot back with real workers. Hanging on
            // the first gemv instead (which is what waiting would do) is the
            // one failure mode a browser cannot recover from. This also
            // establishes `workers() <= registered()` for the session, which
            // is why `threads::coordinate` has no ready barrier: the
            // reachable failure is a worker dying later, and only the bounded
            // join can see that.
            let n = threads::registered();
            if w > n || threads::max_worker_id() != n {
                return 4;
            }
        }
    }

    // ---- committed ----

    let cache = Chained::new(&model);
    CODEC = Some(WCodec { model, tok, cache });
    ARTIFACT_BYTES = ml;
    KERNEL = model::kernel_name(); // "simd" or "relaxed" per this build's cfg
    DIGESTS = (threads & DIGEST_BIT) != 0;
    #[cfg(all(target_arch = "wasm32", target_feature = "atomics"))]
    {
        WORKERS = w;
        threads::set_workers(w);
    }
    #[cfg(not(all(target_arch = "wasm32", target_feature = "atomics")))]
    {
        // No shared memory in this build: there is nobody to hand rows to, so
        // do not let codec_info() claim a tier that is not running.
        let _ = w;
        WORKERS = 0;
        threads::set_workers(0);
    }
    0
}

/// Static facts about the loaded model + build, for the observatory header
/// and support bug reports: shape, parameter count, artifact layout, and
/// which int4 kernel this runtime took.
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn codec_info() -> u64 {
    // NOT behind `with_codec`'s poison gate: after a fault this is the call
    // that tells the client WHY its encode failed, so it has to keep working
    // when nothing else does.
    let c = match unsafe { CODEC.as_mut() } {
        Some(c) => c,
        None => return err_json("codec not initialized"),
    };
    {
        let (wte, wpe) = c.model.artifact_offsets();
        set_result(
            serde_json::json!({
                "ok": true,
                "n_layer": c.model.cfg.n_layer, "n_head": c.model.cfg.n_head,
                "d_model": c.model.cfg.n_embd, "d_mlp": c.model.cfg.hidden,
                "vocab": c.model.cfg.vocab, "block": c.model.cfg.block,
                "params": c.model.param_count(), "artifact_bytes": unsafe { ARTIFACT_BYTES },
                "wte_offset": wte, "wpe_offset": wpe,
                "kernel": kernel_label(),
                "threads_poisoned": threads::poisoned(),
                "threads_degraded": threads::poisoned(), // alias: web/src/lib/codec/poison.ts reads either key
                "threads_error": threads::error(),
                "digests": unsafe { DIGESTS },
                "stream_version": coder::STREAM_VERSION,
            })
            .to_string(),
        )
    }
}

/// Every entry point except `codec_info` runs through here, which is the
/// gate that makes a tier-3 fault terminal.
///
/// **Before**: a poisoned instance never runs the model again. There is no
/// other recovery; see `threads.rs`'s header. A straggler that was
/// merely slow rather than dead may still be finishing one block inside the
/// buffer the faulted job named, and no browser API can tell us when it is
/// done: `Worker.terminate()` returns immediately and reports nothing. So the
/// instance is written off rather than nursed.
///
/// **After**: the call that hit the fault fails too. Its forward pass was
/// abandoned at the faulting matrix (`Model::step`), so what it produced is
/// not a stream anyone should keep: a torn stream decodes to a different URL
/// somewhere else.
///
/// `codec_info` deliberately does NOT go through here: reporting
/// `threads_error` is exactly what a client needs after seeing the poison
/// result.
#[allow(static_mut_refs)]
fn with_codec<F: FnOnce(&mut WCodec) -> u64>(f: F) -> u64 {
    if threads::poisoned() {
        return poison_result();
    }
    unsafe {
        match CODEC.as_mut() {
            Some(c) => {
                let r = f(c);
                if threads::poisoned() {
                    return poison_result();
                }
                r
            }
            None => err_json("codec not initialized"),
        }
    }
}

/// Hallucinate ONE URL: sample the model until <eos> instead of coding with
/// it. One URL per call so the page can stream results and stay responsive;
/// the same `seed` replays the same URL (the caller mixes the index in, so a
/// batch does not depend on the order calls finish).
/// `temp` 0 = greedy, `top_k` 0 = full distribution. An empty prefix (l = 0)
/// samples unconditionally. The prefix is canonical text (hosts TLD-first):
/// it is tokenised as given, never canonicalised, because a partial host
/// cannot be canonicalised consistently mid-way; only the complete sampled
/// string is de-canonicalised back into `url`. Uses the codec's own cache,
/// which every entry point resets before use, so this cannot perturb a
/// later encode/decode.
#[no_mangle]
pub unsafe extern "C" fn codec_sample(
    seed: u32,
    temp: f32,
    top_k: u32,
    max_tokens: u32,
    p: *const u8,
    l: usize,
) -> u64 {
    let prefix_str = if l == 0 {
        String::new()
    } else {
        match std::str::from_utf8(std::slice::from_raw_parts(p, l)) {
            Ok(s) => s.to_string(),
            Err(_) => return err_json("prefix not UTF-8"),
        }
    };
    with_codec(|c| {
        let prefix = if prefix_str.is_empty() {
            Vec::new()
        } else {
            match c.tok.encode(&prefix_str) {
                Ok(v) => v,
                Err(e) => return err_json(&e),
            }
        };
        let params = sample::Params {
            temp,
            top_k: top_k as usize,
            max_tokens: (max_tokens as usize).clamp(1, 4096),
        };
        let mut rng = sample::Rng::new(seed as u64);
        let out = sample::sample_ids(&c.model, &mut c.cache, &mut rng, &prefix, &params);
        bail_if_poisoned!();
        let text = match c.tok.decode(&out.ids) {
            Ok(s) => s,
            Err(e) => return err_json(&e),
        };
        let url = canonical::canonical(&text);
        let pieces: Vec<String> = out.ids.iter().map(|&t| c.tok.piece(t)).collect();
        set_result(
            serde_json::json!({
                "ok": true,
                "url": url,
                "canonical": text,
                "pieces": pieces,
                "terminated": out.terminated,
            })
            .to_string(),
        )
    })
}

#[no_mangle]
pub unsafe extern "C" fn codec_encode(p: *const u8, l: usize, alpha: i32) -> u64 {
    let url = match std::str::from_utf8(std::slice::from_raw_parts(p, l)) {
        Ok(s) => s.to_string(),
        Err(_) => return err_json("input not UTF-8"),
    };
    with_codec(|c| {
        let can = canonical::canonical(&url);
        let ids = match c.tok.encode(&can) {
            Ok(v) => v,
            Err(e) => return err_json(&e),
        };
        let eos = c.tok.eos_id as usize;
        c.cache.reset();
        let mut enc = Encoder::new();
        let mut logits = c.cache.feed(&c.model, eos);
        bail_if_poisoned!();
        let mut toks = Vec::new();
        let mut model_bits = 0f64;
        // Two per-step parity digests, folded over EVERY step of this URL when
        // DIGEST_BIT was set at init (see fuzz/run_tiers.sh). `dist_h` covers
        // the quantized cumulative table the arithmetic coder charges
        // against; `logit_h` covers the raw f32 logits by bit pattern, one
        // layer earlier, so a kernel that diverges by an ulp is caught even on
        // the cases where softmax + 24-bit quantization would have rounded the
        // difference away. Both are integer-only folds over data the encode
        // loop already has in hand, but ~98 KB per step of it, so production
        // leaves them off.
        let on = unsafe { DIGESTS };
        let mut dist_h = Fnv::new(on);
        let mut logit_h = Fnv::new(on);
        let total_f = coder::TOTAL as f64;
        let r9 = |v: f64| (v * 1e9).round() / 1e9;
        for &id in ids.iter() {
            logit_h.logits(&logits);
            let cum = quantize(&softmax64(&logits));
            dist_h.cum(&cum);
            let width = (cum[id as usize + 1] - cum[id as usize]) as f64;
            let bits = PROB_BITS as f64 - width.log2();
            model_bits += bits;
            enc.encode(cum[id as usize], cum[id as usize + 1]);
            // clo/chi/emit/pend: the token's slice of the probability line
            // and the coder's output state right after taking it; the
            // observatory's coder stepper replays these exactly
            toks.push(serde_json::json!({
                "piece": c.tok.piece(id),
                "bits": (bits * 100.0).round() / 100.0,
                "clo": r9(cum[id as usize] as f64 / total_f),
                "chi": r9(cum[id as usize + 1] as f64 / total_f),
                "emit": enc.bits.len(),
                "pend": enc.pending(),
            }));
            logits = c.cache.feed(&c.model, id as usize);
            bail_if_poisoned!();
        }
        logit_h.logits(&logits);
        let cum = quantize(&softmax64(&logits));
        dist_h.cum(&cum);
        let ewidth = (cum[eos + 1] - cum[eos]) as f64;
        let ebits = PROB_BITS as f64 - ewidth.log2();
        model_bits += ebits;
        enc.encode(cum[eos], cum[eos + 1]);
        toks.push(serde_json::json!({
            "piece": "<eos>",
            "bits": (ebits * 100.0).round() / 100.0,
            "clo": r9(cum[eos] as f64 / total_f),
            "chi": r9(cum[eos + 1] as f64 / total_f),
            "emit": enc.bits.len(),
            "pend": enc.pending(),
        }));
        let bits = enc.finish();
        let bitstr: String = bits
            .iter()
            .map(|&b| if b == 0 { '0' } else { '1' })
            .collect();
        let coded = coder::bits_to_string_in(
            &bits,
            coder::STREAM_VERSION,
            coder::Alphabet::from_i32(alpha),
        );
        // visible characters, not bytes: an emoji code is 4 UTF-8 bytes per
        // glyph, and it is the glyph count the page compares against the URL
        let coded_chars = coded.chars().count();
        set_result(
            serde_json::json!({
                "ok": true,
                "url": url,
                "canonical": can,
                "coded": coded,
                "version": coder::STREAM_VERSION,
                "url_chars": url.len(),
                "coded_chars": coded_chars,
                "coded_bits": bits.len(),
                "bitstr": bitstr,
                "model_bits": (model_bits * 100.0).round() / 100.0,
                "dist_hash": dist_h.hex(),
                "logit_hash": logit_h.hex(),
                "bits_per_char": ((bits.len() as f64 / url.len() as f64) * 10000.0).round() / 10000.0,
                "ratio": ((coded_chars as f64 / url.len() as f64) * 10000.0).round() / 10000.0,
                "tokens": toks,
            })
            .to_string(),
        )
    })
}

#[no_mangle]
pub unsafe extern "C" fn codec_decode(p: *const u8, l: usize, alpha: i32) -> u64 {
    let s = match std::str::from_utf8(std::slice::from_raw_parts(p, l)) {
        Ok(x) => x.to_string(),
        Err(_) => return err_json("input not UTF-8"),
    };
    with_codec(|c| {
        let (version, bits) = match coder::string_to_bits_in(&s, coder::Alphabet::from_i32(alpha)) {
            Ok(v) => v,
            Err(e) => return err_json(&e),
        };
        if version != coder::STREAM_VERSION {
            return err_json(&format!("unsupported stream version {version}"));
        }
        let eos = c.tok.eos_id as usize;
        c.cache.reset();
        let mut dec = Decoder::new(&bits);
        let mut logits = c.cache.feed(&c.model, eos);
        bail_if_poisoned!();
        let mut out: Vec<u32> = Vec::new();
        let mut toks = Vec::new();
        loop {
            let cum = quantize(&softmax64(&logits));
            let target = dec.scaled();
            let mut lo = 0usize;
            let mut hi = cum.len();
            while lo < hi {
                let mid = (lo + hi) / 2;
                if cum[mid] <= target {
                    lo = mid + 1;
                } else {
                    hi = mid;
                }
            }
            let sym = lo - 1;
            let width = (cum[sym + 1] - cum[sym]) as f64;
            let bits_cost = PROB_BITS as f64 - width.log2();
            dec.update(cum[sym], cum[sym + 1]);
            if sym == eos {
                toks.push(serde_json::json!({
                    "piece": "<eos>",
                    "bits": (bits_cost * 100.0).round() / 100.0,
                }));
                let can = match c.tok.decode(&out) {
                    Ok(u) => u,
                    Err(e) => return err_json(&e),
                };
                let url = canonical::canonical(&can);
                return set_result(
                    serde_json::json!({
                        "ok": true,
                        "url": url,
                        "canonical": can,
                        "coded": s,
                        "version": version,
                        "url_chars": url.len(),
                        "coded_chars": s.len(),
                        "coded_bits": bits.len(),
                        "bits_per_char": ((bits.len() as f64 / url.len().max(1) as f64) * 10000.0).round() / 10000.0,
                        "tokens": toks,
                    })
                    .to_string(),
                );
            }
            toks.push(serde_json::json!({
                "piece": c.tok.piece(sym as u32),
                "bits": (bits_cost * 100.0).round() / 100.0,
            }));
            out.push(sym as u32);
            // chaining leaves no block limit; keep a generous cap so a
            // corrupt stream cannot loop forever
            if out.len() > 65536 {
                return err_json("no <eos> within 65536 tokens: corrupt input?");
            }
            logits = c.cache.feed(&c.model, sym);
            bail_if_poisoned!();
        }
    })
}

/// Distribution inspector: consume [<eos>] + the first k URL tokens, return
/// the model's top-20 next-token predictions (through the codec's own
/// quantized tables, so probabilities are exactly what the coder charges).
#[no_mangle]
pub unsafe extern "C" fn codec_dist(p: *const u8, l: usize, k: i32, n: i32) -> u64 {
    let url = match std::str::from_utf8(std::slice::from_raw_parts(p, l)) {
        Ok(s) => s.to_string(),
        Err(_) => return err_json("input not UTF-8"),
    };
    with_codec(|c| {
        let can = canonical::canonical(&url);
        let ids = match c.tok.encode(&can) {
            Ok(v) => v,
            Err(e) => return err_json(&e),
        };
        let k = (k.max(0) as usize).min(ids.len());
        let eos = c.tok.eos_id as usize;
        c.cache.reset();
        let mut logits = c.cache.feed(&c.model, eos);
        bail_if_poisoned!();
        for &id in ids[..k].iter() {
            logits = c.cache.feed(&c.model, id as usize);
            bail_if_poisoned!();
        }
        let cum = quantize(&softmax64(&logits));
        let total = coder::TOTAL as f64;
        let actual = if k < ids.len() { ids[k] as usize } else { eos };
        let mut order: Vec<usize> = (0..cum.len() - 1).collect();
        order.sort_by(|&a, &b| (cum[b + 1] - cum[b]).cmp(&(cum[a + 1] - cum[a])));
        let rank = order.iter().position(|&i| i == actual).unwrap_or(0) + 1;
        let piece = |i: usize| -> String {
            if i == eos {
                "<eos>".into()
            } else {
                c.tok.piece(i as u32)
            }
        };
        let n = if n <= 0 {
            c.tok.vocab_size()
        } else {
            n as usize
        };
        let top: Vec<_> = order[..n.min(order.len())]
            .iter()
            .map(|&i| {
                let w = (cum[i + 1] - cum[i]) as f64;
                serde_json::json!({
                    "piece": piece(i),
                    "prob": (w / total * 1e6).round() / 1e6,
                    "bits": ((coder::PROB_BITS as f64 - w.log2()) * 100.0).round() / 100.0,
                })
            })
            .collect();
        let aw = (cum[actual + 1] - cum[actual]) as f64;
        set_result(
            serde_json::json!({
                "ok": true,
                "k": k,
                "context": format!("<eos>{}", &c.tok.decode(&ids[..k]).unwrap_or_default()),
                "actual": {
                    "piece": piece(actual),
                    "prob": (aw / total * 1e6).round() / 1e6,
                    "bits": ((coder::PROB_BITS as f64 - aw.log2()) * 100.0).round() / 100.0,
                    "rank": rank,
                },
                "top": top,
            })
            .to_string(),
        )
    })
}

/// Per-worker stack, in bytes. Exported as `thread_stack_bytes()` so the
/// loader carves the same size it is validated against.
pub const THREAD_STACK_BYTES: u32 = 1 << 20;

#[cfg(all(target_arch = "wasm32", target_feature = "atomics"))]
#[no_mangle]
pub extern "C" fn thread_stack_bytes() -> u32 {
    THREAD_STACK_BYTES
}

/// Tier-3 worker bring-up, called once per worker instance before
/// `worker_main`. **Returns 0 on success, non-zero if this worker is not
/// safe to run**: the caller must throw rather than continue.
///
/// # The stack pointer is JS's job, and this checks JS did it
/// The caller MUST write the exported mutable global first:
///
/// ```js
/// inst.exports.__stack_pointer.value = stackTop;   // REQUIRED, and first
/// if (inst.exports.thread_setup(stackTop, tlsBase) !== 0) throw new Error(...);
/// inst.exports.worker_main(id);
/// ```
///
/// It cannot be done in here. Setting `__stack_pointer` from inline asm
/// inside a function that returns does not work: LLVM treats the shadow-stack
/// global as callee-saved across an `asm!` block and brackets it with a
/// save/restore, so the new value is undone on return. Verified on
/// `nightly-2026-09-06` at both `-O0` and `-O`; the emitted body for
/// `asm!("local.get {sp}", "global.set __stack_pointer", sp = in(local) x)`
/// is `global.get $sp; local.set; local.get x; global.set $sp; local.get
/// saved; global.set $sp`: two `global.set`, the second restoring the old
/// value. wasm-bindgen's thread helper writes it from JS for the same reason.
///
/// So this function makes the omission LOUD instead of silent. A worker whose
/// `__stack_pointer` was never written runs on the module's default value
/// (the same constant in every instance), i.e. every worker silently shares
/// the coordinator's stack. That is concurrent stack corruption with no
/// diagnostic: wrong logits, or a trap somewhere unrelated, depending on
/// timing. Here it becomes a non-zero return before any work is done.
///
/// # Safety
/// `tls_base` must point at `__tls_size` bytes of memory owned by this worker
/// alone, and this must be called exactly once per instance.
#[cfg(all(target_arch = "wasm32", target_feature = "atomics"))]
#[no_mangle]
pub unsafe extern "C" fn thread_setup(stack_top: u32, tls_base: u32) -> i32 {
    extern "C" {
        fn __wasm_init_tls(base: *mut u8);
    }
    // Address of a real local: the wasm shadow stack grows down from
    // `__stack_pointer`, so with the global set correctly this lands just
    // below `stack_top`. black_box keeps the local in memory.
    let probe = core::mem::MaybeUninit::<u64>::uninit();
    let sp = core::hint::black_box(probe.as_ptr()) as u32;
    if sp > stack_top || sp <= stack_top.saturating_sub(THREAD_STACK_BYTES) {
        return 1; // JS did not write __stack_pointer (or wrote the wrong one)
    }
    if tls_base == 0 {
        return 2; // a null TLS base would splatter the TLS template over 0
    }
    __wasm_init_tls(tls_base as *mut u8);
    0
}

/// Park this worker in the gemv loop. Never returns.
#[cfg(all(target_arch = "wasm32", target_feature = "atomics"))]
#[no_mangle]
pub extern "C" fn worker_main(id: u32) -> ! {
    threads::worker_loop(id)
}

/// **A COUNT** of the workers that have reached `worker_loop`, one per
/// `register` call, not the highest id.
///
/// **The loader MUST poll this to a deadline before calling `codec_init`,**
/// and wait for it to equal W. It must be a true count, not `max(id)`: with
/// ids 1..=W, `max(id)` reaches W the instant the highest-numbered worker
/// registers, so a loader could clear the barrier with workers 1..W-1 still
/// short of `worker_loop`. Those workers would then snapshot `gen` after the
/// first job was posted, sit that job out, and the coordinator would burn its
/// entire join bound on the first gemv of the first encode: ~1-2 s of a
/// pinned core, then "tier-3 worker lost mid-call" and a session stuck on the
/// single-threaded tier.
///
/// Retrying with a smaller W is fine **before the first job**, but the ids
/// spawned must still be exactly `1..=W'`: `codec_init` rejects a registered
/// set with a gap or a duplicate (see its code 4), because a job completes
/// only when every id `<= W` reports. Workers can fail to boot for ordinary
/// reasons: memory pressure killing a `new Worker(...)`, CSP blocking the
/// worker script, a page torn down mid-instantiate.
///
/// **Once a job has faulted there is no retry over this memory at all.** A
/// lost participant may still be mid-block, and `Worker.terminate()` gives no
/// completion signal to wait on, so the instance is poisoned: `codec_init`
/// returns 6 for every W and every entry point returns the
/// `"instance_poisoned"` result. Build a new module, new workers and a new
/// `WebAssembly.Memory`.
#[cfg(all(target_arch = "wasm32", target_feature = "atomics"))]
#[no_mangle]
pub extern "C" fn threads_ready() -> u32 {
    threads::registered()
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::sync::atomic::Ordering;

    /// The ABI half of the poison contract. `threads::tests`'
    /// `a_straggler_that_outlives_the_join_poisons_the_instance` covers the
    /// protocol half with a real thread; there is no tier-3 kernel on the
    /// host, so the fault is set here the way `join` sets it, and what is
    /// asserted is the gate every entry point runs through.
    ///
    /// Shares `threads`' test lock: `JOB` and `CODEC` are process globals.
    #[test]
    fn a_poisoned_instance_refuses_every_call() {
        let _guard = threads::tests::job_lock();
        threads::tests::reset_job();

        // Not poisoned: the gate is transparent and the usual errors show.
        assert!(!threads::poisoned());
        let r = with_codec(|_| 42);
        assert_ne!(r, poison_result(), "a healthy instance must not poison");

        // ...now a participant is lost, exactly as `join` records it.
        threads::JOB
            .error
            .store(threads::JOIN_TIMEOUT, Ordering::SeqCst);
        assert!(threads::poisoned());

        // Every entry point answers with the SAME documented result, and the
        // closure is never even entered.
        let mut ran = false;
        let r = with_codec(|_| {
            ran = true;
            42
        });
        assert_eq!(r, poison_result(), "with_codec must gate before running");
        assert!(!ran, "the model must not run on a poisoned instance");

        let url = "https://www.example.com/";
        for got in [
            unsafe { codec_encode(url.as_ptr(), url.len(), 1) },
            unsafe { codec_decode(url.as_ptr(), url.len(), 1) },
            unsafe { codec_sample(1, 1.0, 0, 8, url.as_ptr(), url.len()) },
            unsafe { codec_dist(url.as_ptr(), url.len(), 0, 5) },
            unsafe { codec_trace(url.as_ptr(), url.len(), 0) },
        ] {
            assert_eq!(got, poison_result(), "every entry point returns poison");
        }

        // The payload is the documented, machine-readable one, and it lives
        // in the data section rather than on the heap.
        assert!(POISONED_JSON.contains(r#""code":"instance_poisoned""#));
        let v: serde_json::Value = serde_json::from_str(POISONED_JSON).unwrap();
        assert_eq!(v["ok"], false);
        assert_eq!(v["code"], "instance_poisoned");

        // codec_init is refused for ANY threads value, before it looks at a
        // single input byte: deliberately garbage arguments below.
        let junk = [0u8; 4];
        for w in [0i32, 1, 4] {
            assert_eq!(
                unsafe { codec_init(junk.as_ptr(), junk.len(), junk.as_ptr(), junk.len(), w) },
                6,
                "codec_init must refuse a poisoned instance at W = {w}"
            );
        }

        threads::tests::reset_job();
        assert!(!threads::poisoned(), "reset for the other tests");
    }
}
