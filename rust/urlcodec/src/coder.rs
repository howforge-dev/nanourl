//! Integer arithmetic coder + base-79 framing: a faithful port of codec.py.
//!
//! Determinism contract: encode and decode run the SAME quantize() over the
//! SAME probabilities (both sides step the model identically), so the only
//! requirement is self-consistency within this implementation — fixed
//! operation order everywhere, no platform-varying reductions.

pub const PROB_BITS: u32 = 24;
pub const TOTAL: u64 = 1 << PROB_BITS;
const HALF: u64 = 1 << 63;
const QUARTER: u64 = 1 << 62;

pub struct Encoder {
    low: u64,
    high: u64,
    pending: u32,
    pub bits: Vec<u8>,
}

impl Encoder {
    pub fn new() -> Self {
        Encoder {
            low: 0,
            high: u64::MAX,
            pending: 0,
            bits: Vec::new(),
        }
    }

    /// bits carried but not yet writable (the coder's E3 straddle counter) —
    /// exposed so the observatory can label them honestly
    pub fn pending(&self) -> u32 {
        self.pending
    }

    fn emit(&mut self, b: u8) {
        self.bits.push(b);
        for _ in 0..self.pending {
            self.bits.push(b ^ 1);
        }
        self.pending = 0;
    }

    pub fn encode(&mut self, cum_lo: u64, cum_hi: u64) {
        let span = (self.high - self.low) as u128 + 1;
        self.high = self.low + (span * cum_hi as u128 / TOTAL as u128 - 1) as u64;
        self.low = self.low + (span * cum_lo as u128 / TOTAL as u128) as u64;
        loop {
            if self.high < HALF {
                self.emit(0);
            } else if self.low >= HALF {
                self.emit(1);
                self.low -= HALF;
                self.high -= HALF;
            } else if self.low >= QUARTER && self.high < 3 * QUARTER {
                self.pending += 1;
                self.low -= QUARTER;
                self.high -= QUARTER;
            } else {
                break;
            }
            self.low <<= 1;
            self.high = (self.high << 1) | 1;
        }
    }

    pub fn finish(mut self) -> Vec<u8> {
        self.pending += 1;
        let b = if self.low < QUARTER { 0 } else { 1 };
        self.emit(b);
        self.bits
    }
}

pub struct Decoder<'a> {
    bits: &'a [u8],
    pos: usize,
    low: u64,
    high: u64,
    value: u64,
}

impl<'a> Decoder<'a> {
    pub fn new(bits: &'a [u8]) -> Self {
        let mut d = Decoder {
            bits,
            pos: 0,
            low: 0,
            high: u64::MAX,
            value: 0,
        };
        for _ in 0..64 {
            d.value = (d.value << 1) | d.read() as u64;
        }
        d
    }

    fn read(&mut self) -> u8 {
        let b = if self.pos < self.bits.len() {
            self.bits[self.pos]
        } else {
            0
        };
        self.pos += 1;
        b
    }

    pub fn scaled(&self) -> u64 {
        let span = (self.high - self.low) as u128 + 1;
        ((((self.value - self.low) as u128 + 1) * TOTAL as u128 - 1) / span) as u64
    }

    pub fn update(&mut self, cum_lo: u64, cum_hi: u64) {
        let span = (self.high - self.low) as u128 + 1;
        self.high = self.low + (span * cum_hi as u128 / TOTAL as u128 - 1) as u64;
        self.low = self.low + (span * cum_lo as u128 / TOTAL as u128) as u64;
        loop {
            if self.high < HALF {
                // nothing
            } else if self.low >= HALF {
                self.low -= HALF;
                self.high -= HALF;
                self.value -= HALF;
            } else if self.low >= QUARTER && self.high < 3 * QUARTER {
                self.low -= QUARTER;
                self.high -= QUARTER;
                self.value -= QUARTER;
            } else {
                break;
            }
            self.low <<= 1;
            self.high = (self.high << 1) | 1;
            self.value = (self.value << 1) | self.read() as u64;
        }
    }
}

