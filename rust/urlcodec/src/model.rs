//! nanourl GPT forward pass (swiglu, no-bias, learned positions, tied head),
//! incremental with a KV cache. Both encode and decode call the same step()
//! on the same prefix, so their conditionals are identical by construction.
//!
//! Determinism: all reductions use a fixed 8-lane accumulation order —
//! SIMD-friendly for the compiler, bit-stable across runs.

use std::fs::File;
use std::io::{BufReader, Read};

pub struct Config {
    pub n_layer: usize,
    pub n_head: usize,
    pub n_embd: usize,
    pub vocab: usize,
    pub block: usize,
    pub hidden: usize,
}

pub struct Layer {
    pub ln1: Vec<f32>,
    pub qkv: QuantMat,   // [3d, d]
    pub aproj: QuantMat, // [d, d]
    pub ln2: Vec<f32>,
    pub gate: QuantMat, // [h, d]
    pub up: QuantMat,   // [h, d]
    pub down: QuantMat, // [d, h]
}

pub struct Model {
    pub cfg: Config,
    pub wte: QuantMat, // [vocab, d]; also the tied lm_head
    pub wpe: QuantMat, // [block, d]
    pub layers: Vec<Layer>,
    pub lnf: Vec<f32>,
}

pub struct KvCache {
    k: Vec<Vec<f32>>, // per layer, len = t*d
    v: Vec<Vec<f32>>,
    pub len: usize,
}

impl KvCache {
    pub fn new(m: &Model) -> Self {
        let cap = m.cfg.block * m.cfg.n_embd;
        KvCache {
            k: (0..m.cfg.n_layer)
                .map(|_| Vec::with_capacity(cap))
                .collect(),
            v: (0..m.cfg.n_layer)
                .map(|_| Vec::with_capacity(cap))
                .collect(),
            len: 0,
        }
    }
    pub fn reset(&mut self) {
        for k in self.k.iter_mut() {
            k.clear();
        }
        for v in self.v.iter_mut() {
            v.clear();
        }
        self.len = 0;
    }
}

/// How many trailing tokens survive a context reset. Part of the stream
/// format: encoder and decoder must shift at identical points with identical
/// carry, so CHANGING THIS IS A STREAM-VERSION BREAK.
pub const CHAIN_CARRY: usize = 256;

/// Fixed-context chaining: feed tokens forever; when the model's block fills,
/// deterministically reset the cache and re-feed the last CHAIN_CARRY tokens
/// as fresh context. Both codec directions use this feeder, so arbitrarily
/// long URLs encode/decode with no framing — compression just degrades a
/// little right after each shift (the model loses distant context, and the
/// re-fed tokens sit at positions the training distribution associates with
/// URL starts).
pub struct Chained {
    pub cache: KvCache,
    window: Vec<usize>,
}

impl Chained {
    pub fn new(m: &Model) -> Self {
        Chained {
            cache: KvCache::new(m),
            window: Vec::with_capacity(m.cfg.block),
        }
    }

    pub fn reset(&mut self) {
        self.cache.reset();
        self.window.clear();
    }

    pub fn feed(&mut self, m: &Model, tok: usize) -> Vec<f32> {
        if self.window.len() == m.cfg.block {
            let keep: Vec<usize> = self.window[self.window.len() - CHAIN_CARRY..].to_vec();
            self.cache.reset();
            self.window.clear();
            for (i, &t) in keep.iter().enumerate() {
                m.step(&mut self.cache, t, i);
                self.window.push(t);
            }
        }
        let pos = self.window.len();
        let logits = m.step(&mut self.cache, tok, pos);
        self.window.push(tok);
        logits
    }

    /// feed() with the final step traced (model observatory). Mirrors feed()
    /// exactly, including the re-chain, so traced replays stay stream-true.
    pub fn feed_traced(&mut self, m: &Model, tok: usize, trace: &mut StepTrace) -> Vec<f32> {
        if self.window.len() == m.cfg.block {
            let keep: Vec<usize> = self.window[self.window.len() - CHAIN_CARRY..].to_vec();
            self.cache.reset();
            self.window.clear();
            for (i, &t) in keep.iter().enumerate() {
                m.step(&mut self.cache, t, i);
                self.window.push(t);
            }
        }
        let pos = self.window.len();
        let logits = m.step_traced(&mut self.cache, tok, pos, trace);
        self.window.push(tok);
        logits
    }

    /// Tokens currently in the attention window — the labels for the cached
    /// positions a traced step's attention rows refer to.
    pub fn window_toks(&self) -> &[usize] {
        &self.window
    }
}

#[inline]
fn dot(a: &[f32], b: &[f32]) -> f32 {
    let mut acc = [0f32; 8];
    let ca = a.chunks_exact(8);
    let cb = b.chunks_exact(8);
    let ra = ca.remainder();
    let rb = cb.remainder();
    for (xa, xb) in ca.zip(cb) {
        for i in 0..8 {
            acc[i] += xa[i] * xb[i];
        }
    }
    let mut s = 0f32;
    for i in 0..8 {
        s += acc[i];
    }
    for (x, y) in ra.iter().zip(rb) {
        s += x * y;
    }
    s
}

