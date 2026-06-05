//! Platform-specific process and filesystem helpers: spawning background
//! subprocesses cleanly (no console flash on Windows; the user's real PATH on
//! macOS GUI apps) and writing downloaded binaries atomically.

use std::path::Path;
use std::process::Command;

/// macOS GUI apps (launched from Finder/Dock) inherit a minimal `PATH` without
/// Homebrew/npm/etc., so subprocess lookups like `which claude` fail. Import the
/// login shell's PATH into this process once, lazily, on first subprocess spawn.
#[cfg(target_os = "macos")]
pub fn ensure_macos_path() {
    use std::sync::Once;
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        if let Ok(output) = Command::new(&shell)
            .args(["-l", "-c", "echo $PATH"])
            .output()
        {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() {
                    std::env::set_var("PATH", path);
                }
            }
        }
    });
}

#[cfg(not(target_os = "macos"))]
pub fn ensure_macos_path() {}

/// Configure a `Command` for background use: never flash a console on Windows,
/// and run with the user's full PATH on macOS. A no-op elsewhere. Do NOT use for
/// commands that intentionally open UI (terminals, editors, file explorers).
pub fn silent_command(cmd: &mut Command) -> &mut Command {
    ensure_macos_path();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Best-effort kill of a process *and its descendants*. On Windows the agent CLI
/// is usually a `claude.cmd` shim that spawns `node`; terminating only the direct
/// child (e.g. via `Child::start_kill`) orphans `node`, which keeps streaming to
/// the inherited pipe and holds the Claude session lock. `taskkill /T` tears down
/// the whole tree. On other platforms this is a no-op (the direct-child kill is
/// enough for development); revisit if we ship beyond Windows.
pub fn kill_process_tree(pid: u32) {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("taskkill");
        cmd.args(["/F", "/T", "/PID", &pid.to_string()]);
        let _ = silent_command(&mut cmd).output();
    }
    #[cfg(not(windows))]
    {
        let _ = pid;
    }
}

/// Write a downloaded binary to `path` via a temp file + atomic rename, then make
/// it runnable. On Windows a running binary holds a lock, so the existing file is
/// moved aside first; elsewhere the rename swaps the directory entry to the new
/// inode.
pub fn write_binary_file(path: &Path, content: &[u8]) -> Result<(), String> {
    let temp_path = path.with_extension("tmp");
    std::fs::write(&temp_path, content).map_err(|e| format!("failed to write temp file: {e}"))?;

    #[cfg(windows)]
    {
        let old_path = path.with_extension("old");
        if path.exists() {
            let _ = std::fs::remove_file(&old_path);
            if let Err(e) = std::fs::rename(path, &old_path) {
                let _ = std::fs::remove_file(&temp_path);
                return Err(format!("failed to replace existing binary: {e}"));
            }
        }
        if let Err(e) = std::fs::rename(&temp_path, path) {
            let _ = std::fs::rename(&old_path, path);
            return Err(format!("failed to install new binary: {e}"));
        }
        let _ = std::fs::remove_file(&old_path);
    }

    #[cfg(not(windows))]
    if let Err(e) = std::fs::rename(&temp_path, path) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(format!("failed to install new binary: {e}"));
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
