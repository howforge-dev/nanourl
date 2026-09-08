//! Alphabet sniffing, code marking and link parsing — the rules the web app
//! states in `web/src/lib/alphabet.ts`, so that `nanourl decode` accepts
//! exactly what the site's Decode pane accepts.
//!
//! This is a second implementation of a format, which is a thing that drifts,
//! so `tests/link_test.rs` replays `tests/goldens/link.jsonl`, which the
//! TypeScript generates and its own tests keep fresh: neither side can move
//! without breaking a gate.
//!
//! The markers are digit 0 of their tables (`~` for base79, `/` for
//! qr-alpha). The codec never writes a leading zero, so a marker in front of
//! a code is a leading zero the decoder ignores: nothing is ever stripped.

use urlcodec::coder::{Alphabet, ALPHABET, ALPHABET64, ALPHABET_QR};

/// The alphabet a code falls back to when sniffing cannot tell base79 from
/// base64url — base64url, the charset every link is minted in.
pub const DEFAULT_ALPHABET: Alphabet = Alphabet::Base64;

/// base79's digit 0, written in front of a base79 code that could pass as
/// base64url or as qr-alpha.
pub const B79_MARK: char = '~';

/// qr-alpha's digit 0, written in front of a qr-alpha code that could pass
/// as base64url.
pub const QR_MARK: char = '/';

/// The name each alphabet answers to on the command line and in `--json`,
/// spelled as `web/src/lib/alphabet.ts`'s `ALPHABETS` spells it.
pub fn alphabet_key(a: Alphabet) -> &'static str {
    match a {
        Alphabet::Base79 => "base79",
        Alphabet::Base64 => "base64url",
        Alphabet::Emoji1k => "emoji-1k",
        Alphabet::QrAlpha => "qr-alpha",
    }
}

