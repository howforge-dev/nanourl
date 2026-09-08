//! Invertible URL canonicalisation: host labels reordered TLD-first.
//!     https://www.example.com/a  <->  https://com.example.www/a
//! Line-for-line port of training/canonical.py. `canonical` is its own
//! inverse, so encode and decode call the same function and cannot disagree.

const SCHEMES: [&str; 2] = ["https://", "http://"];

fn is_ipv4(host: &str) -> bool {
    let parts: Vec<&str> = host.split('.').collect();
    parts.len() == 4
        && parts.iter().all(|p| {
            !p.is_empty()
                && p.len() <= 3
                && p.bytes().all(|b| b.is_ascii_digit())
                && p.parse::<u32>().map(|v| v < 256).unwrap_or(false)
        })
}

/// Python's str.rpartition(sep): (head, sep, tail) with head empty when absent.
fn rpartition(s: &str, sep: char) -> (&str, &str, &str) {
    match s.rfind(sep) {
        Some(i) => (&s[..i], &s[i..i + sep.len_utf8()], &s[i + sep.len_utf8()..]),
        None => ("", "", s),
    }
}

pub fn canonical(url: &str) -> String {
    let Some(scheme) = SCHEMES.iter().find(|s| url.starts_with(**s)) else {
        return url.to_string(); // unrecognised scheme: pass through untouched
    };
    let rest = &url[scheme.len()..];
    let cut = ['/', '?', '#']
        .iter()
        .filter_map(|c| rest.find(*c))
        .min()
        .unwrap_or(rest.len());
    let (authority, tail) = rest.split_at(cut);

    let (userinfo, at, hostport) = rpartition(authority, '@');
    let (mut host, mut colon, mut port) = rpartition(hostport, ':');
    if colon.is_empty() || port.is_empty() || !port.bytes().all(|b| b.is_ascii_digit()) {
        host = hostport;
        colon = "";
        port = "";
    }
    // Reversal-invariant guard: bracket anywhere, colon anywhere (a rejected
    // port split), or dotted quad. Label reversal preserves the multiset of
    // characters, so "contains" gives the same answer on both sides of the
    // involution where "starts with" (brackets) or "ends with a valid port"
    // (colon) do not; both found by the fuzz goldens. A retained host holds
    // ':' only when the port split above was rejected (non-digit tail), and
    // reversal can move that ':' so a later pass's split accepts it as a
    // port, so any ':' in host must also freeze it.
    let host = if host.contains('[') || host.contains(':') || is_ipv4(host) {
        host.to_string()
    } else {
        host.split('.').rev().collect::<Vec<_>>().join(".")
    };
    format!("{scheme}{userinfo}{at}{host}{colon}{port}{tail}")
}

#[cfg(test)]
mod tests {
    use super::canonical;
    // The 15 cases from training/canonical.py's __main__ plus their expected outputs.
    const CASES: &[(&str, &str)] = &[
        (
            "https://www.example.com/blog/2024/01/post.html?utm_source=x&id=42#top",
            "https://com.example.www/blog/2024/01/post.html?utm_source=x&id=42#top",
        ),
        ("http://example.com", "http://com.example"),
        ("https://a.b.c.d.e.f/", "https://f.e.d.c.b.a/"),
        (
            "https://user:pass@www.example.com:8443/p?q=1",
            "https://user:pass@com.example.www:8443/p?q=1",
        ),
        ("https://1.2.3.4/path", "https://1.2.3.4/path"),
        ("https://[::1]:8080/x", "https://[::1]:8080/x"),
        (
            "https://example.com./trailing",
            "https://.com.example/trailing",
        ),
        ("https://example..com/empty", "https://com..example/empty"),
        ("https://localhost/", "https://localhost/"),
        ("https:///no-host", "https:///no-host"),
        ("ftp://weird.example.com/x", "ftp://weird.example.com/x"),
        (
            "http://129.222.104.0/25,US,US-CA,San",
            "http://129.222.104.0/25,US,US-CA,San",
        ),
        ("not a url at all", "not a url at all"),
        (
            "https://xn--80ak6aa92e.com/é中",
            "https://com.xn--80ak6aa92e/é中",
        ),
        (
            "https://WWW.Example.COM/Case",
            "https://COM.Example.WWW/Case",
        ),
        // rejected port split ("notaport" isn't digits) retains the ':' in
        // host, which freezes reversal instead of reordering around it.
        ("https://a.b:notaport/x", "https://a.b:notaport/x"),
    ];
    #[test]
    fn matches_python() {
        for (u, c) in CASES {
            assert_eq!(canonical(u), *c, "input {u}");
            assert_eq!(canonical(&canonical(u)), *u, "involution {u}");
        }
    }
}