/// Quantized matrix kept PACKED in RAM: int4 values (stored sign-extended as
/// i8) + one f32 scale per 64-group. Row dot = sum over groups of
/// (sum q_i*x_i) * s — 4x less memory traffic than f32 weights, which is the
/// whole game for single-core (wasm) GEMV. Fixed 4-lane accumulation order:
/// deterministic, and maps 1:1 onto wasm simd128 / SSE lanes.
pub struct QuantMat {
    pub rows: usize,
    pub cols: usize,
    q: Vec<u8>, // PACKED nibbles, rows*cols/2: byte k of a group holds
    // orig indices 2k (lo nibble) and 2k+1 (hi), value+7.
    // 72MB streamed per token — the bandwidth floor.
    scales: Vec<f32>, // rows * cols/GROUP
}

pub const GROUP: usize = 64;

/// Activations quantized per 64-group to i8 — the other half of the integer
/// kernel. Integer MAC loops are associative, so LLVM vectorizes them fully
/// (pmaddwd on AVX2, i16x8/i32x4 dot forms on wasm simd128) with bit-exact
/// determinism at any lane width.
pub struct QuantVec {
    // per 64-group: 32 even-index elements then 32 odd-index elements,
    // matching the lo/hi nibble split of QuantMat's packing
    pub q: Vec<i8>,
    pub scales: Vec<f32>, // one per 64-group: absmax/127
    pub sums: Vec<i32>,   // per group: sum of quantized elems — corrects the
                          // +7 nibble offset when using unsigned-weight MACs
}

impl QuantVec {
    pub fn new() -> QuantVec {
        QuantVec {
            q: Vec::new(),
            scales: Vec::new(),
            sums: Vec::new(),
        }
    }
}

pub fn quantize_x(x: &[f32], out: &mut QuantVec) {
    let ng = x.len() / GROUP;
    out.q.clear();
    out.scales.clear();
    out.sums.clear();
    for g in 0..ng {
        let xg = &x[g * GROUP..(g + 1) * GROUP];
        let mut m = 0f32;
        for &v in xg {
            let a = v.abs();
            if a > m {
                m = a;
            }
        }
        let s = if m > 0.0 { m / 127.0 } else { 1.0 };
        let inv = 1.0 / s;
        out.scales.push(s);
        let mut sum = 0i32;
        for i in (0..GROUP).step_by(2) {
            let q = (xg[i] * inv).round() as i8; // evens
            sum += q as i32;
            out.q.push(q);
        }
        for i in (1..GROUP).step_by(2) {
            let q = (xg[i] * inv).round() as i8; // odds
            sum += q as i32;
            out.q.push(q);
        }
        out.sums.push(sum);
    }
}

fn group_dot64_scalar(w: &[u8], x: &[i8]) -> i32 {
    let mut isum = 0i32;
    for (k, &b) in w.iter().enumerate() {
        isum += ((b & 15) as i32 - 7) * x[k] as i32; // even at x_even[k]
        isum += ((b >> 4) as i32 - 7) * x[32 + k] as i32; // odd at x_odd[k]
    }
    isum
}

#[cfg(target_arch = "x86_64")]
fn have_avx2() -> bool {
    static F: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *F.get_or_init(|| std::is_x86_feature_detected!("avx2"))
}

#[cfg(target_arch = "x86_64")]
fn have_vnni() -> bool {
    static F: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *F.get_or_init(|| {
        std::is_x86_feature_detected!("avx512vnni") && std::is_x86_feature_detected!("avx512vl")
    })
}

/// Which int4 kernel this build/runtime actually takes. Native picks the best
/// ISA extension detected at runtime; wasm reports the compile-time SIMD
/// level (which may be "relaxed"); anything else has only the scalar fallback.
#[cfg(target_arch = "x86_64")]
pub fn kernel_name() -> &'static str {
    if have_vnni() {
        "vnni"
    } else if have_avx2() {
        "avx2"
    } else {
        "scalar"
    }
}

/// The wasm SIMD tier only. Tier 3 (threads) is a runtime property of the
/// same build — `codec_init` is told W — so the worker count is appended by
/// `lib::kernel_label()`, which is what `codec_info().kernel` reports.
#[cfg(target_arch = "wasm32")]
pub fn kernel_name() -> &'static str {
    if cfg!(target_feature = "relaxed-simd") {
        "relaxed"
    } else {
        "simd"
    }
}

#[cfg(not(any(target_arch = "x86_64", target_arch = "wasm32")))]
pub fn kernel_name() -> &'static str {
    "scalar"
}

/// True once a tier-3 participant has been lost. Only the mt build can ever
/// see this; everywhere else it is a compile-time `false`, so every
/// `bail_if_poisoned!` below folds away to nothing.
#[inline(always)]
pub fn instance_poisoned() -> bool {
    #[cfg(all(target_arch = "wasm32", target_feature = "atomics"))]
    {
        crate::threads::poisoned()
    }
    #[cfg(not(all(target_arch = "wasm32", target_feature = "atomics")))]
    {
        false
    }
}

/// Leave the forward pass at once, WITHOUT reading whatever the last gemv
/// wrote. Placed after every `gemv` in `step`/`step_traced`, so a faulted
/// matrix is never consumed: the rows a lost participant owned were never
/// written, and it may be writing them at this instant. The returned vector
/// is a constant of the right length, so no caller has to know about this
/// path; the entry point sees `threads::poisoned()` and answers with the
/// poison result instead of the stream.
macro_rules! bail_if_poisoned {
    ($m:expr) => {
        if instance_poisoned() {
            return vec![0f32; $m.cfg.vocab];
        }
    };
}

