//! `nanourl` — the end-user command line: encode a URL to a code, decode a
//! link or a code back to its URL, and report on the model weights.
//!
//! It runs `urlcodec`'s C ABI (`codec_init`/`codec_encode`/`codec_decode`),
//! which is the exact code path the three wasm builds run in the browser, so a
//! code minted here and a code minted on the site are the same string by
//! construction rather than by a second implementation agreeing.
//!
//! Both artifacts are in the binary — the tokenizer below, and the weights,
//! which `src/main.rs` embeds and hands to [`run`] — so the tool needs no
//! network, no cache and no companion files.
//!
//! A separate crate from `urlcodec`, not a module inside it: this one has a
//! build script that demands the 124.8 MiB artifact, and a build script runs
//! once per package. Here it costs nothing that builds the kernel, the wasm
//! tiers or the developer binary; inside `urlcodec` it would have cost all of
//! them.
//!
//! The logic lives in this library rather than in `main.rs` so that the tests
//! can reach it: `tests/link_test.rs` pins [`link`] to the site's TypeScript,
//! and `tests/embedded_test.rs` pins the artifacts to what the site packs.

pub mod link;
pub mod weights;

use clap::builder::PossibleValue;
use clap::{Parser, Subcommand, ValueEnum};
use link::{alphabet_blurb, alphabet_key, bare_for, fragment_for, parse_link, DEFAULT_ALPHABET};
use serde_json::{json, Value};
use std::path::PathBuf;
use urlcodec::coder::Alphabet;

/// The tokenizer, in the binary. It is 512 KB against a 124.8 MiB model, so
/// embedding it costs almost nothing and removes the one way the two artifacts
/// can be paired wrongly: a cached tokenizer from another model decodes to
/// plausible garbage.
pub const TOKENIZER_JSON: &str = include_str!("../../../models/url-bpe-8k-cap24-s0/tokenizer.json");

/// The base a link is printed on unless `--base` says otherwise. The site's
/// own origin, spelled in `web/src/lib/links.ts` and pinned to it by
/// `tests/link_test.rs`.
pub const SITE_URL: &str = "https://qv.lc/";

/// Everything worked.
pub const EXIT_OK: i32 = 0;
/// The input was not a code, not a URL, or came from a format this build
/// cannot read.
pub const EXIT_BAD_INPUT: i32 = 1;
/// The weights could not be used: an override that is missing or is not a
/// model, or embedded bytes that no longer match their digest. The default
/// model cannot reach this state — it is in the binary.
pub const EXIT_NO_MODEL: i32 = 2;

#[derive(Parser)]
#[command(
    name = "nanourl",
    version,
    about = "Compress a URL into a short code and expand it again, offline.",
    long_about = "Compress a URL into a short code and expand it again, offline.\n\n\
        The code is the URL itself, compressed by a language model and an \
        arithmetic coder; nothing is stored anywhere. The model is built into \
        this binary, so no network, cache or companion file is needed.",
    after_help = "Exit codes: 0 success, 1 unusable input, 2 model unavailable."
)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,

    /// Use these weights instead of the ones built into this binary
    /// [env: NANOURL_MODEL]
    #[arg(short = 'm', long, global = true, value_name = "PATH")]
    model: Option<PathBuf>,

    /// Print one JSON object instead of human-readable lines
    #[arg(long, global = true)]
    json: bool,
}

#[derive(Subcommand)]
enum Cmd {
    /// Compress a URL into a code
    Encode {
        /// The URL to compress
        url: String,
        /// Output alphabet
        #[arg(short, long, value_enum, default_value = "base64url")]
        alphabet: AlphabetArg,
        /// Print the code on this base URL
        #[arg(long, value_name = "BASE", default_value = SITE_URL)]
        base: String,
        /// Print only the code, without a base URL. A base79 or qr-alpha
        /// code that could pass as base64url carries its marker digit ('~'
        /// or '/'), which decodes as a leading zero
        ///
        #[arg(long)]
        bare: bool,
    },
    /// Expand a link, or a bare code, back into its URL
    Decode {
        /// A link (https://qv.lc/#CODE or qv.lc/#CODE) or a bare code
        input: String,
        /// Alphabet to assume when the code does not identify itself
        #[arg(short, long, value_enum)]
        alphabet: Option<AlphabetArg>,
    },
    /// Inspect, verify or export the built-in model weights
    Model {
        #[command(subcommand)]
        cmd: Option<ModelCmd>,
    },
}

