//! Alphabet sniffing, fragment marking and link parsing — the rules the web
//! app states in `web/src/lib/alphabet.ts`, so that `nanourl decode` accepts
//! exactly what the site's Decode pane accepts.
//!
//! This is a second implementation of a format, which is a thing that drifts.
//! It drifts SILENTLY here: '~' is base79 digit 65 *and* the fragment scheme's
//! alphabet marker, so stripping it from a bare code drops the code's most
//! significant digit, and about a third of the time the truncated stream still
//! parses as stream version 0 and decodes to a plausible but completely
//! different URL with no error at all. `tests/link_test.rs` therefore replays
//! `tests/goldens/link.jsonl`, which the TypeScript generates and its own
//! tests keep fresh: neither side can move without breaking a gate.

use urlcodec::coder::{Alphabet, ALPHABET, ALPHABET64};

/// The alphabet a code falls back to when sniffing cannot tell base79 from
/// base64url — base64url, the charset every link is minted in.
pub const DEFAULT_ALPHABET: Alphabet = Alphabet::Base64;

/// The name each alphabet answers to on the command line and in `--json`,
/// spelled as `web/src/lib/alphabet.ts`'s `ALPHABETS` spells it.
pub fn alphabet_key(a: Alphabet) -> &'static str {
    match a {
        Alphabet::Base79 => "base79",
        Alphabet::Base64 => "base64url",
        Alphabet::Emoji1k => "emoji-1k",
    }
}

/// A character that is a base79 digit and not a base64url one.
///
/// Derived from the two digit tables rather than listed, so widening either
/// table cannot leave the sniffer describing a stale pair.
fn base79_only(c: char) -> bool {
    if !c.is_ascii() {
        return false;
    }
    let b = c as u8;
    ALPHABET.contains(&b) && !ALPHABET64.contains(&b)
}

/// The alphabet a code identifies itself as, or `None` when it is
/// indistinguishable: base64url's charset is a strict subset of base79's, so
/// a code using only the shared characters could be either.
pub fn sniff(code: &str) -> Option<Alphabet> {
    if !code.is_ascii() {
        Some(Alphabet::Emoji1k)
    } else if code.chars().any(base79_only) {
        Some(Alphabet::Base79)
    } else {
        None
    }
}

/// The `#fragment` that carries `code`.
///
/// Bare means base64url. base79 self-marks through its extended charset; when
/// a base79 code happens to use only shared characters (or starts with '~',
/// which the fragment reader strips as a marker), it is prefixed with '~'.
/// emoji-1k needs no marker — every character of it is outside ASCII.
pub fn fragment_for(code: &str, alpha: Alphabet) -> String {
    if alpha == Alphabet::Base79 && (!code.chars().any(base79_only) || code.starts_with('~')) {
        format!("~{code}")
    } else {
        code.to_string()
    }
}

/// A parsed link or bare code.
#[derive(Debug, PartialEq, Eq)]
pub struct Parsed {
    /// The code with only the scaffolding the app itself added removed.
    pub code: String,
    /// The alphabet the input identifies, or `None` when ambiguous.
    pub alpha: Option<Alphabet>,
}

/// JavaScript's `decodeURIComponent`, which is what wrote the fragment.
///
/// Errors on a truncated escape, a non-hex digit, and — like the original —
/// on bytes that are not valid UTF-8 once decoded.
fn decode_uri_component(s: &str) -> Result<String, ()> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            if i + 3 > b.len() {
                return Err(());
            }
            let hi = (b[i + 1] as char).to_digit(16).ok_or(())?;
            let lo = (b[i + 2] as char).to_digit(16).ok_or(())?;
            out.push((hi * 16 + lo) as u8);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| ())
}

/// Accepts a full redirect link (`https://host/#<fragment>`), a link without
/// its scheme, or a bare code, and returns the code plus the alphabet the
/// input identifies.
///
/// The '~' marker is honoured ONLY after a '#', because that is the only place
/// `fragment_for` could have written it. A bare code keeps every character —
/// see this module's header for what stripping it would cost.
pub fn parse_link(input: &str) -> Result<Parsed, String> {
    // JS `String.prototype.trim()` also strips U+FEFF, and a link pasted out
    // of a document routinely carries one; `str::trim` does not, so a
    // byte-order mark would otherwise reach the sniffer as a code character
    // and change the alphabet it guesses.
    let trimmed = input.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
    let hash = trimmed.find('#');
    let mut code = match hash {
        Some(i) => decode_uri_component(&trimmed[i + 1..])
            .map_err(|()| "malformed link: bad percent-encoding".to_string())?,
        None => trimmed.to_string(),
    };
    let marked = hash.is_some() && code.starts_with('~');
    if marked {
        code = code[1..].to_string();
    }
    let alpha = if marked {
        Some(Alphabet::Base79)
    } else {
        sniff(&code)
    };
    Ok(Parsed { code, alpha })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base79_only_is_exactly_the_fifteen_extra_digits() {
        // In ASCII order, which is not the digit table's order.
        let extra: Vec<char> = (0u8..=127)
            .map(|b| b as char)
            .filter(|&c| base79_only(c))
            .collect();
        assert_eq!(extra.iter().collect::<String>(), "!$&'()*+,.:;=@~");
        assert_eq!(ALPHABET64.len() + extra.len(), ALPHABET.len());
    }

    /// The two invariants the '~' marker exists to preserve, over every base79
    /// digit as a leading character — the shape the goldens sample and this
    /// exhausts.
    #[test]
    fn every_base79_leading_digit_round_trips_as_fragment_and_bare() {
        for &d in ALPHABET.iter() {
            for tail in ["", "pDkLHLL", "aB.cD"] {
                let code = format!("{}{tail}", d as char);
                let link = format!("https://x/#{}", fragment_for(&code, Alphabet::Base79));
                assert_eq!(parse_link(&link).unwrap().code, code, "fragment {code:?}");
                assert_eq!(parse_link(&code).unwrap().code, code, "bare {code:?}");
            }
        }
    }
}
