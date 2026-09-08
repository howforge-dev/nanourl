//! The Rust half of the cross-language pin on link handling.
//!
//! `web/scripts/cli-goldens.ts` computes these two files from
//! `web/src/lib/alphabet.ts` and `web/src/lib/links.ts`; `web/tests/
//! cli-goldens.test.ts` fails when they no longer describe that TypeScript,
//! and this file fails when `nanourl::link` no longer matches them. So
//! the site's rules and the CLI's port cannot move independently, which
//! matters because the way they diverge is silent: a code that loses its
//! leading '~' still decodes, to a different URL, without an error.

use nanourl::link::{alphabet_key, fragment_for, parse_link, sniff, DEFAULT_ALPHABET};
use nanourl::{weights, SITE_URL};
use serde_json::Value;
use urlcodec::coder::Alphabet;

const LINK_GOLDEN: &str = "tests/goldens/link.jsonl";
const CLI_GOLDEN: &str = "tests/goldens/cli.json";

fn alpha(v: &Value) -> Option<Alphabet> {
    v.as_i64().map(|n| Alphabet::from_i32(n as i32))
}

#[test]
fn link_handling_matches_the_app() {
    let text = std::fs::read_to_string(LINK_GOLDEN).expect(LINK_GOLDEN);
    let mut codes = 0;
    let mut parses = 0;
    for line in text.lines() {
        let j: Value = serde_json::from_str(line).unwrap();
        match j["kind"].as_str().unwrap() {
            "code" => {
                codes += 1;
                let code = j["code"].as_str().unwrap();
                let a = alpha(&j["alpha"]).unwrap();
                assert_eq!(fragment_for(code, a), j["fragment"], "fragment {code:?}");
                assert_eq!(sniff(code), alpha(&j["sniff"]), "sniff {code:?}");

                let link = format!("{SITE_URL}#{}", j["fragment"].as_str().unwrap());
                let p = parse_link(&link).unwrap();
                assert_eq!(p.code, j["fromLink"]["code"], "link code {code:?}");
                assert_eq!(
                    p.alpha,
                    alpha(&j["fromLink"]["alpha"]),
                    "link alpha {code:?}"
                );

                let b = parse_link(code).unwrap();
                assert_eq!(b.code, j["bare"]["code"], "bare code {code:?}");
                assert_eq!(b.alpha, alpha(&j["bare"]["alpha"]), "bare alpha {code:?}");
            }
            "parse" => {
                parses += 1;
                let input = j["input"].as_str().unwrap();
                match parse_link(input) {
                    Ok(p) => {
                        assert!(j["error"].is_null(), "expected an error for {input:?}");
                        assert_eq!(p.code, j["code"], "code {input:?}");
                        assert_eq!(p.alpha, alpha(&j["alpha"]), "alpha {input:?}");
                    }
                    Err(e) => assert_eq!(Value::String(e), j["error"], "error {input:?}"),
                }
            }
            k => panic!("unknown golden kind {k:?}"),
        }
    }
    // The file is generated, so a truncated or half-written one would
    // otherwise pass by testing nothing.
    assert!(codes >= 36, "only {codes} code cases");
    assert!(parses >= 6, "only {parses} parse cases");
}

#[test]
fn the_cli_constants_match_the_app() {
    let j: Value =
        serde_json::from_str(&std::fs::read_to_string(CLI_GOLDEN).expect(CLI_GOLDEN)).unwrap();
    assert_eq!(j["site"], SITE_URL);
    assert_eq!(j["modelAsset"], weights::MODEL_URL);
    assert_eq!(j["defaultAlphabet"], DEFAULT_ALPHABET.id());
    for a in j["alphabets"].as_array().unwrap() {
        let id = a["id"].as_i64().unwrap() as i32;
        assert_eq!(alphabet_key(Alphabet::from_i32(id)), a["key"]);
        assert_eq!(Alphabet::from_i32(id).id(), id);
    }
}
