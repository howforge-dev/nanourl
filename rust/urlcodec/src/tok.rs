//! Byte-level BPE matching nanourl's tokenizer exactly (HF tokenizers):
//!   pre-tokenizer = Split(regex, isolated) then ByteLevel(no prefix space, no regex)
//!   model         = BPE, rank-ordered merges, no byte fallback, no normalizer
//! The Split regex, in alternative order:  https?://  |  %[0-9A-Fa-f]{2}  |  one
//! of  ! # $ % & ' ( ) * + , - . / : ; = ? @ [ \ ] ^ _ ` { | } ~
//! Pieces are tokenized independently — a merge never crosses a piece boundary —
//! which is what makes the tokens line up with URL structure. Byte-exact
//! round-trip is a hard requirement: the codec is lossless or it is nothing.

use std::collections::HashMap;

const DELIMS: &[u8] = b"!#$%&'()*+,-./:;=?@[\\]^_`{|}~";

pub struct Tok {
    vocab: HashMap<String, u32>,
    id_to_tok: Vec<String>,
    ranks: HashMap<(String, String), usize>,
    byte_to_char: [char; 256],
    char_to_byte: HashMap<char, u8>,
    pub eos_id: u32,
}

fn byte_unicode_table() -> [char; 256] {
    // GPT-2's bytes_to_unicode: printable bytes map to themselves, the rest
    // to codepoints 256, 257, ... in ascending byte order.
    let mut table = ['\0'; 256];
    let mut n = 0u32;
    for b in 0u32..256 {
        let printable =
            (33..=126).contains(&b) || (161..=172).contains(&b) || (174..=255).contains(&b);
        table[b as usize] = if printable {
            char::from_u32(b).unwrap()
        } else {
            n += 1;
            char::from_u32(256 + n - 1).unwrap()
        };
    }
    table
}

/// Split into the pre-tokenizer's pieces (byte ranges). Mirrors the regex
/// alternatives in order at every position: scheme, %XX, single delimiter;
/// anything else accumulates into a "word" piece until the next match.
pub fn split(s: &[u8]) -> Vec<&[u8]> {
    let mut out = Vec::new();
    let mut i = 0;
    let mut word_start = 0;
    while i < s.len() {
        let m = if s[i..].starts_with(b"https://") {
            8
        } else if s[i..].starts_with(b"http://") {
            7
        } else if s[i] == b'%'
            && i + 2 < s.len()
            && s[i + 1].is_ascii_hexdigit()
            && s[i + 2].is_ascii_hexdigit()
        {
            3
        } else if DELIMS.contains(&s[i]) {
            1
        } else {
            0
        };
        if m == 0 {
            i += 1;
            continue;
        }
        if word_start < i {
            out.push(&s[word_start..i]);
        }
        out.push(&s[i..i + m]);
        i += m;
        word_start = i;
    }
    if word_start < s.len() {
        out.push(&s[word_start..]);
    }
    out
}

impl Tok {
    pub fn load_str(text: &str) -> Result<Tok, String> {
        let j: serde_json::Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
        let model = &j["model"];
        let vocab_obj = model["vocab"]
            .as_object()
            .ok_or("tokenizer.json: model.vocab missing")?;
        let mut vocab = HashMap::with_capacity(vocab_obj.len());
        let mut id_to_tok = vec![String::new(); vocab_obj.len()];
        for (tok, id) in vocab_obj {
            let id = id.as_u64().ok_or("bad vocab id")? as u32;
            vocab.insert(tok.clone(), id);
            if (id as usize) < id_to_tok.len() {
                id_to_tok[id as usize] = tok.clone();
            }
        }
        let merges = model["merges"].as_array().ok_or("model.merges missing")?;
        let mut ranks = HashMap::with_capacity(merges.len());
        for (rank, m) in merges.iter().enumerate() {
            let (a, b) = if let Some(s) = m.as_str() {
                let mut it = s.splitn(2, ' ');
                (
                    it.next().ok_or("bad merge")?.to_string(),
                    it.next().ok_or("bad merge")?.to_string(),
                )
            } else if let Some(arr) = m.as_array() {
                (
                    arr[0].as_str().ok_or("bad merge")?.to_string(),
                    arr[1].as_str().ok_or("bad merge")?.to_string(),
                )
            } else {
                return Err("unrecognized merge entry".into());
            };
            ranks.insert((a, b), rank);
        }
        let byte_to_char = byte_unicode_table();
        let char_to_byte = byte_to_char
            .iter()
            .enumerate()
            .map(|(b, &c)| (c, b as u8))
            .collect();
        let eos_id = *vocab.get("<eos>").ok_or("<eos> not in vocab")?;
        Ok(Tok {
            vocab,
            id_to_tok,
            ranks,
            byte_to_char,
            char_to_byte,
            eos_id,
        })
    }

