//! urlcodec is the URL compressor: nanourl model + arithmetic coder, Rust
//! port of codec.py. Encode and decode share the same incremental model path,
//! so the stream is self-consistent by construction.
//!
//!   urlcodec encode    <url>    --model m.nurl --tokenizer tokenizer.json
//!   urlcodec decode    <string> --model ... --tokenizer ...
//!   urlcodec roundtrip <url>    --model ... --tokenizer ...
//!   urlcodec eval   --urls urls.txt [--n 1000] --model ... --tokenizer ...
//!   urlcodec sample [--n 10] [--temp 1.0] [--top-k 0] [--prefix P] [--seed 1]
//!     --prefix is canonical text (hosts TLD-first), tokenised as given and
//!     never canonicalised, since a partial host has no consistent canonical form

// ported nanourl code: lints allowed crate-wide so the gate stays meaningful
// for new code. THIS LIST MUST MATCH lib.rs's: main.rs compiles its own copies
// of canonical/coder/model/sample/tok, so a lint allowed in only one of the
// two roots fails `task codec:test` through the other target alone, which the
// chunks_exact_to_as_chunks entry below exists to prevent.
#![allow(dead_code)]
#![allow(clippy::needless_range_loop)]
#![allow(clippy::missing_safety_doc)]
#![allow(clippy::approx_constant)]
#![allow(clippy::assign_op_pattern)]
#![allow(clippy::unnecessary_map_or)]
#![allow(clippy::field_reassign_with_default)]
#![allow(clippy::new_without_default)]
#![allow(unknown_lints)]
#![allow(clippy::chunks_exact_to_as_chunks)]

mod canonical;
mod coder;
mod model;
mod sample;
mod tok;

use model::{softmax64, Chained, Model};
use std::io::{BufRead, Write};
use std::time::Instant;
use tok::Tok;

struct Codec {
    model: Model,
    tok: Tok,
    version: u32,
    alpha: coder::Alphabet,
}

impl Codec {
    fn encode_bits(&self, cache: &mut Chained, url: &str) -> Result<Vec<u8>, String> {
        let ids = self.tok.encode(&canonical::canonical(url))?;
        let eos = self.tok.eos_id as usize;
        cache.reset();
        let mut enc = coder::Encoder::new();
        let mut logits = cache.feed(&self.model, eos);
        for &id in ids.iter() {
            let cum = coder::quantize(&softmax64(&logits));
            enc.encode(cum[id as usize], cum[id as usize + 1]);
            logits = cache.feed(&self.model, id as usize);
        }
        let cum = coder::quantize(&softmax64(&logits));
        enc.encode(cum[eos], cum[eos + 1]); // in-band terminator
        Ok(enc.finish())
    }

    fn encode(&self, cache: &mut Chained, url: &str) -> Result<String, String> {
        Ok(coder::bits_to_string_in(
            &self.encode_bits(cache, url)?,
            self.version,
            self.alpha,
        ))
    }

    fn decode(&self, cache: &mut Chained, s: &str) -> Result<String, String> {
        let (version, bits) = coder::string_to_bits_in(s, self.alpha)?;
        if version != self.version {
            return Err(format!(
                "stream version {version}, but this codec is configured for {} \
                 — decode with the matching model/runtime",
                self.version
            ));
        }
        let eos = self.tok.eos_id as usize;
        cache.reset();
        let mut dec = coder::Decoder::new(&bits);
        let mut logits = cache.feed(&self.model, eos);
        let mut out: Vec<u32> = Vec::new();
        loop {
            let cum = coder::quantize(&softmax64(&logits));
            let target = dec.scaled();
            // searchsorted(cum, target, side=right) - 1
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
            dec.update(cum[sym], cum[sym + 1]);
            if sym == eos {
                return self.tok.decode(&out).map(|can| canonical::canonical(&can));
            }
            out.push(sym as u32);
            if out.len() > 65536 {
                return Err("no <eos> within 65536 tokens: corrupt input?".into());
            }
            logits = cache.feed(&self.model, sym);
        }
    }
}