/// What `--help` says about each alphabet: the picker's blurb, word for
/// word, pinned to `ALPHABETS` through `tests/goldens/cli.json`.
pub fn alphabet_blurb(a: Alphabet) -> &'static str {
    match a {
        Alphabet::Base64 => "conservative base64url charset (default)",
        Alphabet::Base79 => {
            "RFC 3986 path-segment charset, ~5% shorter — but its digits include punctuation \
             () , ; ! ' .) that chat apps and Markdown trim from the end of a link, so a pasted \
             link can lose its last character"
        }
        Alphabet::Emoji1k => "1024 emoji, 10 bits per glyph — ~37% fewer characters",
        Alphabet::QrAlpha => "QR alphanumeric charset (uppercase), for QR codes",
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

/// A qr-alpha digit that is neither a base64url one nor the marker:
/// `$ * + . :`. One of them in a code of the qr-alpha shape is what makes
/// the code self-identifying.
fn qr_only(c: char) -> bool {
    if !c.is_ascii() || c == QR_MARK {
        return false;
    }
    let b = c as u8;
    ALPHABET_QR.contains(&b) && !ALPHABET64.contains(&b)
}

/// Every character a qr-alpha digit — the shape a qr-alpha code has, and the
/// shape ~1 in 3,000 base79 codes of a typical length (~13 characters; more
/// often for shorter ones) happen to have too, since every qr-alpha digit
/// but `/` is a base79 digit.
fn qr_shape(code: &str) -> bool {
    !code.is_empty() && code.bytes().all(|b| ALPHABET_QR.contains(&b))
}

/// The alphabet a code identifies itself as, or `None` when it is
/// indistinguishable: base64url's charset is a strict subset of base79's, so
/// a code using only the shared characters could be either.
///
/// Non-ASCII is emoji-1k. A '/' anywhere is qr-alpha, since no other table
/// has it; so is an unmarked qr-alpha code, all qr-alpha digits with one
/// base64url lacks. Then a base79-only character (the marker among them)
/// means base79. base64url is untouched by every branch: its codes never
/// contain a marker, a non-ASCII character or a [`qr_only`] digit.
pub fn sniff(code: &str) -> Option<Alphabet> {
    if !code.is_ascii() {
        Some(Alphabet::Emoji1k)
    } else if code.contains(QR_MARK) || (qr_shape(code) && code.chars().any(qr_only)) {
        Some(Alphabet::QrAlpha)
    } else if code.chars().any(base79_only) {
        Some(Alphabet::Base79)
    } else {
        None
    }
}

/// A code as it is written down, bare or after the '#': behind its
/// alphabet's marker when nothing in it says which alphabet it is, otherwise
/// as the codec emitted it. base79 marks when it has no base79-only
/// character or has the shape of a qr-alpha code; qr-alpha marks when it
/// could pass as base64url; base64url and emoji-1k never mark. A code that
/// already carries its marker as a digit is never marked again.
pub fn bare_for(code: &str, alpha: Alphabet) -> String {
    match alpha {
        Alphabet::Base79 if !code.chars().any(base79_only) || qr_shape(code) => {
            format!("{B79_MARK}{code}")
        }
        Alphabet::QrAlpha if !code.contains(QR_MARK) && !code.chars().any(qr_only) => {
            format!("{QR_MARK}{code}")
        }
        _ => code.to_string(),
    }
}

/// The `#fragment` that carries `code`: its bare spelling, since a marker is
/// a digit and reads the same in either place.
pub fn fragment_for(code: &str, alpha: Alphabet) -> String {
    bare_for(code, alpha)
}

/// A parsed link or bare code.
#[derive(Debug, PartialEq, Eq)]
pub struct Parsed {
    /// The code as written — a marker is a digit, so nothing is removed.
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
/// its scheme, or a bare code, and returns the code as written plus the
/// alphabet the input identifies.
pub fn parse_link(input: &str) -> Result<Parsed, String> {
    // JS `String.prototype.trim()` also strips U+FEFF, and a link pasted out
    // of a document routinely carries one; `str::trim` does not, so a
    // byte-order mark would otherwise reach the sniffer as a code character
    // and change the alphabet it guesses.
    let trimmed = input.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
    let code = match trimmed.find('#') {
        Some(i) => decode_uri_component(&trimmed[i + 1..])
            .map_err(|()| "malformed link: bad percent-encoding".to_string())?,
        None => trimmed.to_string(),
    };
    let alpha = sniff(&code);
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

    #[test]
    fn qr_only_is_exactly_the_five_digits_base64url_lacks() {
        let extra: String = (0u8..=127)
            .map(|b| b as char)
            .filter(|&c| qr_only(c))
            .collect();
        assert_eq!(extra, "$*+.:");
        assert!(extra.chars().all(base79_only));
    }

    /// Each marker is digit 0 of its own table and a digit of no other: that
    /// is what lets it be written in front of a code and never stripped.
    #[test]
    fn the_markers_are_digit_zero_of_their_own_table_only() {
        assert_eq!(ALPHABET[0] as char, B79_MARK);
        assert_eq!(ALPHABET_QR[0] as char, QR_MARK);
        assert!(!ALPHABET64.contains(&(B79_MARK as u8)));
        assert!(!ALPHABET_QR.contains(&(B79_MARK as u8)));
        assert!(!ALPHABET64.contains(&(QR_MARK as u8)));
        assert!(!ALPHABET.contains(&(QR_MARK as u8)));
    }

    /// xorshift64*, so the sampled codes are the same on every run.
    fn rng(state: &mut u64) -> u64 {
        *state ^= *state >> 12;
        *state ^= *state << 25;
        *state ^= *state >> 27;
        state.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }

    /// Random codes over `digits`, never starting with digit 0: the codec
    /// writes no leading zero.
    fn sample(digits: &[u8], n: usize, seed: u64) -> Vec<String> {
        let mut state = seed;
        (0..n)
            .map(|_| {
                let len = 1 + (rng(&mut state) % 16) as usize;
                (0..len)
                    .map(|k| {
                        let lo = usize::from(k == 0);
                        digits[lo + (rng(&mut state) % (digits.len() - lo) as u64) as usize] as char
                    })
                    .collect()
            })
            .collect()
    }

    /// Every digit as a leading character in a few shapes, a large random
    /// sample, and the hand-built worst cases: all-uppercase base64url codes,
    /// base79 codes of the qr-alpha shape with and without `$*+.:`, qr-alpha
    /// codes with only `0-9A-Z-` and with only `$*+.:`, and codes carrying a
    /// marker.
    fn codes_for(alpha: Alphabet) -> Vec<String> {
        let (table, tails, seed): (&[u8], &[&str], u64) = match alpha {
            Alphabet::Base79 => (
                ALPHABET,
                &["", "pDkLHLL", "aB.cD", "AB$C", "ABC"],
                0x243f_6a88_85a3_08d3,
            ),
            Alphabet::Base64 => (ALPHABET64, &["", "pDkLHLL", "ABC"], 0x1319_8a2e_0370_7344),
            Alphabet::QrAlpha => (
                ALPHABET_QR,
                &["", "PDKLHLL", "A.B", "ABC", "/Z"],
                0xa409_3822_299f_31d0,
            ),
            Alphabet::Emoji1k => return vec!["😀".into(), "😀🍕".into(), "🀄🃏🆎".into()],
        };
        let mut out: Vec<String> = table
            .iter()
            .skip(usize::from(alpha != Alphabet::Base64))
            .flat_map(|&d| tails.iter().map(move |t| format!("{}{t}", d as char)))
            .collect();
        out.extend(sample(table, 3000, seed));
        if alpha == Alphabet::Base79 {
            out.extend(sample(&ALPHABET_QR[1..], 500, 0x082e_fa98_ec4e_6c89));
            out.extend(["tilde~inside", "x~"].map(String::from));
        }
        out.extend(
            [
                "ABC",
                "AB-C",
                "0123456789",
                "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
                "AB$C",
                "A$B*C+D-E.F:G",
                "$*+.:",
                "AB/C",
            ]
            .iter()
            .filter(|c| c.bytes().all(|b| table.contains(&b)))
            .map(|c| c.to_string()),
        );
        out
    }

    fn marker(alpha: Alphabet) -> Option<char> {
        match alpha {
            Alphabet::Base79 => Some(B79_MARK),
            Alphabet::QrAlpha => Some(QR_MARK),
            _ => None,
        }
    }

    /// The spelling is the code or one marker digit then the code, never two
    /// markers; and it comes back as itself with its alphabet, in a fragment
    /// and bare alike (null for base64url, which never marks).
    #[test]
    fn every_alphabet_round_trips_as_fragment_and_bare() {
        for alpha in Alphabet::ALL {
            let want = if alpha == Alphabet::Base64 {
                None
            } else {
                Some(alpha)
            };
            for code in codes_for(alpha) {
                let spelled = bare_for(&code, alpha);
                if spelled != code {
                    let m = marker(alpha).expect("only marking alphabets mark");
                    assert_eq!(spelled, format!("{m}{code}"), "spelling of {code:?}");
                    assert!(!code.starts_with(m), "{code:?} marked twice");
                }
                assert_eq!(fragment_for(&code, alpha), spelled);

                let link = format!("https://x/#{spelled}");
                let p = parse_link(&link).unwrap();
                assert_eq!(
                    (p.code, p.alpha),
                    (spelled.clone(), want),
                    "fragment {code:?}"
                );
                let b = parse_link(&spelled).unwrap();
                assert_eq!((b.code, b.alpha), (spelled, want), "bare {code:?}");
            }
        }
    }

    /// A qr-alpha code is marked exactly when it could pass as base64url.
    #[test]
    fn qr_alpha_marks_exactly_the_base64url_lookalikes() {
        for code in codes_for(Alphabet::QrAlpha) {
            let lookalike = code.bytes().all(|b| ALPHABET64.contains(&b));
            let want = if lookalike {
                format!("/{code}")
            } else {
                code.clone()
            };
            assert_eq!(bare_for(&code, Alphabet::QrAlpha), want);
        }
    }
}
