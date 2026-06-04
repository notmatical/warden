//! Borrows the user's existing GitHub credentials so warden's own GitHub API
//! calls are authenticated (lifting the 60/hr unauthenticated rate limit) without
//! asking the user to paste a token.

use crate::cli::{self, Tool};

/// The user's GitHub token, if discoverable: `GH_TOKEN`/`GITHUB_TOKEN` first,
/// then `gh auth token` from the resolved GitHub CLI. `None` when not logged in.
pub fn resolve_token() -> Option<String> {
    for key in ["GH_TOKEN", "GITHUB_TOKEN"] {
        if let Ok(value) = std::env::var(key) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }

    let gh = cli::resolve(Tool::Gh);
    let output = crate::platform::silent_command(&mut std::process::Command::new(&gh))
        .args(["auth", "token"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!token.is_empty()).then_some(token)
}
