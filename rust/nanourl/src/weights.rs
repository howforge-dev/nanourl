//! The model weights, and where a run gets them.
//!
//! `nanourl` is offline by construction: it opens no socket, keeps no cache
//! directory and carries no TLS stack, because the 124.8 MiB artifact is linked
//! into the executable. That is what makes a link decodable when nothing about
//! this project is reachable any more — the binary a person already has is
//! complete. It costs a ~131 MB executable, which is the whole trade.
//!
//! The bytes themselves are embedded by `src/main.rs` and passed in here, so
//! only that one binary carries them: this crate's own library and tests, the
//! `urlcodec` kernel, its developer binary and the three wasm builds are all
//! unaffected.
//!
//! `build.rs` refuses to produce a binary around any other file: it checks the
//! artifact's length and sha256 against `model_pin.rs`, the same file this
//! module includes, before emitting the path `src/main.rs` embeds. So the digest
//! reported here is not a promise about the bytes, it is a fact about them, and
//! [`verify`] exists for the case where the executable has been damaged since
//! it was built.

use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// The published artifact this binary carries. Kept in step with
/// `web/src/lib/links.ts` by `tests/link_test.rs`.
pub const MODEL_URL: &str =
    "https://github.com/howforge-dev/nanourl/releases/download/model-v0/nanourl-target-base.nurl";

// MODEL_SHA256 and MODEL_BYTES, shared verbatim with build.rs, which enforces
// them on the artifact before it is embedded. `tests/embedded_test.rs` checks
// them against the copy the site packs.
include!("../model_pin.rs");

/// The environment variable that swaps in different weights, for development
/// against a model that is not the published one.
pub const MODEL_ENV: &str = "NANOURL_MODEL";

/// Lowercase hex sha256.
pub fn sha256_bytes(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    format!("{:x}", h.finalize())
}

// sha256_file, shared verbatim with build.rs.
include!("../sha256_file.rs");

/// Re-hash the embedded weights.
///
/// `build.rs` already proved this at build time; running it again catches the
/// executable having been damaged since — a truncated copy, a bad download of
/// the archive, bit rot on the disk it sits on.
pub fn verify(model: &[u8]) -> Result<String, String> {
    if model.len() as u64 != MODEL_BYTES {
        return Err(format!(
            "embedded weights are {} bytes, expected {MODEL_BYTES} — this binary is damaged",
            model.len()
        ));
    }
    let got = sha256_bytes(model);
    if got != MODEL_SHA256 {
        return Err(format!(
            "embedded weights have sha256 {got}, expected {MODEL_SHA256} — this binary is damaged"
        ));
    }
    Ok(got)
}

/// Write the embedded weights out, for a tool that wants the artifact itself.
///
/// Through a temporary in the same directory and one rename, so an interrupted
/// export cannot leave a short file under the name something else is about to
/// read as a model. The temporary is removed on every failure path, and an
/// existing destination is refused unless `force`: 124.8 MiB over a file the
/// caller still wanted is not recoverable.
pub fn export(model: &[u8], dest: &Path, force: bool) -> Result<u64, String> {
    let tmp = match dest.file_name() {
        // to_string_lossy, not to_str: a path this process was handed is not
        // required to be UTF-8, and refusing to export to it would be a
        // surprise on every system where it is not.
        Some(n) => dest.with_file_name(format!("{}.partial", n.to_string_lossy())),
        None => return Err(format!("{}: not a file name", dest.display())),
    };
    if !force && dest.exists() {
        return Err(format!(
            "{}: exists — pass --force to overwrite it",
            dest.display()
        ));
    }
    if let Some(dir) = dest.parent().filter(|d| !d.as_os_str().is_empty()) {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    std::fs::write(&tmp, model).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("{}: {e}", tmp.display())
    })?;
    std::fs::rename(&tmp, dest).map_err(|e| {
        // A failed rename leaves 124.8 MiB under a name nothing will read.
        let _ = std::fs::remove_file(&tmp);
        format!("{}: {e}", dest.display())
    })?;
    Ok(model.len() as u64)
}

/// Which weights a run is using.
pub enum Source {
    /// The bytes in this binary. Always available: there is no state in which
    /// the default model is missing.
    Embedded(&'static [u8]),
    /// `--model` or `$NANOURL_MODEL`: a developer override, used as given.
    Override(PathBuf),
}

/// The override, if there is one; the embedded weights otherwise.
pub fn locate(embedded: &'static [u8], explicit: Option<PathBuf>) -> Source {
    let over = explicit.or_else(|| {
        std::env::var_os(MODEL_ENV)
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
    });
    match over {
        Some(p) => Source::Override(p),
        None => Source::Embedded(embedded),
    }
}