impl QuantMat {
    /// The scalar tier: everything that is neither x86_64-with-AVX2 nor
    /// wasm32. One formulation per tier and no more: an unreachable second
    /// formulation behind `#![allow(dead_code)]` can never be covered by any
    /// gate, and a divergent dead copy (e.g. one that biases the nibbles
    /// in-lane where the live kernel corrects via `x.sums`) leaves a reader
    /// told to "fix the wasm kernel" a coin flip to pick the dead one.
    fn gemv_scalar(&self, x: &QuantVec, out: &mut [f32]) {
        let ng = self.cols / GROUP;
        let half = self.cols / 2;
        for r in 0..self.rows {
            let qrow = &self.q[r * half..(r + 1) * half];
            let srow = &self.scales[r * ng..(r + 1) * ng];
            let mut acc = 0f32;
            for g in 0..ng {
                let isum = group_dot64_scalar(
                    &qrow[g * 32..(g + 1) * 32],
                    &x.q[g * GROUP..(g + 1) * GROUP],
                );
                // the one fixed f32 chain every tier shares: this line is the
                // cross-runtime stream-identity contract
                acc += isum as f32 * (srow[g] * x.scales[g]);
            }
            out[r] = acc;
        }
    }

    pub fn gemv(&self, x: &QuantVec, out: &mut [f32]) {
        #[cfg(target_arch = "x86_64")]
        {
            if have_vnni() {
                unsafe { self.gemv_vnni(x, out) };
            } else if have_avx2() {
                unsafe { self.gemv_avx2(x, out) };
            } else {
                self.gemv_scalar(x, out);
            }
        }
        #[cfg(target_arch = "wasm32")]
        self.gemv_wasm(x, out);
        #[cfg(not(any(target_arch = "x86_64", target_arch = "wasm32")))]
        self.gemv_scalar(x, out);
    }

    /// The kernel body is `gemv_rows`; this splits its row range
    /// across shared-memory workers when the mt build was
    /// initialised with W > 0. Rows are owned whole by one participant, so the parallel
    /// and serial results are bit-identical (see `threads.rs`).
    ///
    /// The `rows >= 512` floor keeps a matrix too small to pay the ~µs job
    /// handshake on the caller's thread. Every production matrix is >= 1280
    /// rows (qkv 3840, aproj 1280, gate/up 3392, down 1280, wte 8192), so the
    /// floor only ever fires for toy matrices in tests.
    ///
    /// `gemv_par` returns non-zero if a participant was lost. There is **no
    /// serial fallback**: on a fault the rows the straggler owned were never
    /// written and it may be writing them right now, so recomputing into
    /// `out` would put two writers on one row, and reading `out` would read a
    /// value being written. Instead the instance is poisoned and the pass is
    /// abandoned — `step` checks `poisoned()` after every gemv whose output
    /// is about to be read, before that read (see `threads.rs`'s header for
    /// why a fault is terminal: JS cannot wait for `Worker.terminate()`, so
    /// the only safe contract is "discard the instance").
    ///
    /// Note what stays live for the straggler: `out` is a heap buffer, but
    /// `x` is `&hq`, a `QuantVec` **local of `Model::step`** — a shadow-stack
    /// address. A straggler reconstructs it from `JOB.x` and reads through it
    /// with an unchecked `v128_load`. Once this frame is gone that read is
    /// stale, and it is survivable only because the instance is discarded.
    #[cfg(target_arch = "wasm32")]
    fn gemv_wasm(&self, x: &QuantVec, out: &mut [f32]) {
        #[cfg(target_feature = "atomics")]
        {
            if crate::threads::workers() > 0 && self.rows >= 512 {
                // The `&mut [f32]` is turned into a raw pointer for the
                // duration: participants build disjoint per-block slices from
                // it, and no reference spanning another participant's rows
                // may be live while they write.
                let (base, rows) = (out.as_mut_ptr(), out.len());
                unsafe { crate::threads::gemv_par(self, x, base, rows) };
                return;
            }
        }
        self.gemv_rows(x, out, 0, self.rows);
    }

    /// whole-gemv feature functions: dispatch once per matrix, group ops
    /// inline inside (a #[target_feature] fn cannot inline into plain
    /// callers, so per-group dispatch costs a call per 64 elements)
    #[cfg(target_arch = "x86_64")]
    #[target_feature(enable = "avx2")]
    unsafe fn gemv_avx2(&self, x: &QuantVec, out: &mut [f32]) {
        use std::arch::x86_64::*;
        let ng = self.cols / GROUP;
        let half = self.cols / 2;
        let m4 = _mm256_set1_epi8(0x0F);
        let ones = _mm256_set1_epi16(1);
        for r in 0..self.rows {
            let qrow = self.q.as_ptr().add(r * half);
            let srow = &self.scales[r * ng..(r + 1) * ng];
            let mut acc = 0f32;
            for g in 0..ng {
                let b = _mm256_loadu_si256(qrow.add(g * 32) as *const __m256i);
                let lo = _mm256_and_si256(b, m4);
                let hi = _mm256_and_si256(_mm256_srli_epi16(b, 4), m4);
                let xp = x.q.as_ptr().add(g * GROUP);
                let xe = _mm256_loadu_si256(xp as *const __m256i);
                let xo = _mm256_loadu_si256(xp.add(32) as *const __m256i);
                // llama.cpp-style: maddubs on UNSIGNED nibbles x signed
                // activations, the +7 bias removed below via the group's
                // activation sum. Same bound as the relaxed kernel: [0,14]
                // is the invariant (|pair| <= 3556, |add_epi16| <= 7112) and
                // even a corrupt nibble 15 stays inside i16.
                let p =
                    _mm256_add_epi16(_mm256_maddubs_epi16(lo, xe), _mm256_maddubs_epi16(hi, xo));
                let a = _mm256_madd_epi16(p, ones);
                // exact integer reduction per group (order-free), then a
                // scalar float chain IDENTICAL on every architecture — the
                // cross-runtime stream-identity contract lives here
                let l = _mm256_castsi256_si128(a);
                let h = _mm256_extracti128_si256(a, 1);
                let t = _mm_add_epi32(l, h);
                let t = _mm_add_epi32(t, _mm_shuffle_epi32(t, 0b_01_00_11_10));
                let t = _mm_add_epi32(t, _mm_shuffle_epi32(t, 0b_00_00_00_01));
                let isum = _mm_cvtsi128_si32(t) - 7 * x.sums[g];
                acc += isum as f32 * (srow[g] * x.scales[g]);
            }
            out[r] = acc;
        }
    }

