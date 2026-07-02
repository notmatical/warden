//! OpenCode auth: stored credentials live in `auth.json` under OpenCode's XDG
//! data dir; `opencode auth list` is the fallback for installs that keep
//! credentials elsewhere (e.g. a custom data dir warden doesn't know about).

use std::path::PathBuf;

pub fn is_authed(binary: Option<&str>) -> bool {
    if crate::paths::opencode_data_dir().join("auth.json").exists() {
        return true;
    }
    let bin = binary
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("opencode"));
    let mut cmd = std::process::Command::new(bin);
    cmd.args(["auth", "list"]);
    crate::platform::silent_command(&mut cmd)
        .output()
        .map(|o| {
            let out = String::from_utf8_lossy(&o.stdout).to_lowercase();
            o.status.success() && out.contains("credential") && !out.contains("0 credentials")
        })
        .unwrap_or(false)
}
