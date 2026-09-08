//! Checks the model artifact the `nanourl` binary embeds, and tells the crate
//! where it is.
//!
//! `nanourl` carries the weights inside the executable, so the artifact is
//! linked in at build time rather than fetched at run time. That moves the
//! entire question of "are these the right weights?" here, where it is answered
//! once and can only be answered correctly: a wrong or missing file is a build
//! error, never a binary that decodes to something plausible and wrong.
//!
//! `NANOURL_MODEL_FILE` names the artifact; a relative value, and the default
//! below, resolve against this crate's directory. On a machine where the usual
//! path is absent (a build box, where `models/target-base` is a dangling
//! symlink), the variable is how the real path is given.
//!
//! A build script runs once per package, not once per target, so this fires
//! for every build of THIS crate, the library and its tests included, none of
//! which embeds anything. That is why `nanourl` is its own package: the
//! `urlcodec` kernel, its developer binary and the three wasm tiers are in a
//! different package and build with no artifact anywhere on the machine.

use std::path::{Path, PathBuf};

// MODEL_SHA256 and MODEL_BYTES, shared verbatim with src/weights.rs.
include!("model_pin.rs");
// sha256_file, likewise: the digest this checks and the digest
// `nanourl model verify --model PATH` reports are the same code.
include!("sha256_file.rs");

const MODEL_ENV: &str = "NANOURL_MODEL_FILE";
const MODEL_DEFAULT: &str = "../../models/target-base/ptq.nurl";

fn main() {
    println!("cargo:rerun-if-changed=model_pin.rs");
    println!("cargo:rerun-if-env-changed={MODEL_ENV}");
    // This crate has no wasm target (the browser runs `urlcodec` directly),
    // but a wasm build of it would embed nothing, so it demands nothing.
    if std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("wasm32") {
        return;
    }

    let given = std::env::var(MODEL_ENV).unwrap_or_else(|_| MODEL_DEFAULT.to_string());
    // Against CARGO_MANIFEST_DIR rather than the working directory: cargo runs
    // a build script from the package root today, but the crate's own
    // directory is what the default path is written against.
    let root = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let path = match std::fs::canonicalize(root.join(&given)) {
        Ok(p) => p,
        Err(e) => fail(&format!(
            "{given}: {e}\n\
             `nanourl` embeds the model weights, so they must be present to build it.\n\
             Set {MODEL_ENV} to the .nurl artifact, or put it at {MODEL_DEFAULT}.\n\
             Nothing in rust/urlcodec needs it: that crate builds either way."
        )),
    };
    let path = plain(&path);
    println!("cargo:rerun-if-changed={path}");

    let len = match std::fs::metadata(&path) {
        Ok(m) => m.len(),
        Err(e) => fail(&format!("{path}: {e}")),
    };
    if len != MODEL_BYTES {
        fail(&format!(
            "{path}: {len} bytes, expected {MODEL_BYTES}; this is not the published model"
        ));
    }
    let got = match sha256_file(Path::new(&path)) {
        Ok(g) => g,
        Err(e) => fail(&e),
    };
    if got != MODEL_SHA256 {
        fail(&format!(
            "{path}: sha256 {got}, expected {MODEL_SHA256}; this is not the published model"
        ));
    }

    // include_bytes! takes a literal, and env! supplies one: the path never
    // passes through the shell or through escaping, so a Windows path with
    // backslashes reaches the macro intact.
    println!("cargo:rustc-env=NANOURL_MODEL_PATH={path}");
}

/// An absolute path as the platform's own tools spell it.
///
/// `canonicalize` returns a `\\?\`-prefixed verbatim path on Windows, and a
/// verbatim path bans `/` and `..` for everything downstream that touches it.
/// Only the drive-letter form is its own tail, so only that one is unwrapped.
fn plain(p: &Path) -> String {
    let s = p.display().to_string();
    match s.strip_prefix(r"\\?\") {
        Some(t) if t.as_bytes().get(1) == Some(&b':') => t.to_string(),
        _ => s,
    }
}

/// A build-script error, printed the way cargo renders one, then a hard stop.
/// `panic!` would bury the message under a backtrace notice and a location.
fn fail(msg: &str) -> ! {
    for line in msg.lines() {
        println!("cargo:warning={line}");
    }
    eprintln!("nanourl: {msg}");
    std::process::exit(1);
}