/// f64 probabilities -> cumulative integer frequencies (len V+1, sum TOTAL).
/// Floor of 1 per token, remainder to the (first) argmax — codec.py semantics.
pub fn quantize(probs: &[f64]) -> Vec<u64> {
    let v = probs.len();
    let mut sum = 0f64;
    for &p in probs {
        sum += p;
    }
    let scale = (TOTAL - v as u64) as f64;
    let mut freqs: Vec<i64> = Vec::with_capacity(v);
    let mut fsum: i64 = 0;
    let mut argmax = 0usize;
    let mut pmax = f64::MIN;
    for (i, &p) in probs.iter().enumerate() {
        let pn = p / sum;
        if pn > pmax {
            pmax = pn;
            argmax = i;
        }
        let f = (pn * scale) as i64 + 1;
        fsum += f;
        freqs.push(f);
    }
    freqs[argmax] += TOTAL as i64 - fsum;
    debug_assert!(freqs.iter().all(|&f| f >= 1));
    let mut cum = Vec::with_capacity(v + 1);
    let mut c = 0u64;
    cum.push(0);
    for f in freqs {
        c += f as u64;
        cum.push(c);
    }
    cum
}

// ---------------------------------------------------------------------------
// base-N framing: the bit stream is one big number written in the chosen
// alphabet, which is therefore the digit table — freeze it or every code ever
// emitted decodes to garbage. base-79 is the RFC 3986 path-segment charset
// (matches codec.py).