#[derive(Subcommand)]
enum ModelCmd {
    /// Digest, size and origin of the weights this binary carries (default)
    Info,
    /// Re-hash the weights against the published digest; a mismatch means the
    /// executable was damaged after it was built
    Verify,
    /// Write the weights out as a .nurl file
    Export {
        /// Where to write them; an existing file is refused unless --force
        path: PathBuf,
        /// Overwrite an existing file
        #[arg(long)]
        force: bool,
    },
}

/// clap's view of the kernel's [`Alphabet`].
///
/// The value names come from [`alphabet_key`], the same function `--json`
/// prints, so what a person types and what a script reads cannot drift apart.
/// `emoji` is offered as the short spelling of `emoji-1k`, because that is what
/// a person types; the wire name stays an alias.
#[derive(Copy, Clone)]
struct AlphabetArg(Alphabet);

impl ValueEnum for AlphabetArg {
    fn value_variants<'a>() -> &'a [Self] {
        &[
            AlphabetArg(Alphabet::Base64),
            AlphabetArg(Alphabet::Base79),
            AlphabetArg(Alphabet::Emoji1k),
            AlphabetArg(Alphabet::QrAlpha),
        ]
    }

    fn to_possible_value(&self) -> Option<PossibleValue> {
        let key = alphabet_key(self.0);
        Some(
            match self.0 {
                Alphabet::Emoji1k => PossibleValue::new("emoji").alias(key),
                _ => PossibleValue::new(key),
            }
            .help(alphabet_blurb(self.0)),
        )
    }
}

impl From<AlphabetArg> for Alphabet {
    fn from(a: AlphabetArg) -> Alphabet {
        a.0
    }
}

/// Human lines on stdout, or one JSON object — chosen once, so no command can
/// print half of each.
struct Out {
    json: bool,
}

impl Out {
    fn ok(&self, value: Value, human: &[String]) -> i32 {
        if self.json {
            println!("{value}");
        } else {
            for line in human {
                println!("{line}");
            }
        }
        EXIT_OK
    }

    /// Errors are machine-readable under `--json` too: a script that gets a
    /// non-zero exit should not have to parse a sentence to find out why.
    fn err(&self, code: i32, msg: &str) -> i32 {
        if self.json {
            println!("{}", json!({ "ok": false, "error": msg }));
        } else {
            eprintln!("nanourl: {msg}");
        }
        code
    }
}

/// Load weights and the embedded tokenizer into the crate's codec.
///
/// The embedded bytes are handed to the ABI as they are. Only an override
/// reaches the file system, and only that path can fail to find a model.
fn init_codec(src: &weights::Source) -> Result<(), String> {
    let owned;
    let (bytes, what) = match src {
        weights::Source::Embedded(b) => (*b, "the built-in weights".to_string()),
        weights::Source::Override(p) => {
            owned = std::fs::read(p).map_err(|e| format!("{}: {e}", p.display()))?;
            (owned.as_slice(), p.display().to_string())
        }
    };
    let rc = unsafe {
        urlcodec::codec_init(
            bytes.as_ptr(),
            bytes.len(),
            TOKENIZER_JSON.as_ptr(),
            TOKENIZER_JSON.len(),
            0,
        )
    };
    match rc {
        0 => Ok(()),
        2 => Err(format!("{what}: not a packed int4 .nurl model")),
        1 | 3 => Err("the embedded tokenizer did not parse".into()),
        5 => Err(format!(
            "{what}: the model's vocabulary does not match the embedded tokenizer"
        )),
        n => Err(format!("{what}: codec_init failed ({n})")),
    }
}

/// One call into the C ABI, with its JSON answer parsed. The ABI reports
/// failure in the payload rather than in a return code, so `ok` is checked
/// here and nowhere else.
fn call(f: impl FnOnce()) -> Result<Value, String> {
    f();
    let v: Value = serde_json::from_str(&urlcodec::last_result_str())
        .map_err(|e| format!("codec returned unparsable JSON: {e}"))?;
    if v["ok"].as_bool() == Some(true) {
        Ok(v)
    } else {
        Err(v["error"].as_str().unwrap_or("codec failed").to_string())
    }
}

