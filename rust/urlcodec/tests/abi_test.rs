use std::path::Path;
use std::sync::Mutex;
use urlcodec::*;

// codec_init/codec_encode/codec_decode all touch the crate's single global
// codec instance (WCodec is `static mut`, by design: one instance, one
// wasm module). cargo's default test harness runs #[test] fns from the
// same binary concurrently, so two tests racing on that global segfaults.
// Serialize this file's tests on one lock rather than touching the
// production single-instance design.
static LOCK: Mutex<()> = Mutex::new(());

const MODEL_DEFAULT: &str = "../../models/target-base/ptq.nurl";
const TOKENIZER_DEFAULT: &str = "../../models/url-bpe-8k-cap24-s0/tokenizer.json";

/// Where the artifacts are. `models/target-base` is a symlink to a path
/// outside the repo, so on a build box the mirror's copy of it dangles even
/// though the box HAS the model — which is precisely where
/// `URLCODEC_REQUIRE_ARTIFACTS=1` is meant to be used. `URLCODEC_MODEL` /
/// `URLCODEC_TOKENIZER` point these tests at the real paths there.
fn artifact(var: &str, default: &str) -> String {
    std::env::var(var).unwrap_or_else(|_| default.to_string())
}

/// Load the real artifacts, or skip LOUDLY.
///
/// These tests are the only thing that runs the shipped C ABI against the
/// shipped model, and the model is a 125 MiB artifact outside git (behind the
/// `models/target-base` symlink). Without a loud skip, their absence would
/// return `true`-less and pass in silence — a test reporting success for its
/// own absence.
///
/// The default is now a **loud skip**: a bare `cargo test` on a fresh clone
/// still passes, but prints an unmissable SKIPPED line naming the path it
/// wanted. Anything that is acting as a gate sets
/// `URLCODEC_REQUIRE_ARTIFACTS=1` — `task codec:test` and `fuzz/run_tiers.sh`
/// both do — and then the absence is a hard failure. (`fuzz/run_tiers.sh`
/// itself fails without artifacts unconditionally; it has nothing to compare,
/// which is not the same as a developer running unit tests.)
fn init() -> bool {
    let model = artifact("URLCODEC_MODEL", MODEL_DEFAULT);
    let tokenizer = artifact("URLCODEC_TOKENIZER", TOKENIZER_DEFAULT);
    if !Path::new(&model).exists() || !Path::new(&tokenizer).exists() {
        if std::env::var("URLCODEC_REQUIRE_ARTIFACTS").as_deref() == Ok("1") {
            panic!(
                "URLCODEC_REQUIRE_ARTIFACTS=1 but {model} or {tokenizer} is missing: \
                 the ABI tests have nothing to run against. Fetch them from \
                 the model-v0 GitHub release, or point \
                 URLCODEC_MODEL / URLCODEC_TOKENIZER at them."
            );
        }
        // Written straight to the process stderr, NOT via eprintln!: cargo's
        // test harness captures the std print macros and shows them only for
        // FAILING tests, so an eprintln! here would be invisible in exactly
        // the run it needs to be seen in. A direct `std::io::stderr()` write
        // bypasses that capture.
        use std::io::Write;
        let _ = writeln!(
            std::io::stderr(),
            "\n*** SKIPPED: no artifacts at {model} (or {tokenizer}) -- this ABI test \
             asserted NOTHING.\n*** Fetch them from the model-v0 GitHub release \
             (or set URLCODEC_MODEL / URLCODEC_TOKENIZER), or set \
             URLCODEC_REQUIRE_ARTIFACTS=1 to make this a failure.\n"
        );
        return false;
    }
    let mb = std::fs::read(&model).unwrap();
    let tb = std::fs::read(&tokenizer).unwrap();
    assert_eq!(
        unsafe { codec_init(mb.as_ptr(), mb.len(), tb.as_ptr(), tb.len(), 0) },
        0
    );
    true
}

