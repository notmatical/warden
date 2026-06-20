//! Platform-specific process and filesystem helpers: spawning background
//! subprocesses cleanly (no console flash on Windows; the user's real PATH on
//! macOS GUI apps), process introspection, writing downloaded binaries
//! atomically, and Linux webview environment workarounds.

pub mod install;
pub mod process;

use std::process::Command;

/// Windows flag: spawn the child without flashing a console window. Defined once
/// here; used by both `silent_command` (std) and `detach_command` (tokio).
#[cfg(windows)]
pub(crate) const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// WebKitGTK's GPU paths are a chronic source of blank windows and renderer
/// crashes on Linux: DMABUF buffer sharing fails on NVIDIA and some Mesa
/// stacks (GBM errors), and accelerated compositing white-screens on several
/// rolling-release distros. Default both off before the first webview spawns.
///
/// Each variable is only set when absent, so users can pre-set them to take
/// control. Escape hatches: `WARDEN_NO_WEBKIT_WORKAROUNDS=1` skips everything;
/// `WARDEN_FORCE_X11=1` runs the GTK backend through XWayland for misbehaving
/// Wayland compositors.
#[cfg(target_os = "linux")]
pub fn init_linux_webview_workarounds() {
    if std::env::var_os("WARDEN_NO_WEBKIT_WORKAROUNDS").is_some() {
        return;
    }
    for var in [
        "WEBKIT_DISABLE_DMABUF_RENDERER",
        "WEBKIT_DISABLE_COMPOSITING_MODE",
    ] {
        if std::env::var_os(var).is_none() {
            std::env::set_var(var, "1");
        }
    }
    if std::env::var("WARDEN_FORCE_X11").as_deref() == Ok("1")
        && std::env::var_os("GDK_BACKEND").is_none()
    {
        std::env::set_var("GDK_BACKEND", "x11");
    }
}

#[cfg(not(target_os = "linux"))]
pub fn init_linux_webview_workarounds() {}

/// macOS GUI apps (launched from Finder/Dock) inherit a minimal `PATH` without
/// Homebrew/npm/etc., so subprocess lookups like `which claude` fail. Import the
/// login shell's PATH into this process once, lazily, on first subprocess spawn.
#[cfg(target_os = "macos")]
pub fn ensure_macos_path() {
    use std::sync::Once;
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        if let Ok(output) = Command::new(&shell).args(["-l", "-c", "echo $PATH"]).output() {
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
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Build a cross-platform shell command running a raw command line (an `&&`
/// chain, a single command, anything the shell parses), configured for silent
/// background use: no console flash on Windows, a login shell on Unix so
/// user-managed tools (nvm, rustup, …) are on PATH, and `kill_on_drop` so a
/// dropped future (e.g. a timeout) takes the child down with it. The caller sets
/// `current_dir`/env/stdio. Shared by worktree setup and the workflow executor.
pub fn shell_command(raw: &str) -> tokio::process::Command {
    ensure_macos_path();
    #[cfg(windows)]
    let mut cmd = {
        let mut c = tokio::process::Command::new("cmd");
        // `raw_arg` hands the line to cmd.exe unquoted, so `&&` stays an operator.
        c.arg("/C").raw_arg(raw);
        c.creation_flags(CREATE_NO_WINDOW);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = tokio::process::Command::new("sh");
        c.args(["-lc", raw]);
        c
    };
    // A dropped future (timeout) must take the child down with it.
    cmd.kill_on_drop(true);
    cmd
}

/// Configure a session-agent command so the child can outlive this process:
/// its own process group on Unix (no signal fan-out from ours), no console on
/// Windows (children there survive parent death unless tied to a Job Object,
/// which warden does not use for agents).
pub fn detach_command(cmd: &mut tokio::process::Command) {
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(unix)]
    {
        cmd.process_group(0);
    }
}
