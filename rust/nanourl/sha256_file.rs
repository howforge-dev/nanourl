// The digest of a file on disk. Included verbatim by `build.rs`, which checks
// the artifact before it is embedded, and by `src/weights.rs`, which re-checks
// a `--model` override, so the two cannot disagree about what the sha256 of a
// file is, and a change to the block size or the hex formatting reaches both.
//
// `include!`, not a module: `build.rs` compiles before the crate exists and
// cannot reach into it. Fully qualified paths for the same reason: it has to
// compile with whatever else is in scope where it lands.

/// Lowercase hex sha256 of a file, read in 1 MiB blocks so a file of any size
/// is hashed without being held in memory.
pub fn sha256_file(path: &std::path::Path) -> Result<String, String> {
    use sha2::Digest;
    use std::io::Read;
    let mut f = std::fs::File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let mut h = sha2::Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f
            .read(&mut buf)
            .map_err(|e| format!("{}: {e}", path.display()))?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(format!("{:x}", h.finalize()))
}