    #[cfg(target_arch = "x86_64")]
    #[target_feature(enable = "avx512vnni", enable = "avx512vl")]
    unsafe fn gemv_vnni(&self, x: &QuantVec, out: &mut [f32]) {
        use std::arch::x86_64::*;
        let ng = self.cols / GROUP;
        let half = self.cols / 2;
        let m4 = _mm256_set1_epi8(0x0F);
        for r in 0..self.rows {
            let qrow = self.q.as_ptr().add(r * half);
            let srow = &self.scales[r * ng..(r + 1) * ng];
            let mut acc = 0f32;
            for g in 0..ng {
                let b = _mm256_loadu_si256(qrow.add(g * 32) as *const __m256i);
                let lo = _mm256_and_si256(b, m4);
                let hi = _mm256_and_si256(_mm256_srli_epi16(b, 4), m4);
                let xp = x.q.as_ptr().add(g * GROUP);
                let xe = _mm256_loadu_si256(xp as *const __m256i);
                let xo = _mm256_loadu_si256(xp.add(32) as *const __m256i);
                let a = _mm256_dpbusd_epi32(_mm256_setzero_si256(), lo, xe);
                let a = _mm256_dpbusd_epi32(a, hi, xo);
                let l = _mm256_castsi256_si128(a);
                let h = _mm256_extracti128_si256(a, 1);
                let t = _mm_add_epi32(l, h);
                let t = _mm_add_epi32(t, _mm_shuffle_epi32(t, 0b_01_00_11_10));
                let t = _mm_add_epi32(t, _mm_shuffle_epi32(t, 0b_00_00_00_01));
                let isum = _mm_cvtsi128_si32(t) - 7 * x.sums[g];
                acc += isum as f32 * (srow[g] * x.scales[g]);
            }
            out[r] = acc;
        }
    }

    /// dequantize one row (embedding lookups)
    pub fn row_f32(&self, r: usize, out: &mut [f32]) {
        let ng = self.cols / GROUP;
        let half = self.cols / 2;
        for g in 0..ng {
            let s = self.scales[r * ng + g];
            for k in 0..32 {
                let b = self.q[r * half + g * 32 + k];
                out[g * GROUP + 2 * k] = ((b & 15) as i32 - 7) as f32 * s;
                out[g * GROUP + 2 * k + 1] = ((b >> 4) as i32 - 7) as f32 * s;
            }
        }
    }
}

