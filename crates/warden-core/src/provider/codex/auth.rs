//! Codex auth: `codex login status` exits 0 when logged in; the stored auth file
//! is a fallback for older CLIs without the subcommand.

use std::path::PathBuf;

pub fn is_authed(binary: Option<&str>) -> bool {
    let bin = binary
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("codex"));
    let mut cmd = std::process::Command::new(bin);
    cmd.args(["login", "status"]);
    let status_ok = crate::platform::silent_command(&mut cmd)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    status_ok || crate::paths::codex_home().join("auth.json").exists()
}
