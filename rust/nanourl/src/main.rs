//! `nanourl` — the shipped command line. The logic is all in this crate's
//! library, so that it compiles and is unit-tested as something the tests can
//! reach rather than as a binary nothing else can.
//!
//! What is here and nowhere else is the model. `include_bytes!` in this file
//! means the 124.8 MiB artifact is linked into this binary alone: this crate's
//! own library and tests, the `urlcodec` kernel, its developer binary, the
//! native cdylib and the three wasm builds are all unaffected by it.
//!
//! `std::process::exit`, not a `Result` from `main`: the exit codes are part of
//! the interface (0 ok, 1 unusable input, 2 model unavailable), and returning
//! an `Err` from `main` would collapse all of them onto 1 and prepend "Error:".

/// The weights, checked by `build.rs` before this path was ever emitted.
///
/// Used in place: `codec_init` takes a pointer and a length, and
/// `Model::load_bytes` consumes them as a byte STREAM, decoding each matrix
/// into its own buffer as it goes. Nothing casts this slice to a wider type, so
/// its alignment of 1 constrains nothing — and nothing copies 124.8 MiB into a
/// `Vec` on the way in.
static MODEL: &[u8] = include_bytes!(env!("NANOURL_MODEL_PATH"));

fn main() {
    std::process::exit(nanourl::run(MODEL));
}
