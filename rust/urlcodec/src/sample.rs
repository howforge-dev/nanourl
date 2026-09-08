//! URL hallucination: sample the LM instead of coding with it.
//!
//! Training rows are `<eos> url <eos>`, so conditioning on a lone <eos> and
//! sampling until the next <eos> draws a URL from the model's distribution.
//! Every forward pass goes through the same Chained::feed the codec uses —
//! sampling adds no inference math, so the stream format is untouched.
//!
//! Seeds are per-URL (`seed ^ index`), so a batch is reproducible and
//! order-independent: thread scheduling cannot change what comes out.

use crate::model::{softmax64, Chained, Model};

pub const EOS: usize = 0;

/// splitmix64 — identical on every platform, so a seed means the same URL
/// natively and in wasm.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Rng {
        Rng(seed)
    }

    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform in [0, 1): the top 53 bits, the usual double construction.
    pub fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }
}

pub struct Params {
    /// 0 = greedy (argmax); >0 divides the logits before softmax
    pub temp: f32,
    /// 0 = full distribution
    pub top_k: usize,
    pub max_tokens: usize,
}

impl Default for Params {
    fn default() -> Self {
        Params {
            temp: 1.0,
            top_k: 0,
            max_tokens: 128,
        }
    }
}

/// One sampled URL: its tokens (prefix included) and whether the model
/// actually terminated with <eos> rather than hitting max_tokens.
pub struct Sampled {
    pub ids: Vec<u32>,
    pub terminated: bool,
}

fn pick(logits: &[f32], p: &Params, rng: &mut Rng) -> usize {
    // NaN is checked SEPARATELY because `temp <= 0.0` is false for it, and
    // codec_sample takes `temp` straight from JS without validating it. A NaN
    // temperature would otherwise reach the softmax, make every probability
    // NaN, and trap the module on the `partial_cmp` below -- `wasm32-unknown-unknown`
    // is panic=abort, so that is an instance nobody can use again, with no
    // error JSON to say why. (An infinite temp is already harmless: l/inf is
    // 0, so the distribution is uniform.)
    if p.temp.is_nan() || p.temp <= 0.0 {
        let mut best = 0usize;
        for (i, &l) in logits.iter().enumerate() {
            if l > logits[best] {
                best = i;
            }
        }
        return best;
    }
    let scaled: Vec<f32> = logits.iter().map(|&l| l / p.temp).collect();
    let probs = softmax64(&scaled);

    // top-k by renormalizing over the k most likely — never by masking with
    // -inf, which would feed det_exp64 an infinity
    let mut cand: Vec<usize> = (0..probs.len()).collect();
    if p.top_k > 0 && p.top_k < probs.len() {
        // Total order even on a NaN that got in some other way: an
        // incomparable pair is simply left in its current order, which keeps
        // the result deterministic instead of aborting the module.
        cand.select_nth_unstable_by(p.top_k - 1, |&a, &b| {
            probs[b]
                .partial_cmp(&probs[a])
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        cand.truncate(p.top_k);
        cand.sort_unstable(); // stable order => seed reproducibility
    }
    let total: f64 = cand.iter().map(|&i| probs[i]).sum();
    let mut r = rng.unit() * total;
    for &i in &cand {
        r -= probs[i];
        if r <= 0.0 {
            return i;
        }
    }
    *cand.last().unwrap() // float slop at the tail
}

/// Sample one URL's tokens. `prefix` conditions the sample and is included
/// in the returned ids.
pub fn sample_ids(
    m: &Model,
    cache: &mut Chained,
    rng: &mut Rng,
    prefix: &[u32],
    p: &Params,
) -> Sampled {
    cache.reset();
    let mut logits = cache.feed(m, EOS);
    let mut ids: Vec<u32> = Vec::with_capacity(p.max_tokens);
    for &t in prefix {
        logits = cache.feed(m, t as usize);
        ids.push(t);
    }
    while ids.len() < p.max_tokens {
        // A tier-3 fault abandons the forward pass (model::step), so `logits`
        // is a constant rather than a real distribution from here on. Stop
        // instead of sampling 4096 tokens of nothing; the entry point answers
        // with the poison result either way. Compile-time `false` off the mt
        // build, so this costs nothing anywhere else.
        if crate::model::instance_poisoned() {
            return Sampled {
                ids,
                terminated: false,
            };
        }
        let tok = pick(&logits, p, rng);
        if tok == EOS {
            return Sampled {
                ids,
                terminated: true,
            };
        }
        ids.push(tok as u32);
        logits = cache.feed(m, tok);
    }
    Sampled {
        ids,
        terminated: false,
    }
}