#[cfg(target_arch = "wasm32")]
impl QuantMat {
    /// Rows r0..r1 of out = W·x. The unit handed to one worker.
    ///
    /// Two kernel tiers compiled from one body, selected at COMPILE time by
    /// `cfg(target_feature = "relaxed-simd")` (the web build produces two
    /// separate .wasm files — a module containing relaxed-simd opcodes fails
    /// validation on an engine without the feature, even if never executed —
    /// so there is no runtime branch here to keep in sync).
    ///
    /// Both branches reduce the same 64 exact integer products per group to
    /// one i32 `isum` via nothing but integer addition (and, for the relaxed
    /// branch, one integer subtraction removing a constant bias — see below),
    /// which is exactly associative (no rounding), so grouping the products
    /// differently — four lanes of 16 products each below vs. the relaxed
    /// dot's own internal pairing, biased weights vs. unbiased weights
    /// corrected afterward — cannot change the final sum. `isum` is
    /// bit-identical in both tiers, and `acc` follows the same fixed f32
    /// accumulation afterward, so the two tiers are bit-identical end to end
    /// (see fuzz/run_tiers.sh).
    /// `out` covers EXACTLY rows `r0..r1` — row `r` lands at `out[r - r0]`,
    /// not `out[r]`. That is what lets tier 3 hand each participant a `&mut`
    /// over its own block only: two live `&mut` slices over the same memory
    /// are UB even when the writes are disjoint, and this function receives
    /// its slice with `noalias`.
    pub fn gemv_rows(&self, x: &QuantVec, out: &mut [f32], r0: usize, r1: usize) {
        // The row range is computed by the caller (threads::drain for tier 3);
        // a bad range would show up as silently-wrong output rather than a
        // trap, since the loop below uses raw pointers into `self.q`.
        debug_assert!(r0 <= r1 && r1 <= self.rows && out.len() == r1 - r0);
        use core::arch::wasm32::*;
        let ng = self.cols / GROUP;
        let half = self.cols / 2;
        unsafe {
            let m4 = u8x16_splat(0x0F);
            #[cfg(not(target_feature = "relaxed-simd"))]
            let c7 = i8x16_splat(7);
            for r in r0..r1 {
                let qrow = self.q.as_ptr().add(r * half);
                let srow = &self.scales[r * ng..(r + 1) * ng];
                let mut acc = 0f32;
                for g in 0..ng {
                    let w = qrow.add(g * 32);
                    let xq = x.q.as_ptr().add(g * GROUP);
                    let mut iacc = i32x4_splat(0);
                    for c in 0..2 {
                        let b = v128_load(w.add(c * 16) as *const v128);
                        let xe = v128_load(xq.add(c * 16) as *const v128);
                        let xo = v128_load(xq.add(32 + c * 16) as *const v128);
                        #[cfg(target_feature = "relaxed-simd")]
                        {
                            // i16x8_relaxed_dot_i8x16_i7x16(a, b): a's bytes are
                            // always signed i8 (activations). b (weights) hits
                            // relaxed-simd's actual contract per the spec: "when
                            // the second operand has the high bit set in a lane,
                            // that lane's result is implementation defined" --
                            // determinism needs b's bytes in 0..127. A biased
                            // weight (nibble-7, -7..7) fails that half the time
                            // (a negative i8 byte always has the high bit set),
                            // so pass the RAW unbiased nibble instead (0..15,
                            // never negative -- always safe) and correct the +7
                            // bias afterward via x.sums[g], exactly like the
                            // AVX2/VNNI native kernels correct maddubs/dpbusd's
                            // own unsigned-operand requirement (gemv_avx2 /
                            // gemv_vnni above). Each output lane =
                            // a[2k]*b[2k]+a[2k+1]*b[2k+1]. THE INVARIANT is
                            // biased nibbles in [0,14] (training/export.py
                            // clamps q to [-7,7]), giving |lane| <= 2*127*14 =
                            // 3556; the bound is stated over the full nibble
                            // range 0..15 (|lane| <= 3810) because a corrupt
                            // .nurl must not be able to saturate either --
                            // both are far inside i16, and every tier computes
                            // the same integer regardless.
                            let lo_u = v128_and(b, m4); // unbiased evens, 0..15
                            let hi_u = v128_and(u16x8_shr(b, 4), m4); // odds
                            let d0 = i16x8_relaxed_dot_i8x16_i7x16(xe, lo_u);
                            let d1 = i16x8_relaxed_dot_i8x16_i7x16(xo, hi_u);
                            iacc = i32x4_add(iacc, i32x4_extadd_pairwise_i16x8(d0));
                            iacc = i32x4_add(iacc, i32x4_extadd_pairwise_i16x8(d1));
                        }
                        #[cfg(not(target_feature = "relaxed-simd"))]
                        {
                            let lo = i8x16_sub(v128_and(b, m4), c7); // evens, -7..7
                            let hi = i8x16_sub(v128_and(u16x8_shr(b, 4), m4), c7); // odds
                            iacc = i32x4_add(
                                iacc,
                                i32x4_dot_i16x8(
                                    i16x8_extend_low_i8x16(lo),
                                    i16x8_extend_low_i8x16(xe),
                                ),
                            );
                            iacc = i32x4_add(
                                iacc,
                                i32x4_dot_i16x8(
                                    i16x8_extend_high_i8x16(lo),
                                    i16x8_extend_high_i8x16(xe),
                                ),
                            );
                            iacc = i32x4_add(
                                iacc,
                                i32x4_dot_i16x8(
                                    i16x8_extend_low_i8x16(hi),
                                    i16x8_extend_low_i8x16(xo),
                                ),
                            );
                            iacc = i32x4_add(
                                iacc,
                                i32x4_dot_i16x8(
                                    i16x8_extend_high_i8x16(hi),
                                    i16x8_extend_high_i8x16(xo),
                                ),
                            );
                        }
                    }
                    #[allow(unused_mut)]
                    let mut isum = i32x4_extract_lane::<0>(iacc)
                        + i32x4_extract_lane::<1>(iacc)
                        + i32x4_extract_lane::<2>(iacc)
                        + i32x4_extract_lane::<3>(iacc);
                    // relaxed branch summed UNBIASED (0..15) weights above;
                    // remove the +7*sum(x) bias now, once per group -- the
                    // same correction the AVX2/VNNI kernels apply for the
                    // same reason (gemv_avx2 / gemv_vnni above).
                    #[cfg(target_feature = "relaxed-simd")]
                    {
                        isum -= 7 * x.sums[g];
                    }
                    acc += isum as f32 * (srow[g] * x.scales[g]);
                }
                out[r - r0] = acc;
            }
        }
    }
}

/// Deterministic exp: libm's exp differs across platforms (glibc vs wasm
/// libm), which would let a native-encoded stream fail to decode in wasm.
/// This polynomial uses only IEEE-exact ops (+,-,*,from_bits) — bit-identical
/// everywhere. |rel err| < 1e-11, far below the 24-bit table resolution.
pub fn det_exp64(x: f64) -> f64 {
    const LOG2E: f64 = 1.4426950408889634;
    const LN2_HI: f64 = 0.6931471805598953;
    const LN2_LO: f64 = 5.497923018708371e-14;
    let x = x.max(-700.0); // softmax deltas: exp(-700) underflows the table anyway
    let k = (x * LOG2E).round() as i64;
    let r = (x - k as f64 * LN2_HI) - k as f64 * LN2_LO;
    // Taylor to r^9, Horner, fixed order
    let p = 1.0
        + r * (1.0
            + r * (0.5
                + r * (1.0 / 6.0
                    + r * (1.0 / 24.0
                        + r * (1.0 / 120.0
                            + r * (1.0 / 720.0
                                + r * (1.0 / 5040.0
                                    + r * (1.0 / 40320.0 + r * (1.0 / 362880.0)))))))));
    let two_k = f64::from_bits(((k + 1023) as u64) << 52);
    p * two_k
}

