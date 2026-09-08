//! End-to-end checks on the shipped `nanourl` binary.
//!
//! The parity test checks that `nanourl` and the site mint the SAME code for
//! the same URL. It gets there in two hops: `nanourl` calls the crate's C
//! ABI, which is literally the code the wasm builds export (the tier-parity
//! gate in `fuzz/run_tiers.sh` pins native ABI to every wasm tier), and this
//! file pins that against `urlcodec encode`, the other crate's own,
//! independent codec loop, pointed at the artifact on disk. A third opinion
//! is what makes the CLI's alphabet plumbing testable at all: the ABI and
//! the site agree by construction, so only an outside encoder can catch the
//! CLI handing them the wrong alphabet.
//!
//! `nanourl` is never given `--model` below, except where the override itself
//! is what is being tested. That is deliberate: it exercises the weights built
//! into the binary, and comparing them against `urlcodec` reading the artifact
//! from disk is what proves the two are the same model.
//!

use nanourl::link::bare_for;
use nanourl::weights::{MODEL_BYTES, MODEL_SHA256};
use nanourl::SITE_URL;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use urlcodec::coder::Alphabet;

const NANOURL: &str = env!("CARGO_BIN_EXE_nanourl");

/// The developer encoder, which belongs to the other crate.
///
/// `CARGO_BIN_EXE_*` only names binaries of the package under test, so this is
/// found beside `nanourl` in the shared workspace target directory. Anything
/// that builds the whole workspace puts it there; `task cli:test` builds it
/// explicitly, and its absence is a loud skip rather than a silent pass.
fn urlcodec_bin() -> PathBuf {
    Path::new(NANOURL)
        .parent()
        .expect("CARGO_BIN_EXE_nanourl has a directory")
        .join(if cfg!(windows) {
            "urlcodec.exe"
        } else {
            "urlcodec"
        })
}
const MODEL_DEFAULT: &str = "../../models/target-base/ptq.nurl";
const TOKENIZER: &str = "../../models/url-bpe-8k-cap24-s0/tokenizer.json";
const CLI_GOLDEN: &str = "tests/goldens/cli.json";

/// `--alphabet` as each binary spells it: the dev tool takes the wire name,
/// the shipped CLI takes the one a person types.
const ALPHABETS: [(&str, &str, Alphabet); 4] = [
    ("base64url", "base64url", Alphabet::Base64),
    ("base79", "base79", Alphabet::Base79),
    ("emoji", "emoji-1k", Alphabet::Emoji1k),
    ("qr-alpha", "qr-alpha", Alphabet::QrAlpha),
];

fn model() -> String {
    std::env::var("URLCODEC_MODEL").unwrap_or_else(|_| MODEL_DEFAULT.to_string())
}

/// Whether to run, with the crate's usual loud skip.
///
/// Two reasons to sit out. Without the 124.8 MiB artifact there is nothing to
/// compare, which `URLCODEC_REQUIRE_ARTIFACTS=1` turns into a failure. And an
/// unoptimized build spends ~30 s per model load against ~0.45 s optimized,
/// which over the invocations below is minutes, so a debug run says so and
/// stops. `task codec:test` runs `cargo test --release`, so the gate is
/// unaffected.
fn should_run() -> bool {
    let require = std::env::var("URLCODEC_REQUIRE_ARTIFACTS").as_deref() == Ok("1");
    let dev = urlcodec_bin();
    if !dev.exists() {
        assert!(
            !require,
            "URLCODEC_REQUIRE_ARTIFACTS=1 but {} is missing: the parity test has no second \
             opinion to compare against. Build it: cargo build --release -p urlcodec --bin urlcodec",
            dev.display()
        );
        loud(&format!("no developer encoder at {}", dev.display()));
        return false;
    }
    let m = model();
    if !Path::new(&m).exists() || !Path::new(TOKENIZER).exists() {
        assert!(
            !require,
            "URLCODEC_REQUIRE_ARTIFACTS=1 but {m} is missing: the CLI parity test has \
             nothing to run against. Point URLCODEC_MODEL at the weights."
        );
        loud(&format!("no artifacts at {m}"));
        return false;
    }
    if cfg!(debug_assertions) {
        loud("an unoptimized build loads the model in ~30 s; run `cargo test --release`");
        return false;
    }
    true
}

/// Straight to the process stderr: cargo's harness captures the print macros
/// and shows them only for FAILING tests, so a skip notice would be invisible
/// in exactly the run that needs it.
fn loud(why: &str) {
    use std::io::Write;
    let _ = writeln!(std::io::stderr(), "\n*** SKIPPED (cli_test): {why} ***\n");
}

fn run(bin: &str, args: &[&str]) -> Output {
    Command::new(bin)
        .args(args)
        .output()
        .unwrap_or_else(|e| panic!("{bin}: {e}"))
}