pub const ALPHABET: &[u8; 79] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~!$&'()*+,;=:@";
pub const ALPHABET64: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// emoji-1k: 1024 single-code-point emoji, exactly 10 bits per glyph. ~37% fewer visible
/// characters than base79 buys in exchange for 4 UTF-8 bytes per glyph instead
/// of 1. Derived — and re-derivable — by tools/gen_emoji_alphabet.py, which
/// documents why each filter is there; the short version is that no two of
/// these can fuse into one grapheme and none of them changes under NFKC, so a
/// code survives being pasted around.
pub const ALPHABET_EMOJI_1K: &str = concat!(
    "⌚⌛⏩⏪⏫⏬⏰⏳◽◾☔☕♈♉♊♋♌♍♎♏♐♑♒♓♿⚓⚡⚪⚫⚽⚾⛄",
    "⛅⛎⛔⛪⛲⛳⛵⛺⛽✅✊✋✨❌❎❓❔❕❗➕➖➗➰➿⬛⬜⭐⭕🀄🃏🆎🆑",
    "🆒🆓🆔🆕🆖🆗🆘🆙🆚🌀🌁🌂🌃🌄🌅🌆🌇🌈🌉🌊🌋🌌🌍🌎🌏🌐🌑🌒🌓🌔🌕🌖",
    "🌗🌘🌙🌚🌛🌜🌝🌞🌟🌠🌭🌮🌯🌰🌱🌲🌳🌴🌵🌷🌸🌹🌺🌻🌼🌽🌾🌿🍀🍁🍂🍃",
    "🍄🍅🍆🍇🍈🍉🍊🍋🍌🍍🍎🍏🍐🍑🍒🍓🍔🍕🍖🍗🍘🍙🍚🍛🍜🍝🍞🍟🍠🍡🍢🍣",
    "🍤🍥🍦🍧🍨🍩🍪🍫🍬🍭🍮🍯🍰🍱🍲🍳🍴🍵🍶🍷🍸🍹🍺🍻🍼🍾🍿🎀🎁🎂🎃🎄",
    "🎅🎆🎇🎈🎉🎊🎋🎌🎍🎎🎏🎐🎑🎒🎓🎠🎡🎢🎣🎤🎥🎦🎧🎨🎩🎪🎫🎬🎭🎮🎯🎰",
    "🎱🎲🎳🎴🎵🎶🎷🎸🎹🎺🎻🎼🎽🎾🎿🏀🏁🏂🏃🏄🏅🏆🏇🏈🏉🏊🏏🏐🏑🏒🏓🏠",
    "🏡🏢🏣🏤🏥🏦🏧🏨🏩🏪🏫🏬🏭🏮🏯🏰🏴🏸🏹🏺🐀🐁🐂🐃🐄🐅🐆🐇🐈🐉🐊🐋",
    "🐌🐍🐎🐏🐐🐑🐒🐓🐔🐕🐖🐗🐘🐙🐚🐛🐜🐝🐞🐟🐠🐡🐢🐣🐤🐥🐦🐧🐨🐩🐪🐫",
    "🐬🐭🐮🐯🐰🐱🐲🐳🐴🐵🐶🐷🐸🐹🐺🐻🐼🐽🐾👀👂👃👄👅👆👇👈👉👊👋👌👍",
    "👎👏👐👑👒👓👔👕👖👗👘👙👚👛👜👝👞👟👠👡👢👣👤👥👦👧👨👩👪👫👬👭",
    "👮👯👰👱👲👳👴👵👶👷👸👹👺👻👼👽👾👿💀💁💂💃💄💅💆💇💈💉💊💋💌💍",
    "💎💏💐💑💒💓💔💕💖💗💘💙💚💛💜💝💞💟💠💡💢💣💤💥💦💧💨💩💪💫💬💭",
    "💮💯💰💱💲💳💴💵💶💷💸💹💺💻💼💽💾💿📀📁📂📃📄📅📆📇📈📉📊📋📌📍",
    "📎📏📐📑📒📓📔📕📖📗📘📙📚📛📜📝📞📟📠📡📢📣📤📥📦📧📨📩📪📫📬📭",
    "📮📯📰📱📲📳📴📵📶📷📸📹📺📻📼📿🔀🔁🔂🔃🔄🔅🔆🔇🔈🔉🔊🔋🔌🔍🔎🔏",
    "🔐🔑🔒🔓🔔🔕🔖🔗🔘🔙🔚🔛🔜🔝🔞🔟🔠🔡🔢🔣🔤🔥🔦🔧🔨🔩🔪🔫🔬🔭🔮🔯",
    "🔰🔱🔲🔳🔴🔵🔶🔷🔸🔹🔺🔻🔼🔽🕋🕌🕍🕎🕐🕑🕒🕓🕔🕕🕖🕗🕘🕙🕚🕛🕜🕝",
    "🕞🕟🕠🕡🕢🕣🕤🕥🕦🕧🕺🖕🖖🖤🗻🗼🗽🗾🗿😀😁😂😃😄😅😆😇😈😉😊😋😌",
    "😍😎😏😐😑😒😓😔😕😖😗😘😙😚😛😜😝😞😟😠😡😢😣😤😥😦😧😨😩😪😫😬",
    "😭😮😯😰😱😲😳😴😵😶😷😸😹😺😻😼😽😾😿🙀🙁🙂🙃🙄🙅🙆🙇🙈🙉🙊🙋🙌",
    "🙍🙎🙏🚀🚁🚂🚃🚄🚅🚆🚇🚈🚉🚊🚋🚌🚍🚎🚏🚐🚑🚒🚓🚔🚕🚖🚗🚘🚙🚚🚛🚜",
    "🚝🚞🚟🚠🚡🚢🚣🚤🚥🚦🚧🚨🚩🚪🚫🚬🚭🚮🚯🚰🚱🚲🚳🚴🚵🚶🚷🚸🚹🚺🚻🚼",
    "🚽🚾🚿🛀🛁🛂🛃🛄🛅🛌🛐🛑🛒🛕🛫🛬🛴🛵🛶🛷🛸🛹🛺🟠🟡🟢🟣🟤🟥🟦🟧🟨",
    "🟩🟪🟫🤍🤎🤏🤐🤑🤒🤓🤔🤕🤖🤗🤘🤙🤚🤛🤜🤝🤞🤟🤠🤡🤢🤣🤤🤥🤦🤧🤨🤩",
    "🤪🤫🤬🤭🤮🤯🤰🤱🤲🤳🤴🤵🤶🤷🤸🤹🤺🤼🤽🤾🤿🥀🥁🥂🥃🥄🥅🥇🥈🥉🥊🥋",
    "🥌🥍🥎🥏🥐🥑🥒🥓🥔🥕🥖🥗🥘🥙🥚🥛🥜🥝🥞🥟🥠🥡🥢🥣🥤🥥🥦🥧🥨🥩🥪🥫",
    "🥬🥭🥮🥯🥰🥱🥳🥴🥵🥶🥺🥻🥼🥽🥾🥿🦀🦁🦂🦃🦄🦅🦆🦇🦈🦉🦊🦋🦌🦍🦎🦏",
    "🦐🦑🦒🦓🦔🦕🦖🦗🦘🦙🦚🦛🦜🦝🦞🦟🦠🦡🦢🦥🦦🦧🦨🦩🦪🦮🦯🦴🦵🦶🦷🦸",
    "🦹🦺🦻🦼🦽🦾🦿🧀🧁🧂🧃🧄🧅🧆🧇🧈🧐🧑🧒🧓🧔🧕🧖🧗🧘🧙🧚🧛🧜🧝🧞🧟",
    "🧠🧡🧢🧣🧤🧥🧦🧧🧨🧩🧪🧫🧬🧭🧮🧯🧰🧱🧲🧳🧴🧵🧶🧷🧸🧹🧺🧻🧼🧽🧾🧿",
);

/// base64url is a strict SUBSET of the base79 charset, so choosing between
/// those two is out-of-band (deployment/UI), never auto-detected from the
/// string. emoji-1k shares no character with either, so it does self-identify.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Alphabet {
    Base79,
    Base64,
    Emoji1k,
}