fn arg_value(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1).cloned())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("usage: urlcodec encode|decode|roundtrip|eval|fuzz|dist|bits ...");
        std::process::exit(2);
    }
    let cmd = args[1].as_str();
    let model_path = arg_value(&args, "--model").unwrap_or("model.nurl".into());
    let tok_path = arg_value(&args, "--tokenizer").unwrap_or("tokenizer.json".into());

    if cmd == "fuzz" {
        // Cross-runtime fuzz: run THE LIB's C-ABI path (the exact code wasm
        // runs) over generated cases; emit one line per case for diffing
        // against the node driver's output. Columns: idx, alphabet, status,
        // coded-or-error, roundtrip flag, fnv64 of the raw encode+decode
        // JSON (informational: catches stats-level divergence like libm
        // log2 wobble without failing the stream comparison), dist_hash,
        // logit_hash (both COMPARED: see fuzz/run_tiers.sh).
        let n: u64 = arg_value(&args, "--n")
            .map(|v| v.parse().unwrap())
            .unwrap_or(500);
        let seed: u64 = arg_value(&args, "--seed")
            .map(|v| v.parse().unwrap())
            .unwrap_or(1);
        // shard i-of-k: cases idx ≡ i (mod k); the runner merges by idx
        let shard: u64 = arg_value(&args, "--shard")
            .map(|v| v.parse().unwrap())
            .unwrap_or(0);
        let shards: u64 = arg_value(&args, "--shards")
            .map(|v| v.parse().unwrap())
            .unwrap_or(1);
        let mbytes = std::fs::read(&model_path).unwrap();
        let tbytes = std::fs::read(&tok_path).unwrap();
        // DIGEST_BIT: this subcommand exists to emit the parity columns.
        let rc = unsafe {
            urlcodec::codec_init(
                mbytes.as_ptr(),
                mbytes.len(),
                tbytes.as_ptr(),
                tbytes.len(),
                urlcodec::DIGEST_BIT,
            )
        };
        assert_eq!(rc, 0, "codec_init failed");
        let fnv = |s: &str| -> u64 {
            let mut h: u64 = 0xcbf2_9ce4_8422_2325;
            for b in s.bytes() {
                h ^= b as u64;
                h = h.wrapping_mul(0x1000_0000_01b3);
            }
            h
        };
        for i in (shard..n).step_by(shards as usize) {
            let url = urlcodec::fuzzgen::gen_url(seed, i);
            // The alphabet cycle is offset by one every 8 cases: fuzzgen
            // cycles its 8 URL modes on idx % 8, and a plain idx % 4 would
            // pair each mode with one alphabet forever. Identical in
            // fuzz/driver_common.js, which the gate compares this against.
            let alpha = ((i + i / 8) % 4) as i32;
            let alph = ["b79", "b64", "emoji-1k", "qr-alpha"][alpha as usize];
            let ub = url.as_bytes();
            unsafe { urlcodec::codec_encode(ub.as_ptr(), ub.len(), alpha) };
            let ej = urlcodec::last_result_str();
            let e: serde_json::Value = serde_json::from_str(&ej).unwrap();
            if !e["ok"].as_bool().unwrap() {
                println!(
                    "{i}	{alph}	ERR	{}	-	{:016x}	-	-",
                    e["error"].as_str().unwrap(),
                    fnv(&ej)
                );
                continue;
            }
            let coded = e["coded"].as_str().unwrap().to_string();
            let cb = coded.as_bytes();
            unsafe { urlcodec::codec_decode(cb.as_ptr(), cb.len(), alpha) };
            let dj = urlcodec::last_result_str();
            let d: serde_json::Value = serde_json::from_str(&dj).unwrap();
            let rt = d["ok"].as_bool().unwrap() && d["url"].as_str() == Some(url.as_str());
            println!(
                "{i}	{alph}	OK	{coded}	{}	{:016x}	{}	{}",
                if rt { "RT_OK" } else { "RT_FAIL" },
                fnv(&format!("{ej}|{dj}")),
                e["dist_hash"].as_str().unwrap(),
                e["logit_hash"].as_str().unwrap()
            );
        }
        std::process::exit(0);
    }

    if cmd == "toktest" {
        // tokenizer parity vs Python goldens: one {"url","canonical","ids"} per line
        let path = arg_value(&args, "--golden").expect("--golden FILE");
        let tok = Tok::load_str(&std::fs::read_to_string(&tok_path).unwrap()).unwrap();
        let (mut ok, mut bad) = (0usize, 0usize);
        for line in std::fs::read_to_string(&path).unwrap().lines() {
            let j: serde_json::Value = serde_json::from_str(line).unwrap();
            let can = j["canonical"].as_str().unwrap();
            let ids: Vec<u32> = j["ids"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_u64().unwrap() as u32)
                .collect();
            if tok.encode(can).unwrap_or_default() == ids {
                ok += 1
            } else {
                bad += 1;
                eprintln!("MISMATCH {}", j["url"]);
            }
        }
        println!("toktest: {ok} ok, {bad} mismatched");
        if bad > 0 {
            std::process::exit(1)
        }
        std::process::exit(0);
    }

    if cmd == "dist" {
        // Full-vocab distribution dump through the LIB's C-ABI codec_dist
        // (the same entry point the wasm builds expose), so fuzz/dist_compare.py
        // can diff native against each wasm tier value by value. One
        // {"url","k",...codec_dist JSON} per --at pair, newline separated.
        //   urlcodec dist --model M --tokenizer T --urls FILE --n 20 --k 5
        let path = arg_value(&args, "--urls").expect("--urls FILE (one URL per line)");
        let n: usize = arg_value(&args, "--n")
            .map(|v| v.parse().unwrap())
            .unwrap_or(20);
        let k: i32 = arg_value(&args, "--k")
            .map(|v| v.parse().unwrap())
            .unwrap_or(5);
        let mbytes = std::fs::read(&model_path).unwrap();
        let tbytes = std::fs::read(&tok_path).unwrap();
        let rc = unsafe {
            urlcodec::codec_init(
                mbytes.as_ptr(),
                mbytes.len(),
                tbytes.as_ptr(),
                tbytes.len(),
                0,
            )
        };
        assert_eq!(rc, 0, "codec_init failed");
        for url in std::fs::read_to_string(&path).unwrap().lines().take(n) {
            let ub = url.as_bytes();
            unsafe { urlcodec::codec_dist(ub.as_ptr(), ub.len(), k, 0) };
            println!("{}", urlcodec::last_result_str());
        }
        std::process::exit(0);
    }

    if cmd == "bits" {
        // urlcodec bits MODEL.nurl TOKENS.txt
        let model = Model::load(&args[2]).unwrap_or_else(|e| {
            eprintln!("{e}");
            std::process::exit(1)
        });
        let mut cache = Chained::new(&model);
        let file = std::fs::File::open(&args[3]).expect("tokens file");
        let stdout = std::io::stdout();
        let mut out = stdout.lock();
        for line in std::io::BufReader::new(file).lines() {
            let ids: Vec<usize> = line
                .unwrap()
                .split_whitespace()
                .map(|t| t.parse().unwrap())
                .collect();
            cache.reset();
            let mut bits = 0f64;
            let mut logits = cache.feed(&model, 0);
            for &id in &ids {
                bits += -softmax64(&logits)[id].log2();
                logits = cache.feed(&model, id);
            }
            bits += -softmax64(&logits)[0].log2();
            writeln!(out, "{:.6} {}", bits, ids.len()).unwrap();
        }
        std::process::exit(0);
    }

    let t0 = Instant::now();
    let codec = Codec {
        model: Model::load(&model_path).unwrap_or_else(|e| panic!("model: {e}")),
        tok: std::fs::read_to_string(&tok_path)
            .map_err(|e| e.to_string())
            .and_then(|s| Tok::load_str(&s))
            .unwrap_or_else(|e| panic!("tokenizer: {e}")),
        version: arg_value(&args, "--stream-version")
            .map(|v| {
                let n: u32 = v
                    .parse()
                    .unwrap_or_else(|_| panic!("--stream-version: not a number: {v}"));
                // bits_to_string_in unwraps version_header, which has no
                // encoding above 320; say so here instead of panicking deep
                // in the coder.
                if !coder::version_supported(n) {
                    panic!("--stream-version {n}: no header encoding (supported: 0..=320)");
                }
                n
            })
            .unwrap_or(coder::STREAM_VERSION),
        alpha: match arg_value(&args, "--alphabet").as_deref() {
            Some("base79") => coder::Alphabet::Base79,
            Some("emoji-1k") => coder::Alphabet::Emoji1k,
            Some("qr-alpha") => coder::Alphabet::QrAlpha,
            _ => coder::Alphabet::Base64,
        },
    };
    eprintln!("loaded {model_path} in {:.1}s", t0.elapsed().as_secs_f32());
    let mut cache = Chained::new(&codec.model);

    match cmd {
        "encode" => {
            let url = &args[2];
            println!("{}", codec.encode(&mut cache, url).unwrap());
        }
        "decode" => {
            let s = &args[2];
            println!("{}", codec.decode(&mut cache, s).unwrap());
        }
        "roundtrip" => {
            let url = &args[2];
            let t = Instant::now();
            let s = codec.encode(&mut cache, url).unwrap();
            let te = t.elapsed().as_secs_f64();
            let t = Instant::now();
            let back = codec.decode(&mut cache, &s).unwrap();
            let td = t.elapsed().as_secs_f64();
            assert_eq!(back, *url, "ROUND-TRIP FAILED");
            let bits = coder::string_to_bits_in(&s, codec.alpha).unwrap().1.len();
            // chars, not bytes: an emoji code is 4 bytes per visible character
            let s_chars = s.chars().count();
            println!("{url}\n-> {s}");
            println!(
                "round-trip OK: {} -> {} chars ({:.3}), {} bits = {:.4} bits/char, \
                 encode {:.0} ms, decode {:.0} ms",
                url.len(),
                s_chars,
                s_chars as f64 / url.len() as f64,
                bits,
                bits as f64 / url.len() as f64,
                te * 1e3,
                td * 1e3
            );
        }
        "bench" => {
            let n: usize = arg_value(&args, "--n")
                .map(|v| v.parse().unwrap())
                .unwrap_or(100);
            cache.reset();
            let mut logits = codec.model.step(&mut cache.cache, 0, 0);
            let mut t_sm = 0f64;
            let t = Instant::now();
            for i in 1..n {
                let t1 = Instant::now();
                let cum = coder::quantize(&softmax64(&logits));
                std::hint::black_box(&cum);
                t_sm += t1.elapsed().as_secs_f64();
                logits = codec
                    .model
                    .step(&mut cache.cache, (i * 37) % 32000, i.min(510));
            }
            let dt = t.elapsed().as_secs_f64();
            let per = dt * 1e3 / (n - 1) as f64;
            let sm = t_sm * 1e3 / (n - 1) as f64;
            println!(
                "{per:.2} ms/token total  |  model step {:.2}  |  softmax+quantize {sm:.2}",
                per - sm
            );
        }
        "sample" => {
            // Hallucinate URLs. One URL per worker thread: a forward pass is
            // memory-bandwidth bound and strictly serial WITHIN a URL, but
            // URLs are independent, so cores buy near-linear throughput.
            // Per-URL seeds keep output identical regardless of scheduling.
            let n: usize = arg_value(&args, "--n")
                .map(|v| v.parse().unwrap())
                .unwrap_or(10);
            let seed: u64 = arg_value(&args, "--seed")
                .map(|v| v.parse().unwrap())
                .unwrap_or(1);
            let threads: usize = arg_value(&args, "--threads")
                .map(|v| v.parse().unwrap())
                .unwrap_or_else(|| {
                    std::thread::available_parallelism()
                        .map(|v| v.get())
                        .unwrap_or(1)
                })
                .clamp(1, n.max(1));
            let p = sample::Params {
                temp: arg_value(&args, "--temp")
                    .map(|v| v.parse().unwrap())
                    .unwrap_or(1.0),
                top_k: arg_value(&args, "--top-k")
                    .map(|v| v.parse().unwrap())
                    .unwrap_or(0),
                max_tokens: arg_value(&args, "--max-tokens")
                    .map(|v| v.parse().unwrap())
                    .unwrap_or(128),
            };
            // --prefix is canonical text (hosts TLD-first): tokenised as
            // given, never canonicalised, since a partial host cannot be
            // canonicalised consistently mid-way. Only the complete output
            // is de-canonicalised (below) into the printed URL.
            let prefix_str = arg_value(&args, "--prefix").unwrap_or_default();
            let prefix = if prefix_str.is_empty() {
                Vec::new()
            } else {
                codec.tok.encode(&prefix_str).expect("prefix tokenize")
            };
            let t = Instant::now();
            let (tx, rx) = std::sync::mpsc::channel::<(usize, String)>();
            std::thread::scope(|s| {
                for tid in 0..threads {
                    let (tx, codec, prefix, p) = (tx.clone(), &codec, &prefix, &p);
                    s.spawn(move || {
                        let mut cache = Chained::new(&codec.model);
                        for i in (tid..n).step_by(threads) {
                            let mut rng =
                                sample::Rng::new(seed ^ (i as u64).wrapping_mul(0x9E37_79B9));
                            let out =
                                sample::sample_ids(&codec.model, &mut cache, &mut rng, prefix, p);
                            let url = canonical::canonical(
                                &codec.tok.decode(&out.ids).unwrap_or_default(),
                            );
                            let mark = if out.terminated { "" } else { "…" };
                            tx.send((i, format!("{url}{mark}"))).unwrap();
                        }
                    });
                }
                drop(tx);
                let mut got: Vec<(usize, String)> = rx.iter().collect();
                got.sort_by_key(|(i, _)| *i);
                for (_, u) in got {
                    println!("{u}");
                }
            });
            let dt = t.elapsed().as_secs_f64();
            eprintln!(
                "{n} URLs in {dt:.2}s ({:.0} ms/URL, {threads} threads)",
                dt * 1e3 / n as f64
            );
        }
        "eval" => {
            let file = arg_value(&args, "--urls").expect("--urls FILE required");
            let n: usize = arg_value(&args, "--n")
                .map(|v| v.parse().unwrap())
                .unwrap_or(usize::MAX);
            let text = std::fs::read_to_string(&file).unwrap();
            let urls: Vec<&str> = text.lines().filter(|l| !l.is_empty()).take(n).collect();
            let mut bits_total = 0usize;
            let mut chars_total = 0usize;
            let mut out_chars = 0usize;
            let mut skipped = 0usize;
            let t = Instant::now();
            for (i, url) in urls.iter().enumerate() {
                match codec.encode_bits(&mut cache, url) {
                    Err(_) => skipped += 1,
                    Ok(bits) => {
                        let s = coder::bits_to_string_in(&bits, codec.version, codec.alpha);
                        let back = codec.decode(&mut cache, &s).unwrap();
                        assert_eq!(back, **url, "round-trip failed for {url:?}");
                        bits_total += bits.len();
                        chars_total += url.len();
                        out_chars += s.chars().count();
                    }
                }
                if (i + 1) % 100 == 0 {
                    eprintln!("  {}/{} ...", i + 1, urls.len());
                }
            }
            let dt = t.elapsed().as_secs_f64();
            let done = urls.len() - skipped;
            println!("{done} URLs round-tripped exactly ({skipped} skipped too-long)");
            println!(
                "coded bits/char {:.4}  |  base79 chars ratio {:.4}  |  \
                 {:.0} ms/URL (encode+decode)",
                bits_total as f64 / chars_total as f64,
                out_chars as f64 / chars_total as f64,
                dt * 1e3 / done as f64
            );
        }
        _ => {
            eprintln!("unknown command {cmd}");
            std::process::exit(2);
        }
    }
}