fn stdout(o: &Output) -> String {
    String::from_utf8(o.stdout.clone())
        .unwrap()
        .trim()
        .to_string()
}

fn examples() -> Vec<String> {
    let j: Value =
        serde_json::from_str(&std::fs::read_to_string(CLI_GOLDEN).expect(CLI_GOLDEN)).unwrap();
    j["examples"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect()
}

#[test]
fn nanourl_mints_the_same_codes_as_the_developer_encoder() {
    if !should_run() {
        return;
    }
    let m = model();
    for url in examples() {
        for (cli_name, dev_name, alpha) in ALPHABETS {
            let dev = run(
                &urlcodec_bin().to_string_lossy(),
                &[
                    "encode",
                    &url,
                    "--model",
                    &m,
                    "--tokenizer",
                    TOKENIZER,
                    "--alphabet",
                    dev_name,
                ],
            );
            assert!(dev.status.success(), "urlcodec encode failed for {url}");
            let ship = run(NANOURL, &["encode", &url, "--alphabet", cli_name, "--bare"]);
            assert!(ship.status.success(), "nanourl encode failed for {url}");
            // The developer encoder prints the digits the codec emitted;
            // `--bare` prints them as they are written on their own, which
            // for qr-alpha adds the marker.
            assert_eq!(
                bare_for(&stdout(&dev), alpha),
                stdout(&ship),
                "{cli_name} code for {url}"
            );
        }
    }
}

#[test]
fn a_link_it_minted_decodes_back_to_the_url_it_came_from() {
    if !should_run() {
        return;
    }
    for url in examples() {
        for (cli_name, _, alpha) in ALPHABETS {
            // The default output is the link, written through `fragment_for`,
            // so feeding it straight back exercises the marker and the sniffing
            // together: the round trip a person performs.
            let enc = run(NANOURL, &["encode", &url, "--alphabet", cli_name]);
            assert!(enc.status.success(), "encode {cli_name} {url}");
            let link = stdout(&enc);
            let dec = run(NANOURL, &["decode", &link]);
            assert!(dec.status.success(), "decode {link}");
            assert_eq!(stdout(&dec), url, "{cli_name} round trip via {link}");

            // The bare spelling too, unaided: a code that could pass as
            // another alphabet carries its marker digit, so every alphabet's
            // bare output identifies itself (base64url by being the default).
            let enc = run(NANOURL, &["encode", &url, "--alphabet", cli_name, "--bare"]);
            let bare = stdout(&enc);
            let dec = run(NANOURL, &["decode", &bare]);
            assert!(dec.status.success(), "decode --bare {bare}");
            assert_eq!(stdout(&dec), url, "{cli_name} bare round trip via {bare}");
            let _ = alpha;
        }
    }
}

#[test]
fn json_output_carries_the_same_answer_as_the_lines() {
    if !should_run() {
        return;
    }
    let url = &examples()[1];
    let plain = run(NANOURL, &["encode", url, "--bare"]);
    let linked = run(NANOURL, &["encode", url]);
    let js = run(NANOURL, &["encode", url, "--json"]);
    let v: Value = serde_json::from_str(&stdout(&js)).unwrap();
    assert_eq!(v["code"], stdout(&plain));
    assert_eq!(v["alphabet"], "base64url");
    assert_eq!(v["url"], url.as_str());
    assert_eq!(v["link"], format!("{SITE_URL}#{}", stdout(&plain)));
    assert_eq!(v["link"], stdout(&linked));
}

/// A script reads the exit codes, so they are asserted rather than left to
/// whatever the last `return` happened to be.
#[test]
fn exit_codes_separate_bad_input_from_an_unusable_override() {
    // No case here reaches a forward pass, so this one runs unoptimized too.
    // Only an OVERRIDE can be missing: the default weights are in the binary.
    let missing = run(
        NANOURL,
        &["decode", "pDkL", "--model", "/nonexistent/model.nurl"],
    );
    assert_eq!(missing.status.code(), Some(2), "missing override");

    let empty = run(NANOURL, &["decode", "https://qv.lc/#"]);
    assert_eq!(empty.status.code(), Some(1), "no code in the input");

    let malformed = run(NANOURL, &["decode", "https://qv.lc/#%zz"]);
    assert_eq!(malformed.status.code(), Some(1), "bad percent-encoding");

    // An empty URL is not something to mint a code for: the code would decode
    // back to nothing, and the caller would have no way to tell.
    let blank = run(NANOURL, &["encode", "   "]);
    assert_eq!(blank.status.code(), Some(1), "no URL in the input");

    // An override that cannot be read is 2 even when nothing is being coded:
    // `model info` must not report success about a model that is not there.
    let gone = run(
        NANOURL,
        &["model", "info", "--model", "/nonexistent/m.nurl"],
    );
    assert_eq!(
        gone.status.code(),
        Some(2),
        "model info with a missing override"
    );
    let gone_json = run(
        NANOURL,
        &["model", "info", "--model", "/nonexistent/m.nurl", "--json"],
    );
    let v: Value = serde_json::from_str(&stdout(&gone_json)).unwrap();
    assert_eq!(v["ok"], false);

    // A usage error must not land on 2, which means "model unavailable".
    let usage = run(NANOURL, &["encode"]);
    assert_eq!(usage.status.code(), Some(1), "missing argument");

    // --version is the release workflow's check that the tag and the binary
    // agree, so it has to be exactly the crate version and exit 0.
    let v = run(NANOURL, &["--version"]);
    assert_eq!(v.status.code(), Some(0));
    assert_eq!(stdout(&v), format!("nanourl {}", env!("CARGO_PKG_VERSION")));
}

/// `model` says what is in the binary, re-checks it, and hands it over.
#[test]
fn the_model_subcommand_reports_verifies_and_exports_the_built_in_weights() {
    let info = run(NANOURL, &["model", "info", "--json"]);
    assert_eq!(info.status.code(), Some(0), "model info");
    let v: Value = serde_json::from_str(&stdout(&info)).unwrap();
    assert_eq!(v["embedded"], true);
    assert_eq!(v["override"], Value::Null);
    assert_eq!(v["bytes"], MODEL_BYTES);
    assert_eq!(v["sha256"], MODEL_SHA256);

    // The one runtime proof that the bytes in the executable are the pinned
    // ones: `build.rs` checked the FILE it embedded, this re-hashes what the
    // binary came out carrying.
    let verified = run(NANOURL, &["model", "verify", "--json"]);
    assert_eq!(verified.status.code(), Some(0), "model verify");
    let v: Value = serde_json::from_str(&stdout(&verified)).unwrap();
    assert_eq!(v["published"], true);
    assert_eq!(v["sha256"], MODEL_SHA256);

    // Exported bytes have to be the artifact itself, or a tool handed them
    // would be working from something this binary does not use.
    let dir = std::env::temp_dir().join(format!("nanourl-export-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let out = dir.join("weights.nurl");
    let exported = run(NANOURL, &["model", "export", out.to_str().unwrap()]);
    assert_eq!(exported.status.code(), Some(0), "model export");
    assert_eq!(std::fs::metadata(&out).unwrap().len(), MODEL_BYTES);
    // The temporary the export renames from must not survive it.
    assert!(!dir.join("weights.nurl.partial").exists());
    // And the file it wrote must be usable as an override.
    let used = run(
        NANOURL,
        &["model", "verify", "--model", out.to_str().unwrap()],
    );
    assert_eq!(used.status.code(), Some(0), "the exported file verifies");
    assert!(String::from_utf8_lossy(&used.stdout).contains("matches the published model"));

    // A second export over the same path is refused: 124.8 MiB written over a
    // file the caller still wanted is not recoverable, so it takes --force.
    let again = run(NANOURL, &["model", "export", out.to_str().unwrap()]);
    assert_eq!(again.status.code(), Some(2), "export over an existing file");
    assert!(
        !dir.join("weights.nurl.partial").exists(),
        "no orphan temporary"
    );
    let forced = run(
        NANOURL,
        &["model", "export", out.to_str().unwrap(), "--force"],
    );
    assert_eq!(forced.status.code(), Some(0), "export --force");
    assert_eq!(std::fs::metadata(&out).unwrap().len(), MODEL_BYTES);
    let _ = std::fs::remove_dir_all(&dir);
}

/// The link is the default output; `--bare` drops the base and `--base` moves
/// it, in either argument order.
#[test]
fn the_link_is_the_default_and_base_and_bare_change_it() {
    if !should_run() {
        return;
    }
    let url = "https://example.com/a?b=1";
    let linked = run(NANOURL, &["encode", url]);
    assert_eq!(linked.status.code(), Some(0));
    assert!(
        stdout(&linked).starts_with(&format!("{SITE_URL}#")),
        "{}",
        stdout(&linked)
    );

    let bare = run(NANOURL, &["encode", url, "--bare"]);
    assert_eq!(bare.status.code(), Some(0));
    assert_eq!(format!("{SITE_URL}#{}", stdout(&bare)), stdout(&linked));

    let based = run(NANOURL, &["encode", "--base", "https://x.test/", url]);
    assert_eq!(based.status.code(), Some(0), "--base before the URL");
    assert_eq!(stdout(&based), format!("https://x.test/#{}", stdout(&bare)));
    let after = run(NANOURL, &["encode", url, "--base", "https://x.test/"]);
    assert_eq!(stdout(&after), stdout(&based), "--base after the URL");
}
