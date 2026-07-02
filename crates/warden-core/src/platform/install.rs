//! Atomic install of a downloaded binary: temp file + rename, then make runnable.

use std::path::Path;
#[cfg(target_os = "macos")]
use std::process::Command;

use crate::error::Result;

/// Write a downloaded binary to `path` via a temp file + atomic rename, then make
/// it runnable. On Windows a running binary holds a lock, so the existing file is
/// moved aside first; elsewhere the rename swaps the directory entry to the new
/// inode.
pub fn write_binary_file(path: &Path, content: &[u8]) -> Result<()> {
    let temp_path = path.with_extension("tmp");
    std::fs::write(&temp_path, content)?;

    #[cfg(windows)]
    {
        let old_path = path.with_extension("old");
        if path.exists() {
            let _ = std::fs::remove_file(&old_path);
            if let Err(e) = std::fs::rename(path, &old_path) {
                let _ = std::fs::remove_file(&temp_path);
                return Err(e.into());
            }
        }
        if let Err(e) = std::fs::rename(&temp_path, path) {
            let _ = std::fs::rename(&old_path, path);
            return Err(e.into());
        }
        let _ = std::fs::remove_file(&old_path);
    }

    #[cfg(not(windows))]
    if let Err(e) = std::fs::rename(&temp_path, path) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(e.into());
    }

    make_runnable(path);
    Ok(())
}

/// Make a freshly written binary executable (Unix) and clear macOS quarantine.
pub fn make_runnable(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(path) {
            let mut perms = meta.permissions();
            perms.set_mode(0o755);
            let _ = std::fs::set_permissions(path, perms);
        }
    }
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("xattr")
            .args(["-d", "com.apple.quarantine"])
            .arg(path)
            .output();
    }
    #[cfg(not(any(unix, target_os = "macos")))]
    let _ = path;
}