/// `base#fragment`, with any fragment the base already carries replaced.
fn link_with(base: &str, fragment: &str) -> String {
    let stem = base.split('#').next().unwrap_or(base);
    format!("{stem}#{fragment}")
}

fn cmd_encode(
    out: &Out,
    embedded: &'static [u8],
    model: Option<PathBuf>,
    url: &str,
    alpha: Alphabet,
    base: &str,
    bare: bool,
) -> i32 {
    // Before the model is loaded, because it is the answer either way: an
    // empty input is not a URL, and a code minted from one would decode back
    // to nothing. `decode` rejects the mirror case with the same code.
    if url.trim().is_empty() {
        return out.err(EXIT_BAD_INPUT, "no URL in that input");
    }
    if let Err(e) = init_codec(&weights::locate(embedded, model)) {
        return out.err(EXIT_NO_MODEL, &e);
    }
    let r = call(|| unsafe {
        urlcodec::codec_encode(url.as_ptr(), url.len(), alpha.id());
    });
    let v = match r {
        Ok(v) => v,
        Err(e) => return out.err(EXIT_BAD_INPUT, &e),
    };
    let code = v["coded"].as_str().unwrap_or_default().to_string();
    // `code` is what the codec emitted; `bare` is how it is written down,
    // behind its alphabet's marker digit when it could pass as another
    // alphabet — the spelling `decode` (and the site's Decode pane) reads.
    let bare_code = bare_for(&code, alpha);
    let fragment = fragment_for(&code, alpha);
    let link = link_with(base, &fragment);
    out.ok(
        json!({
            "ok": true,
            "url": url,
            "code": code,
            "bare": bare_code,
            "alphabet": alphabet_key(alpha),
            "fragment": fragment,
            "link": link,
            "chars": v["coded_chars"],
            "bits": v["coded_bits"],
            "bits_per_char": v["bits_per_char"],
        }),
        &[if bare { bare_code } else { link }],
    )
}

fn cmd_decode(
    out: &Out,
    embedded: &'static [u8],
    model: Option<PathBuf>,
    input: &str,
    forced: Option<Alphabet>,
) -> i32 {
    let parsed = match parse_link(input) {
        Ok(p) => p,
        Err(e) => return out.err(EXIT_BAD_INPUT, &e),
    };
    if parsed.code.is_empty() {
        return out.err(EXIT_BAD_INPUT, "no code in that input");
    }
    // An explicit --alphabet wins, then whatever the code identifies itself
    // as, then base64url — the same order of authority the site's Decode pane
    // uses for the same three sources.
    let alpha = forced.or(parsed.alpha).unwrap_or(DEFAULT_ALPHABET);
    if let Err(e) = init_codec(&weights::locate(embedded, model)) {
        return out.err(EXIT_NO_MODEL, &e);
    }
    let code = parsed.code;
    let r = call(|| unsafe {
        urlcodec::codec_decode(code.as_ptr(), code.len(), alpha.id());
    });
    let v = match r {
        Ok(v) => v,
        Err(e) => return out.err(EXIT_BAD_INPUT, &e),
    };
    let url = v["url"].as_str().unwrap_or_default().to_string();
    out.ok(
        json!({
            "ok": true,
            "code": code,
            "alphabet": alphabet_key(alpha),
            "url": url,
            "tokens": v["tokens"].as_array().map(|t| t.len()).unwrap_or(0),
            "bits": v["coded_bits"],
        }),
        &[url],
    )
}