pub fn det_exp32(x: f32) -> f32 {
    const LOG2E: f32 = 1.442695;
    const LN2_HI: f32 = 0.6931472;
    const LN2_LO: f32 = -1.9046542e-9;
    let x = x.clamp(-87.0, 87.0);
    let k = (x * LOG2E).round() as i32;
    let r = (x - k as f32 * LN2_HI) - k as f32 * LN2_LO;
    let p = 1.0
        + r * (1.0
            + r * (0.5
                + r * (1.0 / 6.0
                    + r * (1.0 / 24.0
                        + r * (1.0 / 120.0 + r * (1.0 / 720.0 + r * (1.0 / 5040.0)))))));
    let two_k = f32::from_bits(((k + 127) as u32) << 23);
    p * two_k
}

fn layernorm(x: &[f32], w: &[f32], out: &mut [f32]) {
    let n = x.len() as f32;
    let mut mean = 0f32;
    for &v in x {
        mean += v;
    }
    mean /= n;
    let mut var = 0f32;
    for &v in x {
        var += (v - mean) * (v - mean);
    }
    var /= n;
    let inv = 1.0 / (var + 1e-5).sqrt();
    for i in 0..x.len() {
        out[i] = (x[i] - mean) * inv * w[i];
    }
}

/// exact IEEE f16 -> f32 (bit-deterministic; matches numpy's conversion)
fn f16_to_f32(h: u16) -> f32 {
    let sgn = (h >> 15) as u32;
    let e = ((h >> 10) & 31) as u32;
    let m = (h & 1023) as u32;
    let bits = if e == 0 {
        if m == 0 {
            sgn << 31
        } else {
            let mut e2: u32 = 113;
            let mut m2 = m;
            while m2 & 1024 == 0 {
                m2 <<= 1;
                e2 -= 1;
            }
            (sgn << 31) | (e2 << 23) | ((m2 & 1023) << 13)
        }
    } else if e == 31 {
        (sgn << 31) | (255 << 23) | (m << 13)
    } else {
        (sgn << 31) | ((e + 112) << 23) | (m << 13)
    };
    f32::from_bits(bits)
}

fn read_f32s(r: &mut impl Read, n: usize) -> Result<Vec<f32>, String> {
    let mut bytes = vec![0u8; n * 4];
    r.read_exact(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect())
}

/// v2 packs 2D tensors as int4-g64: per 64-group, f32 scale + 32 nibble
/// bytes (q+7). Kept packed in RAM (~4 bytes -> ~0.56 bytes per weight).
fn read_mat(r: &mut impl Read, version: u32, rows: usize, cols: usize) -> Result<QuantMat, String> {
    debug_assert_eq!(cols % GROUP, 0);
    let ngroups = cols / GROUP;
    let gbytes = if version == 2 { 36 } else { 34 }; // v3: f16 scale + 32 nibbles
    let mut bytes = vec![0u8; rows * ngroups * gbytes];
    r.read_exact(&mut bytes).map_err(|e| e.to_string())?;
    let mut q = Vec::with_capacity(rows * cols / 2);
    let mut scales = Vec::with_capacity(rows * ngroups);
    for g in bytes.chunks_exact(gbytes) {
        if version == 2 {
            scales.push(f32::from_le_bytes([g[0], g[1], g[2], g[3]]));
        } else {
            scales.push(f16_to_f32(u16::from_le_bytes([g[0], g[1]])));
        }
        q.extend_from_slice(&g[gbytes - 32..]); // packed nibbles, verbatim
    }
    Ok(QuantMat {
        rows,
        cols,
        q,
        scales,
    })
}

impl Model {
    pub fn load(path: &str) -> Result<Model, String> {
        let f = File::open(path).map_err(|e| format!("{path}: {e}"))?;
        let r = BufReader::with_capacity(1 << 20, f);
        Self::load_reader(r)
    }

    pub fn load_bytes(data: &[u8]) -> Result<Model, String> {
        Self::load_reader(data)
    }

    /// Parameters as counted by training/model.py::n_params (tied embedding counted once).
    pub fn param_count(&self) -> u64 {
        let d = self.cfg.n_embd as u64;
        let h = self.cfg.hidden as u64;
        let per_layer = d + 3 * d * d + d * d + d + 2 * h * d + d * h;
        (self.cfg.vocab as u64) * d
            + (self.cfg.block as u64) * d
            + (self.cfg.n_layer as u64) * per_layer
            + d
    }

    /// Byte offsets of wte and wpe inside the v3 artifact (32-byte header, 34 bytes per 64-group).
    pub fn artifact_offsets(&self) -> (usize, usize) {
        let gb = self.cfg.n_embd / GROUP * 34;
        (32, 32 + self.cfg.vocab * gb)
    }