impl Alphabet {
    /// Wire values for the wasm C ABI, where 0/1 were the original
    /// base79/base64url flag — old callers keep their meaning.
    pub fn from_i32(v: i32) -> Self {
        match v {
            1 => Alphabet::Base64,
            2 => Alphabet::Emoji1k,
            _ => Alphabet::Base79,
        }
    }

    /// The wire value [`Alphabet::from_i32`] reads back. Beside it, because a
    /// map and its inverse disagreeing is a wrong decode with no error; the
    /// unit test below closes the loop over every variant.
    pub fn id(self) -> i32 {
        match self {
            Alphabet::Base79 => 0,
            Alphabet::Base64 => 1,
            Alphabet::Emoji1k => 2,
        }
    }

    /// Digit table, materialized per call: a linear scan over 1024 chars per
    /// coded character is thousands of comparisons against a 145M-parameter
    /// forward pass, so there is nothing here worth indexing.
    fn digits(self) -> Vec<char> {
        match self {
            Alphabet::Base79 => ALPHABET.iter().map(|&b| b as char).collect(),
            Alphabet::Base64 => ALPHABET64.iter().map(|&b| b as char).collect(),
            Alphabet::Emoji1k => ALPHABET_EMOJI_1K.chars().collect(),
        }
    }
}

struct Big(Vec<u32>); // little-endian base-2^32 limbs

impl Big {
    fn zero() -> Self {
        Big(Vec::new())
    }
    fn is_zero(&self) -> bool {
        self.0.iter().all(|&l| l == 0)
    }
    fn mul_add(&mut self, m: u32, a: u32) {
        let mut carry = a as u64;
        for limb in self.0.iter_mut() {
            let x = *limb as u64 * m as u64 + carry;
            *limb = x as u32;
            carry = x >> 32;
        }
        while carry > 0 {
            self.0.push(carry as u32);
            carry >>= 32;
        }
    }
    fn divmod(&mut self, d: u32) -> u32 {
        let mut rem = 0u64;
        for limb in self.0.iter_mut().rev() {
            let x = (rem << 32) | *limb as u64;
            *limb = (x / d as u64) as u32;
            rem = x % d as u64;
        }
        while self.0.last() == Some(&0) {
            self.0.pop();
        }
        rem as u32
    }
}

/// Stream-version registry: id 0 = the FIRST shipped model — all three
/// cheap 2-bit slots belong to real releases, none to dev (pre-release
/// streams are throwaway and become invalid when id 0 freezes). Ids are
/// permanent once a stream escapes a session.
/// Header cost: ids 0-2 -> 2 bits, 3-65 -> 8 bits, 66-320 -> 16 bits.
pub const STREAM_VERSION: u32 = 0;

/// Whether `version` has a header encoding at all — the CLI validates
/// `--stream-version` with this so an out-of-range value is a message rather
/// than `bits_to_string_in`'s `.unwrap()`.
pub fn version_supported(version: u32) -> bool {
    version_header(version).is_ok()
}

fn version_header(version: u32) -> Result<Vec<u8>, String> {
    let mut h = Vec::new();
    match version {
        0..=2 => {
            h.push((version >> 1) as u8 & 1);
            h.push(version as u8 & 1);
        }
        3..=65 => {
            let e = version - 3;
            h.extend_from_slice(&[1, 1]);
            for k in (0..6).rev() {
                h.push((e >> k) as u8 & 1);
            }
        }
        66..=320 => {
            let f = version - 66;
            h.extend_from_slice(&[1, 1, 1, 1, 1, 1, 1, 1]);
            for k in (0..8).rev() {
                h.push((f >> k) as u8 & 1);
            }
        }
        _ => return Err(format!("stream version {version} out of range")),
    }
    Ok(h)
}

pub fn bits_to_string(bits: &[u8], version: u32) -> String {
    bits_to_string_in(bits, version, Alphabet::Base79)
}

pub fn bits_to_string_in(bits: &[u8], version: u32, alpha: Alphabet) -> String {
    let alpha = alpha.digits();
    let base = alpha.len() as u32;
    let mut n = Big::zero();
    n.mul_add(1, 1); // sentinel bit: preserves leading zeros
    for &b in version_header(version).unwrap().iter().chain(bits.iter()) {
        n.mul_add(2, b as u32);
    }
    let mut out = Vec::new();
    while !n.is_zero() {
        out.push(alpha[n.divmod(base) as usize]);
    }
    out.iter().rev().collect()
}

/// -> (stream_version, payload_bits)
pub fn string_to_bits(s: &str) -> Result<(u32, Vec<u8>), String> {
    string_to_bits_in(s, Alphabet::Base79)
}