fn cmd_model(
    out: &Out,
    embedded: &'static [u8],
    model: Option<PathBuf>,
    cmd: Option<ModelCmd>,
) -> i32 {
    // `bytes` and `sha256` always describe the weights in the binary, override
    // or no override: what this binary carries is the question `model` answers,
    // and an override is reported beside it rather than in place of it.
    let over = match weights::locate(embedded, model) {
        weights::Source::Override(p) => Some(p),
        weights::Source::Embedded(_) => None,
    };
    match cmd.unwrap_or(ModelCmd::Info) {
        ModelCmd::Info => {
            // An override that cannot be read is the same failure `encode` and
            // `decode` would hit, so it is the same exit code: reporting it as
            // a line inside `"ok": true` would let a script act on a model that
            // is not there.
            let over_bytes = match &over {
                None => None,
                Some(p) => match std::fs::metadata(p).map(|m| m.len()) {
                    Ok(n) => Some(n),
                    Err(e) => return out.err(EXIT_NO_MODEL, &format!("{}: {e}", p.display())),
                },
            };
            let mut lines = vec![match &over {
                None => "source    built into this binary".to_string(),
                Some(p) => format!(
                    "source    {} (--model or ${})",
                    p.display(),
                    weights::MODEL_ENV
                ),
            }];
            if let Some(n) = over_bytes {
                lines.push(format!("override  {n} bytes, used as given"));
            }
            lines.push(format!("bytes     {}", embedded.len()));
            lines.push(format!("sha256    {}", weights::MODEL_SHA256));
            lines.push(format!("release   {}", weights::MODEL_URL));
            out.ok(
                json!({
                    "ok": true,
                    "embedded": over.is_none(),
                    "override": over.as_ref().map(|p| json!({
                        "path": p.display().to_string(),
                        "bytes": over_bytes,
                    })),
                    "bytes": embedded.len(),
                    "sha256": weights::MODEL_SHA256,
                    "url": weights::MODEL_URL,
                }),
                &lines,
            )
        }
        ModelCmd::Verify => {
            // An override is a model the caller chose; it is legitimately not
            // the published one, so its digest is reported rather than judged.
            // The embedded bytes have no such excuse: a mismatch there means
            // the executable is damaged, which is exit 2.
            let (what, got, published) = match &over {
                None => match weights::verify(embedded) {
                    Ok(got) => ("the built-in weights".to_string(), got, true),
                    Err(e) => return out.err(EXIT_NO_MODEL, &e),
                },
                Some(p) => match weights::sha256_file(p) {
                    Ok(got) => {
                        let same = got == weights::MODEL_SHA256;
                        (p.display().to_string(), got, same)
                    }
                    Err(e) => return out.err(EXIT_NO_MODEL, &e),
                },
            };
            out.ok(
                json!({ "ok": true, "sha256": got, "published": published, "embedded": over.is_none() }),
                &[format!(
                    "{what} sha256 {got}{}",
                    if published {
                        " — matches the published model"
                    } else {
                        " — not the published model (explicit override)"
                    }
                )],
            )
        }
        ModelCmd::Export { path, force } => {
            // Always the embedded bytes: an override is already a file, and
            // copying it here would only be `cp` with extra steps.
            match weights::export(embedded, &path, force) {
                Ok(n) => out.ok(
                    json!({ "ok": true, "path": path, "bytes": n, "sha256": weights::MODEL_SHA256 }),
                    &[format!("{} bytes written to {}", n, path.display())],
                ),
                Err(e) => out.err(EXIT_NO_MODEL, &e),
            }
        }
    }
}

/// The process's exit code, given the weights `src/main.rs` embedded.
///
/// The bytes are a parameter rather than a static here so that the binary is
/// the only thing that carries them: this library is linked by every test
/// harness in the crate, and none of them needs a 124.8 MiB constant.
pub fn run(embedded: &'static [u8]) -> i32 {
    // try_parse, not parse: clap exits 2 on a usage error, and 2 is this
    // CLI's "model unavailable" code — a script checking for it would read a
    // typo as a missing download.
    let cli = match Cli::try_parse() {
        Ok(c) => c,
        Err(e) => {
            let _ = e.print();
            return if e.use_stderr() {
                EXIT_BAD_INPUT
            } else {
                EXIT_OK
            };
        }
    };
    let out = Out { json: cli.json };
    match cli.cmd {
        Cmd::Encode {
            url,
            alphabet,
            base,
            bare,
        } => cmd_encode(
            &out,
            embedded,
            cli.model,
            &url,
            alphabet.into(),
            &base,
            bare,
        ),
        Cmd::Decode { input, alphabet } => cmd_decode(
            &out,
            embedded,
            cli.model,
            &input,
            alphabet.map(Alphabet::from),
        ),
        Cmd::Model { cmd } => cmd_model(&out, embedded, cli.model, cmd),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_link_replaces_whatever_fragment_the_base_carried() {
        assert_eq!(link_with("https://qv.lc/", "abc"), "https://qv.lc/#abc");
        assert_eq!(link_with("https://qv.lc/#old", "abc"), "https://qv.lc/#abc");
    }

    /// The CLI's argument surface is a contract; clap checks it at build time
    /// only if something asks it to.
    #[test]
    fn the_command_tree_is_well_formed() {
        use clap::CommandFactory;
        Cli::command().debug_assert();
    }
}