/// A tokenizer whose vocabulary does not match the model's is an error
/// code, not a trap. On `wasm32-unknown-unknown` (panic=abort) the first
/// encode would index `cum[id + 1]` and `wte.row_f32(id, ..)` past tables
/// sized by the model and take the whole instance down with no JSON and no
/// return code; the web client fetches the two as separate hashed assets, so
/// a stale cached tokenizer is a live path to it.
#[test]
fn vocab_mismatch_is_an_error_code_not_a_trap() {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if !init() {
        return;
    }
    let mb = std::fs::read(artifact("URLCODEC_MODEL", MODEL_DEFAULT)).unwrap();
    // A real, well-formed tokenizer.json — just not this model's: one token
    // in the vocabulary instead of 8192.
    let tiny = r#"{"model":{"type":"BPE","vocab":{"<eos>":0},"merges":[]}}"#;
    assert_eq!(
        unsafe { codec_init(mb.as_ptr(), mb.len(), tiny.as_ptr(), tiny.len(), 0) },
        5,
        "a vocab-size mismatch must return 5"
    );
    // ...and the rejected init must not have replaced the live codec.
    codec_info();
    let info: serde_json::Value = serde_json::from_str(&last_result_str()).unwrap();
    assert_eq!(
        info["vocab"], 8192,
        "a rejected init must not disturb the codec"
    );
    let url = "https://www.example.com/a/b?c=1";
    unsafe { codec_encode(url.as_ptr(), url.len(), 1) };
    let enc: serde_json::Value = serde_json::from_str(&last_result_str()).unwrap();
    assert_eq!(enc["ok"], true, "the previous codec still encodes");
}

#[test]
fn info_and_roundtrip_with_canonical() {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if !init() {
        return;
    }
    codec_info();
    let info: serde_json::Value = serde_json::from_str(&last_result_str()).unwrap();
    assert_eq!(info["vocab"], 8192);
    assert_eq!(info["d_model"], 1280);
    assert_eq!(info["n_layer"], 12);
    assert!(info["params"].as_u64().unwrap() > 240_000_000);
    let url = "https://www.example.com/a/b?c=1";
    unsafe { codec_encode(url.as_ptr(), url.len(), 1) };
    let enc: serde_json::Value = serde_json::from_str(&last_result_str()).unwrap();
    assert_eq!(enc["ok"], true);
    assert_eq!(enc["canonical"], "https://com.example.www/a/b?c=1");
    assert_eq!(enc["tokens"][0]["piece"], "https://");
    let code = enc["coded"].as_str().unwrap().to_string();
    unsafe { codec_decode(code.as_ptr(), code.len(), 1) };
    let dec: serde_json::Value = serde_json::from_str(&last_result_str()).unwrap();
    assert_eq!(dec["url"], url);
}

#[test]
fn sample_prefix_is_canonical_text() {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if !init() {
        return;
    }
    // The prefix is canonical text (hosts TLD-first) — codec_sample must
    // tokenise it as given, not canonicalise it first. A partial host like
    // "www." cannot be canonicalised consistently mid-way, so the caller
    // (the dream page) is defined to pass canonical text, and only the
    // complete sampled string gets de-canonicalised back to a real URL.
    let prefix = "https://com.example.www/";
    unsafe { codec_sample(7, 1.0, 0, 8, prefix.as_ptr(), prefix.len()) };
    let out: serde_json::Value = serde_json::from_str(&last_result_str()).unwrap();
    assert_eq!(out["ok"], true);
    assert!(
        out["canonical"].as_str().unwrap().starts_with(prefix),
        "canonical {:?} should start with the verbatim prefix {:?}",
        out["canonical"],
        prefix
    );
    assert!(
        out["url"]
            .as_str()
            .unwrap()
            .starts_with("https://www.example.com/"),
        "url {:?} should start with the de-canonicalised prefix",
        out["url"]
    );
}

#[test]
fn wrong_version_is_refused() {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if !init() {
        return;
    }
    // A stream whose 2-bit header says version 1 (bits_to_string_in with version 1 → decode must refuse)
    let bits = vec![1u8, 0, 1, 1, 0, 0, 1];
    let s = urlcodec::coder::bits_to_string_in(&bits, 1, urlcodec::coder::Alphabet::Base64);
    unsafe { codec_decode(s.as_ptr(), s.len(), 1) };
    let dec: serde_json::Value = serde_json::from_str(&last_result_str()).unwrap();
    assert_eq!(dec["ok"], false);
    assert!(dec["error"]
        .as_str()
        .unwrap()
        .contains("unsupported stream version"));
}