    pub fn vocab_size(&self) -> usize {
        self.id_to_tok.len()
    }

    /// HF BPE on one piece: repeatedly merge every occurrence of the best-ranked pair.
    fn bpe_piece(&self, piece: &[u8], out: &mut Vec<u32>) -> Result<(), String> {
        let mut word: Vec<String> = piece
            .iter()
            .map(|&b| self.byte_to_char[b as usize].to_string())
            .collect();
        loop {
            let mut best: Option<(usize, usize)> = None; // (rank, index)
            for i in 0..word.len().saturating_sub(1) {
                if let Some(&r) = self.ranks.get(&(word[i].clone(), word[i + 1].clone())) {
                    if best.map_or(true, |(br, _)| r < br) {
                        best = Some((r, i));
                    }
                }
            }
            let Some((_, i0)) = best else { break };
            let (pa, pb) = (word[i0].clone(), word[i0 + 1].clone());
            let merged = format!("{pa}{pb}");
            let mut next = Vec::with_capacity(word.len());
            let mut i = 0;
            while i < word.len() {
                if i + 1 < word.len() && word[i] == pa && word[i + 1] == pb {
                    next.push(merged.clone());
                    i += 2;
                } else {
                    next.push(word[i].clone());
                    i += 1;
                }
            }
            word = next;
        }
        for t in &word {
            out.push(
                *self
                    .vocab
                    .get(t)
                    .ok_or_else(|| format!("token {t:?} not in vocab"))?,
            );
        }
        Ok(())
    }

    /// Tokenize CANONICAL text (call canonical() first). No <eos>.
    pub fn encode(&self, text: &str) -> Result<Vec<u32>, String> {
        let mut out = Vec::new();
        for piece in split(text.as_bytes()) {
            self.bpe_piece(piece, &mut out)?;
        }
        Ok(out)
    }

    fn bytes_of(&self, id: u32) -> Result<Vec<u8>, String> {
        let tok = self
            .id_to_tok
            .get(id as usize)
            .ok_or_else(|| format!("id {id} out of range"))?;
        tok.chars()
            .map(|ch| {
                self.char_to_byte
                    .get(&ch)
                    .copied()
                    .ok_or_else(|| format!("unmapped char {ch:?}"))
            })
            .collect()
    }

    /// Decode to CANONICAL text (call canonical() on the result).
    pub fn decode(&self, ids: &[u32]) -> Result<String, String> {
        let mut bytes = Vec::new();
        for &id in ids {
            bytes.extend(self.bytes_of(id)?);
        }
        String::from_utf8(bytes).map_err(|e| e.to_string())
    }

    /// Display text for one token (may be a partial UTF-8 sequence → lossy).
    pub fn piece(&self, id: u32) -> String {
        if id == self.eos_id {
            return "<eos>".into();
        }
        self.bytes_of(id)
            .map(|b| String::from_utf8_lossy(&b).into_owned())
            .unwrap_or_default()
    }
}
