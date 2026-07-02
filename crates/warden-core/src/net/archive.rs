//! Archive extraction for managed-tool installs: pull a single matching binary
//! out of a `.tar.gz` or `.zip`. The `.exe`-suffix decision for the host lives
//! here ([`host_binary_name`]) so every distribution agrees on the binary name.

use std::io::{Cursor, Read};
use std::path::Path;

use crate::error::{AppError, Result};

/// The host's on-disk name for a bare binary (`gh` → `gh.exe` on Windows). The
/// single place the platform extension is decided.
pub fn host_binary_name(bin: &str) -> String {
    if cfg!(windows) {
        format!("{bin}.exe")
    } else {
        bin.to_string()
    }
}

/// Extract the first archive entry matching `matches`, returning its bytes.
pub fn extract_tar_gz(archive: &[u8], matches: impl Fn(&Path) -> bool) -> Result<Vec<u8>> {
    use flate2::read::GzDecoder;
    use tar::Archive;

    let mut tar = Archive::new(GzDecoder::new(Cursor::new(archive)));
    for entry in tar
        .entries()
        .map_err(|e| AppError::Integration(format!("failed to read tar: {e}")))?
    {
        let mut entry =
            entry.map_err(|e| AppError::Integration(format!("failed to read tar entry: {e}")))?;
        let path = entry
            .path()
            .map_err(|e| AppError::Integration(format!("failed to read tar path: {e}")))?
            .into_owned();
        if matches(&path) {
            let mut content = Vec::new();
            entry.read_to_end(&mut content).map_err(|e| {
                AppError::Integration(format!("failed to read binary from archive: {e}"))
            })?;
            return Ok(content);
        }
    }
    Err(AppError::Integration(
        "binary not found in tar.gz archive".to_string(),
    ))
}

/// Extract the first zip entry matching `matches`, returning its bytes.
pub fn extract_zip(archive: &[u8], matches: impl Fn(&Path) -> bool) -> Result<Vec<u8>> {
    let mut zip = zip::ZipArchive::new(Cursor::new(archive))
        .map_err(|e| AppError::Integration(format!("failed to open zip: {e}")))?;
    for i in 0..zip.len() {
        let mut file = zip
            .by_index(i)
            .map_err(|e| AppError::Integration(format!("failed to read zip entry: {e}")))?;
        let matched = file.enclosed_name().map(|p| matches(&p)).unwrap_or(false);
        if matched {
            let mut content = Vec::new();
            file.read_to_end(&mut content).map_err(|e| {
                AppError::Integration(format!("failed to read binary from archive: {e}"))
            })?;
            return Ok(content);
        }
    }
    Err(AppError::Integration(
        "binary not found in zip archive".to_string(),
    ))
}

/// Pick the extractor by archive format and pull the matching entry out.
pub fn extract(bytes: &[u8], is_zip: bool, matches: impl Fn(&Path) -> bool) -> Result<Vec<u8>> {
    if is_zip {
        extract_zip(bytes, matches)
    } else {
        extract_tar_gz(bytes, matches)
    }
}