    fn load_reader(mut r: impl Read) -> Result<Model, String> {
        let mut magic = [0u8; 4];
        r.read_exact(&mut magic).map_err(|e| e.to_string())?;
        if &magic != b"NURL" {
            return Err("not a .nurl file".into());
        }
        let mut u = || -> Result<u32, String> {
            let mut b = [0u8; 4];
            r.read_exact(&mut b).map_err(|e| e.to_string())?;
            Ok(u32::from_le_bytes(b))
        };
        let version = u()?;
        if version != 2 && version != 3 {
            return Err(format!(
                "need a packed int4 .nurl (v2/v3), got version {version}"
            ));
        }
        let (nl, nh, d, vocab, block, hidden) = (
            u()? as usize,
            u()? as usize,
            u()? as usize,
            u()? as usize,
            u()? as usize,
            u()? as usize,
        );
        let wte = read_mat(&mut r, version, vocab, d)?;
        let wpe = read_mat(&mut r, version, block, d)?;
        let mut layers = Vec::with_capacity(nl);
        for _ in 0..nl {
            layers.push(Layer {
                ln1: read_f32s(&mut r, d)?,
                qkv: read_mat(&mut r, version, 3 * d, d)?,
                aproj: read_mat(&mut r, version, d, d)?,
                ln2: read_f32s(&mut r, d)?,
                gate: read_mat(&mut r, version, hidden, d)?,
                up: read_mat(&mut r, version, hidden, d)?,
                down: read_mat(&mut r, version, d, hidden)?,
            });
        }
        let lnf = read_f32s(&mut r, d)?;
        Ok(Model {
            cfg: Config {
                n_layer: nl,
                n_head: nh,
                n_embd: d,
                vocab,
                block,
                hidden,
            },
            wte,
            wpe,
            layers,
            lnf,
        })
    }

    /// Feed one token at position `pos`; returns logits for the NEXT token.
    ///
    /// **Abandons the pass if the tier-3 kernel faults.** `bail_if_poisoned!`
    /// runs after every gemv **whose output is about to be read**, before
    /// that read: on a fault those rows were never written and a straggler
    /// may be writing them now. Four bails per layer, not five — `gate` and
    /// `up` share one, because nothing reads `gate` until after `up`'s gemv,
    /// and `up`'s gemv touches only `hq` and its own buffer. **Insert a read
    /// between those two and you must split the bail.** The value returned in that case is a constant, not a read of
    /// any buffer, and the entry point turns it into the poison result — see
    /// `lib.rs`'s `POISONED_JSON` and `threads.rs`'s header. On every build
    /// but the mt one the check is a compile-time `false` and disappears.
    pub fn step(&self, cache: &mut KvCache, token: usize, pos: usize) -> Vec<f32> {
        bail_if_poisoned!(self);
        let d = self.cfg.n_embd;
        let nh = self.cfg.n_head;
        let hd = d / nh;
        let scale = 1.0 / (hd as f32).sqrt();

        let mut x = vec![0f32; d];
        let mut tmp = vec![0f32; d];
        self.wte.row_f32(token, &mut x);
        self.wpe.row_f32(pos, &mut tmp);
        for i in 0..d {
            x[i] += tmp[i];
        }

        let mut h = vec![0f32; d];
        let mut hq = QuantVec::new();
        let mut qkv = vec![0f32; 3 * d];
        let mut att_out = vec![0f32; d];
        let mut proj = vec![0f32; d];
        let mut gate = vec![0f32; self.cfg.hidden];
        let mut up = vec![0f32; self.cfg.hidden];

        for (l, lay) in self.layers.iter().enumerate() {
            layernorm(&x, &lay.ln1, &mut h);
            quantize_x(&h, &mut hq);
            lay.qkv.gemv(&hq, &mut qkv);
            bail_if_poisoned!(self);
            let (q, kv) = qkv.split_at(d);
            let (k_new, v_new) = kv.split_at(d);
            cache.k[l].extend_from_slice(k_new);
            cache.v[l].extend_from_slice(v_new);
            let t = cache.k[l].len() / d; // tokens cached so far (incl. this one)

            for head in 0..nh {
                let qh = &q[head * hd..(head + 1) * hd];
                // scores over all cached positions, fixed order
                let mut scores = Vec::with_capacity(t);
                let mut smax = f32::MIN;
                for ti in 0..t {
                    let kh = &cache.k[l][ti * d + head * hd..ti * d + (head + 1) * hd];
                    let s = dot(qh, kh) * scale;
                    if s > smax {
                        smax = s;
                    }
                    scores.push(s);
                }
                let mut ssum = 0f32;
                for s in scores.iter_mut() {
                    *s = det_exp32(*s - smax);
                    ssum += *s;
                }
                let o = &mut att_out[head * hd..(head + 1) * hd];
                o.fill(0.0);
                for ti in 0..t {
                    let w = scores[ti] / ssum;
                    let vh = &cache.v[l][ti * d + head * hd..ti * d + (head + 1) * hd];
                    for i in 0..hd {
                        o[i] += w * vh[i];
                    }
                }
            }
            quantize_x(&att_out, &mut hq);
            lay.aproj.gemv(&hq, &mut proj);
            bail_if_poisoned!(self);
            for i in 0..d {
                x[i] += proj[i];
            }

            layernorm(&x, &lay.ln2, &mut h);
            quantize_x(&h, &mut hq);
            lay.gate.gemv(&hq, &mut gate);
            lay.up.gemv(&hq, &mut up);
            bail_if_poisoned!(self);
            for i in 0..self.cfg.hidden {
                let g = gate[i];
                gate[i] = g / (1.0 + det_exp32(-g)) * up[i]; // silu(gate) * up
            }
            quantize_x(&gate, &mut hq);
            lay.down.gemv(&hq, &mut proj);
            bail_if_poisoned!(self);
            for i in 0..d {
                x[i] += proj[i];
            }
        }
        cache.len += 1;

        layernorm(&x.clone(), &self.lnf, &mut x);
        quantize_x(&x, &mut hq);
        let mut logits = vec![0f32; self.cfg.vocab];
        self.wte.gemv(&hq, &mut logits);
        bail_if_poisoned!(self);
        logits
    }

