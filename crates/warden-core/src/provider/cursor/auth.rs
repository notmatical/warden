//! Cursor auth: `cursor-agent status` (with `about` as a fallback) prints the
//! signed-in account. We treat "logged in as …" or a populated user-email line
//! as authenticated. Runs off the async runtime (the provider probes it via
//! `spawn_blocking`).

use std::process::Command;

use crate::cli::{self, Tool};

/// Whether `cursor-agent` reports a signed-in account.
pub fn is_authed(binary: Option<&str>) -> bool {
    let bin = binary
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| cli::resolve(Tool::Cursor));
    for args in [["status"].as_slice(), ["about"].as_slice()] {
        let mut cmd = Command::new(&bin);
        cmd.args(args);
        let Ok(output) = crate::platform::silent_command(&mut cmd).output() else {
            continue;
        };
        let combined = format!(
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        if looks_authenticated(&strip_ansi(&combined)) {
            return true;
        }
    }
    false
}

/// Whether CLI output names a signed-in account.
fn looks_authenticated(output: &str) -> bool {
    let lower = output.to_lowercase();
    if lower.contains("logged in as") {
        return true;
    }
    lower.lines().any(|line| {
        line.contains("user email")
            && line.contains('@')
            && !line.contains("not logged in")
            && !line.contains("unknown")
            && !line.trim_end().ends_with(':')
    })
}

fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for c in chars.by_ref() {
                    if ('@'..='~').contains(&c) {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(ch);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_logged_in_and_email_lines() {
        assert!(looks_authenticated("✓ Logged in as test@example.com"));
        assert!(looks_authenticated(
            "About Cursor CLI\nUser Email          test@example.com"
        ));
        assert!(!looks_authenticated("User Email          unknown"));
        assert!(!looks_authenticated("Not logged in"));
    }
}
