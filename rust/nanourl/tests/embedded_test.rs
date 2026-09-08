//! The two artifacts inside the binary are the two the site ships.
//!
//! `nanourl` embeds the weights and the tokenizer; `web/src/lib/assets.json`
//! records the digests of what `task web:assets` packed for the browser. If
//! those ever differ, the CLI and the site are two different products wearing
//! one name, and the failure is silent, because both would still round-trip
//! internally and disagree about what a code means.
//!
//! This is the site end of the chain. `build.rs` holds the artifact end: it
//! refuses to embed a file whose length and sha256 are not `model_pin.rs`'s,
//! the same constants asserted here, and `cli_test` re-hashes what the binary
//! carries.
//!
//! `assets.json` is generated and gitignored, so its absence is a loud skip
//! rather than a failure, on the same terms as the crate's other artifact
//! gates: `URLCODEC_REQUIRE_ARTIFACTS=1` makes it a failure.

use nanourl::weights::{sha256_bytes, MODEL_BYTES, MODEL_SHA256};
use nanourl::TOKENIZER_JSON;
use serde_json::Value;

const ASSETS: &str = "../../web/src/lib/assets.json";

#[test]
fn the_embedded_artifacts_are_the_ones_the_site_packs() {
    let text = match std::fs::read_to_string(ASSETS) {
        Ok(t) => t,
        Err(e) => {
            assert!(
                std::env::var("URLCODEC_REQUIRE_ARTIFACTS").as_deref() != Ok("1"),
                "URLCODEC_REQUIRE_ARTIFACTS=1 but {ASSETS} is missing ({e}): run `task web:assets`"
            );
            use std::io::Write;
            let _ = writeln!(
                std::io::stderr(),
                "\n*** SKIPPED (embedded_test): no {ASSETS} -- run `task web:assets` ***\n"
            );
            return;
        }
    };
    let a: Value = serde_json::from_str(&text).unwrap();

    assert_eq!(a["model"]["sha256"], MODEL_SHA256, "model digest");
    assert_eq!(a["model"]["bytes"], MODEL_BYTES, "model size");

    // The tokenizer is embedded as text and packed as bytes; `include_str!`
    // reproduces the file verbatim, so one digest covers both.
    assert_eq!(
        a["tokenizer"]["sha256"],
        sha256_bytes(TOKENIZER_JSON.as_bytes()),
        "tokenizer digest"
    );
    assert_eq!(
        a["tokenizer"]["bytes"],
        TOKENIZER_JSON.len(),
        "tokenizer size"
    );
}
