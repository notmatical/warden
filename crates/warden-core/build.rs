//! Copies the shared `models.json` (which lives at the repo's `src/config/`,
//! outside this crate) into `OUT_DIR` so `model_config.rs` can `include_str!` it
//! by an `OUT_DIR`-relative path that survives the crate moving around the tree.

use std::path::Path;

fn main() {
    let manifest = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
    let src = Path::new(&manifest).join("../../src/config/models.json");
    let out = Path::new(&std::env::var("OUT_DIR").expect("OUT_DIR")).join("models.json");
    std::fs::copy(&src, &out)
        .unwrap_or_else(|e| panic!("copy {} -> {}: {e}", src.display(), out.display()));
    println!("cargo:rerun-if-changed={}", src.display());
}