pub fn string_to_bits_in(s: &str, alpha: Alphabet) -> Result<(u32, Vec<u8>), String> {
    let alpha = alpha.digits();
    let base = alpha.len() as u32;
    let mut n = Big::zero();
    for ch in s.chars() {
        let idx = alpha
            .iter()
            .position(|&a| a == ch)
            .ok_or_else(|| format!("invalid coded character {ch:?}"))?;
        n.mul_add(base, idx as u32);
    }
    if n.is_zero() {
        return Err("empty or invalid coded string".into());
    }
    let mut rev = Vec::new();
    while !n.is_zero() {
        rev.push(n.divmod(2) as u8);
    }
    rev.pop(); // drop the sentinel (most significant bit)
    rev.reverse();
    let bits = rev;
    if bits.len() < 2 {
        return Err("truncated stream header".into());
    }
    let v = (bits[0] as u32) * 2 + bits[1] as u32;
    if v < 3 {
        return Ok((v, bits[2..].to_vec()));
    }
    if bits.len() < 8 {
        return Err("truncated stream header".into());
    }
    let e = bits[2..8].iter().fold(0u32, |a, &b| a * 2 + b as u32);
    if e < 63 {
        return Ok((3 + e, bits[8..].to_vec()));
    }
    if bits.len() < 16 {
        return Err("truncated stream header".into());
    }
    let f = bits[8..16].iter().fold(0u32, |a, &b| a * 2 + b as u32);
    if f == 255 {
        return Err("stream from a future format tier".into());
    }
    Ok((66 + f, bits[16..].to_vec()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `id` and `from_i32` are a bijection over the three variants and over
    /// their three wire values. A gap either way is a silent wrong decode: the
    /// coder would charge bits against a different digit table than the one
    /// the caller asked for, and still return a plausible string.
    #[test]
    fn the_alphabet_wire_values_round_trip_both_ways() {
        for a in [Alphabet::Base79, Alphabet::Base64, Alphabet::Emoji1k] {
            assert_eq!(Alphabet::from_i32(a.id()), a);
        }
        for id in 0..3 {
            assert_eq!(Alphabet::from_i32(id).id(), id);
        }
    }

    /// xorshift64*, so the case list is reproducible without a dev-dependency.
    fn rng(state: &mut u64) -> u64 {
        *state ^= *state >> 12;
        *state ^= *state << 25;
        *state ^= *state >> 27;
        state.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }

    /// The alphabet is the digit table of the base conversion, so a duplicate
    /// or a miscount silently changes the meaning of every code.
    #[test]
    fn emoji_1k_alphabet_is_1024_distinct_single_code_points() {
        let chars: Vec<char> = ALPHABET_EMOJI_1K.chars().collect();
        assert_eq!(chars.len(), 1024);
        let mut sorted = chars.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), 1024, "alphabet has duplicates");
        // no overlap with the ASCII alphabets: a code identifies its own base
        assert!(chars.iter().all(|c| !c.is_ascii()));
    }

    #[test]
    fn framing_round_trips_every_alphabet() {
        for alpha in [Alphabet::Base79, Alphabet::Base64, Alphabet::Emoji1k] {
            let mut state = 0x243f_6a88_85a3_08d3u64;
            for len in 0..200 {
                let bits: Vec<u8> = (0..len).map(|_| (rng(&mut state) & 1) as u8).collect();
                for version in [0, 1, 2, 3, 42, 65, 66, 200, 320] {
                    let s = bits_to_string_in(&bits, version, alpha);
                    let (v, back) = string_to_bits_in(&s, alpha).expect("decode");
                    assert_eq!(
                        (v, &back),
                        (version, &bits),
                        "{alpha:?} v{version} len {len}"
                    );
                }
            }
        }
    }

    /// Leading zero bits are what the sentinel exists for; they are also what a
    /// base change is most likely to break.
    #[test]
    fn framing_preserves_leading_zeros() {
        for alpha in [Alphabet::Base79, Alphabet::Base64, Alphabet::Emoji1k] {
            for len in 1..40 {
                let bits = vec![0u8; len];
                let s = bits_to_string_in(&bits, 0, alpha);
                assert_eq!(
                    string_to_bits_in(&s, alpha).unwrap(),
                    (0, bits),
                    "{alpha:?} {len}"
                );
            }
        }
    }

    #[test]
    fn foreign_characters_are_rejected_not_misread() {
        assert!(string_to_bits_in("AAAA", Alphabet::Emoji1k).is_err());
        assert!(string_to_bits_in("🌍🌍", Alphabet::Base64).is_err());
        assert!(string_to_bits_in("A.A", Alphabet::Base64).is_err());
    }
}