    /// step() with the model observatory's introspection recorded: per layer,
    /// every head's softmaxed attention row, residual-stream L2 norms after
    /// the attention and MLP adds, and the residual snapshot at layer exit.
    /// A DELIBERATE copy of step() rather than a shared inner: the untraced
    /// path is under the cross-runtime stream-identity contract and must not
    /// change shape while other work is landing in this file — keep the two
    /// bodies in sync when step() changes.
    pub fn step_traced(
        &self,
        cache: &mut KvCache,
        token: usize,
        pos: usize,
        trace: &mut StepTrace,
    ) -> Vec<f32> {
        bail_if_poisoned!(self);
        let d = self.cfg.n_embd;
        let nh = self.cfg.n_head;
        let hd = d / nh;
        let scale = 1.0 / (hd as f32).sqrt();
        trace.layers.clear();

        let mut x = vec![0f32; d];
        let mut tmp = vec![0f32; d];
        self.wte.row_f32(token, &mut x);
        self.wpe.row_f32(pos, &mut tmp);
        for i in 0..d {
            x[i] += tmp[i];
        }

        let mut h = vec![0f32; d];
        let mut hq = QuantVec::new();
        let mut qkv = vec![0f32; 3 * d];
        let mut att_out = vec![0f32; d];
        let mut proj = vec![0f32; d];
        let mut gate = vec![0f32; self.cfg.hidden];
        let mut up = vec![0f32; self.cfg.hidden];
        let l2 = |v: &[f32]| (v.iter().map(|a| (a * a) as f64).sum::<f64>()).sqrt() as f32;

        for (_l, lay) in self.layers.iter().enumerate() {
            let mut lt = LayerTrace::default();
            lt.norm_in = l2(&x);
            layernorm(&x, &lay.ln1, &mut h);
            quantize_x(&h, &mut hq);
            lay.qkv.gemv(&hq, &mut qkv);
            bail_if_poisoned!(self);
            let (q, kv) = qkv.split_at(d);
            let (k_new, v_new) = kv.split_at(d);
            cache.k[_l].extend_from_slice(k_new);
            cache.v[_l].extend_from_slice(v_new);
            let t = cache.k[_l].len() / d;

            for head in 0..nh {
                let qh = &q[head * hd..(head + 1) * hd];
                let mut scores = Vec::with_capacity(t);
                let mut smax = f32::MIN;
                for ti in 0..t {
                    let kh = &cache.k[_l][ti * d + head * hd..ti * d + (head + 1) * hd];
                    let s = dot(qh, kh) * scale;
                    if s > smax {
                        smax = s;
                    }
                    scores.push(s);
                }
                let mut ssum = 0f32;
                for s in scores.iter_mut() {
                    *s = det_exp32(*s - smax);
                    ssum += *s;
                }
                let o = &mut att_out[head * hd..(head + 1) * hd];
                o.fill(0.0);
                let mut row = Vec::with_capacity(t);
                for ti in 0..t {
                    let w = scores[ti] / ssum;
                    row.push(w);
                    let vh = &cache.v[_l][ti * d + head * hd..ti * d + (head + 1) * hd];
                    for i in 0..hd {
                        o[i] += w * vh[i];
                    }
                }
                lt.attn.push(row);
            }
            quantize_x(&att_out, &mut hq);
            lay.aproj.gemv(&hq, &mut proj);
            bail_if_poisoned!(self);
            for i in 0..d {
                x[i] += proj[i];
            }
            lt.norm_attn = l2(&x);

            layernorm(&x, &lay.ln2, &mut h);
            quantize_x(&h, &mut hq);
            lay.gate.gemv(&hq, &mut gate);
            lay.up.gemv(&hq, &mut up);
            bail_if_poisoned!(self);
            for i in 0..self.cfg.hidden {
                let g = gate[i];
                gate[i] = g / (1.0 + det_exp32(-g)) * up[i];
            }
            quantize_x(&gate, &mut hq);
            lay.down.gemv(&hq, &mut proj);
            bail_if_poisoned!(self);
            for i in 0..d {
                x[i] += proj[i];
            }
            lt.norm_mlp = l2(&x);
            lt.x = x.clone();
            trace.layers.push(lt);
        }
        cache.len += 1;

        layernorm(&x.clone(), &self.lnf, &mut x);
        quantize_x(&x, &mut hq);
        let mut logits = vec![0f32; self.cfg.vocab];
        self.wte.gemv(&hq, &mut logits);
        bail_if_poisoned!(self);
        logits
    }
}

/// Introspection record for one step_traced() call (model observatory).
#[derive(Default)]
pub struct StepTrace {
    pub layers: Vec<LayerTrace>,
}

#[derive(Default)]
pub struct LayerTrace {
    pub attn: Vec<Vec<f32>>, // per head: softmaxed weights over cached positions
    pub norm_in: f32,        // residual L2 entering the layer
    pub norm_attn: f32,      // after the attention residual add
    pub norm_mlp: f32,       // after the MLP residual add (layer exit)
    pub x: Vec<f32>,         // residual stream at layer exit (d values)
}

/// f64 softmax (mirrors codec.py's `softmax(logits.double())`), naive fixed order.
pub fn softmax64(logits: &[f32]) -> Vec<f64> {
    let mut m = f64::MIN;
    for &l in logits {
        if (l as f64) > m {
            m = l as f64;
        }
    }
    let mut out: Vec<f64> = Vec::with_capacity(logits.len());
    let mut sum = 0f64;
    for &l in logits {
        let e = det_exp64((l as f64) - m);
        sum += e;
        out.push(e);
    }
    for o in out.iter_mut() {
        *o /= sum;
    }
    out
}
