use std::fs;
use urlcodec::canonical::canonical;
use urlcodec::tok::Tok;

fn tok() -> Tok {
    let s = fs::read_to_string("../../models/url-bpe-8k-cap24-s0/tokenizer.json")
        .expect("tokenizer.json");
    Tok::load_str(&s).unwrap()
}

#[test]
fn tokenizer_matches_python_goldens() {
    let t = tok();
    let mut n = 0;
    for line in fs::read_to_string("tests/goldens/tok.jsonl")
        .unwrap()
        .lines()
    {
        let j: serde_json::Value = serde_json::from_str(line).unwrap();
        let url = j["url"].as_str().unwrap();
        let can = j["canonical"].as_str().unwrap();
        let ids: Vec<u32> = j["ids"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_u64().unwrap() as u32)
            .collect();
        assert_eq!(canonical(url), can, "canonical {url:?}");
        assert_eq!(t.encode(can).unwrap(), ids, "ids {url:?}");
        assert_eq!(t.decode(&ids).unwrap(), can, "decode {url:?}");
        assert_eq!(
            canonical(&t.decode(&t.encode(&canonical(url)).unwrap()).unwrap()),
            url,
            "pipeline {url:?}"
        );
        n += 1;
    }
    assert!(n >= 20);
}

#[test]
fn canonical_matches_python_fuzz() {
    for line in fs::read_to_string("tests/goldens/canonical.jsonl")
        .unwrap()
        .lines()
    {
        let j: serde_json::Value = serde_json::from_str(line).unwrap();
        let i = j["in"].as_str().unwrap();
        assert_eq!(canonical(i), j["out"].as_str().unwrap(), "{i:?}");
        assert_eq!(canonical(&canonical(i)), i);
    }
}
