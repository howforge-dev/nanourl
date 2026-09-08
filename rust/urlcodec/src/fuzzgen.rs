//! Deterministic URL generator for the cross-runtime fuzz harness.
//!
//! The SAME compiled code produces case (seed, idx) natively and in wasm —
//! there is no second implementation to drift. Cases cycle through modes:
//! realistic URLs, unicode-heavy paths, percent-encoding soup, base79
//! special characters, oversize inputs (the token-limit error path), tiny
//! degenerate strings, and query monsters.

pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Rng {
        Rng(seed)
    }

    fn next(&mut self) -> u64 {
        // splitmix64 — identical on every platform
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    fn below(&mut self, n: u64) -> u64 {
        ((self.next() as u128 * n as u128) >> 64) as u64
    }

    fn pick<'a>(&mut self, xs: &[&'a str]) -> &'a str {
        xs[self.below(xs.len() as u64) as usize]
    }

    fn chars(&mut self, set: &str, n: usize) -> String {
        let cs: Vec<char> = set.chars().collect();
        (0..n)
            .map(|_| cs[self.below(cs.len() as u64) as usize])
            .collect()
    }
}

const LOWER: &str = "abcdefghijklmnopqrstuvwxyz";
const ALNUM: &str = "abcdefghijklmnopqrstuvwxyz0123456789";
const PATHY: &str = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
const B79SP: &str = ".~!$&'()*+,;=:@";
const UNI: &str = "日本語中文한국어ßüöäéèñçø北京東京🦆🚀→∞αβγ";
const HEX: &str = "0123456789ABCDEF";
const TLDS: &[&str] = &["com", "org", "net", "io", "de", "co.uk", "jp", "dev", "ai"];
const SCHEMES: &[&str] = &["https", "https", "https", "http"]; // https-weighted

pub fn gen_url(seed: u64, idx: u64) -> String {
    let mut r = Rng::new(seed ^ idx.wrapping_mul(0x2545_F491_4F6C_DD1D));
    r.next();
    r.next();
    let mode = idx % 8;

    let host = |r: &mut Rng| {
        let labels = 1 + r.below(2);
        let mut h = String::new();
        for i in 0..=labels {
            if i > 0 {
                h.push('.');
            }
            if i == labels {
                h.push_str(r.pick(TLDS));
            } else {
                let n = 3 + r.below(12) as usize;
                h.push_str(&r.chars(LOWER, n));
            }
        }
        if r.below(12) == 0 {
            h.push_str(&format!(":{}", 1024 + r.below(60000)));
        }
        h
    };
    let seg = |r: &mut Rng, set: &str| {
        let n = 1 + r.below(14) as usize;
        r.chars(set, n)
    };

    match mode {
        0 | 1 => {
            // realistic path URL
            let mut u = format!("{}://{}", r.pick(SCHEMES), host(&mut r));
            for _ in 0..r.below(5) {
                u.push('/');
                u.push_str(&seg(&mut r, PATHY));
            }
            if r.below(3) == 0 {
                u.push_str(&format!("/{}", r.below(100000)));
            }
            if r.below(4) == 0 {
                u.push_str(".html");
            }
            u
        }
        2 => {
            // query-heavy
            let mut u = format!("https://{}/{}", host(&mut r), seg(&mut r, LOWER));
            u.push('?');
            let pairs = 1 + r.below(6);
            for p in 0..pairs {
                if p > 0 {
                    u.push('&');
                }
                let nk = 2 + r.below(8) as usize;
                let k = r.chars(LOWER, nk);
                let nv = 1 + r.below(16) as usize;
                let v = r.chars(ALNUM, nv);
                u.push_str(&format!("{k}={v}"));
            }
            if r.below(3) == 0 {
                u.push('#');
                u.push_str(&seg(&mut r, ALNUM));
            }
            u
        }
        3 => {
            // unicode-heavy path (valid UTF-8 by construction)
            let mut u = format!("https://{}/wiki", host(&mut r));
            for _ in 0..1 + r.below(3) {
                u.push('/');
                let n = 1 + r.below(10) as usize;
                u.push_str(&r.chars(UNI, n));
            }
            u
        }
        4 => {
            // percent-encoding soup
            let mut u = format!("https://{}/p", host(&mut r));
            for _ in 0..2 + r.below(20) {
                u.push('%');
                u.push_str(&r.chars(HEX, 2));
            }
            u.push_str(&seg(&mut r, PATHY));
            u
        }
        5 => {
            // base79 special characters everywhere (alphabet edge cases)
            let mut u = format!("https://{}/", host(&mut r));
            for _ in 0..3 + r.below(20) {
                u.push_str(&r.chars(B79SP, 1));
                let n = r.below(4) as usize;
                u.push_str(&r.chars(ALNUM, n));
            }
            u
        }
        6 => {
            // degenerate tiny inputs: not URL-shaped at all
            match r.below(5) {
                0 => r.chars(ALNUM, 1),
                1 => {
                    let n = r.below(6) as usize;
                    format!("~{}", r.chars(ALNUM, n))
                }
                2 => {
                    let n = 1 + r.below(3) as usize;
                    r.chars(B79SP, n)
                }
                3 => r.chars(UNI, 1),
                _ => {
                    let n = 2 + r.below(6) as usize;
                    r.chars(PATHY, n)
                }
            }
        }
        _ => {
            // oversize: repeated tails sized to always cross the context-
            // chaining shift (>512 tokens ~ >1150 chars) and sometimes a
            // second one, without wandering into 40s/case territory
            let mut u = format!("https://{}/", host(&mut r));
            let np = 2 + r.below(10) as usize;
            let piece = r.chars(ALNUM, np);
            let target = 1200 + r.below(700) as usize;
            let mut first = true;
            while u.len() < target {
                if !first {
                    u.push(if r.below(4) == 0 { '/' } else { '-' });
                }
                first = false;
                u.push_str(&piece);
            }
            u
        }
    }
}
