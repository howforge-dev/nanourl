// The published weights, pinned. Included verbatim by `build.rs` (which
// refuses to embed any other file) and by `src/weights.rs` (which reports
// these numbers and re-checks them). One file, so the checker and the reporter
// cannot describe different artifacts. Both CI workflows read MODEL_SHA256 out
// of this file rather than restating it.
//
// `include!`, not a module: `build.rs` compiles before the crate exists and
// cannot reach into it.

/// sha256 of `nanourl-target-base.nurl`.
pub const MODEL_SHA256: &str = "5e37aad1f34c420f2a3f5ea5a273ec3bd95a99b48f0c3eaa29187b1d22039fd2";

/// Its length in bytes.
pub const MODEL_BYTES: u64 = 130_862_112;
