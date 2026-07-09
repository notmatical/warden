//! Grok auth: there is no `login status` subcommand, so we probe the ACP
//! handshake. `grok agent stdio` advertises its auth methods in the `initialize`
//! result — a `cached_token` method means a stored login, and `xai.api_key`
//! counts when `XAI_API_KEY` is set. Bounded by a short timeout so a stalled CLI
//! never hangs the provider panel.

use std::io::{BufRead, BufReader, Write};
use std::process::Stdio;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::cli::{self, Tool};

const AUTH_TIMEOUT: Duration = Duration::from_secs(5);

/// Whether Grok has a usable credential (cached login token, or an API key in
/// the environment that the CLI accepts).
pub fn is_authed() -> bool {
    let cli_path = cli::resolve(Tool::Grok);
    let mut cmd = std::process::Command::new(&cli_path);
    cmd.args(["agent", "stdio"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    crate::platform::silent_command(&mut cmd);

    let Ok(mut child) = cmd.spawn() else {
        return false;
    };
    let (Some(mut stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
        let _ = child.kill();
        return false;
    };

    // Read on a helper thread so the deadline is honoured even if the CLI stalls
    // without emitting a newline.
    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => {
                    if tx.send(line).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    let initialize = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": 1,
            "clientCapabilities": { "fs": { "readTextFile": true }, "terminal": false },
        }
    });
    if writeln!(stdin, "{initialize}").is_err() {
        let _ = child.kill();
        return false;
    }

    let deadline = Instant::now() + AUTH_TIMEOUT;
    let authed = loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match rx.recv_timeout(remaining) {
            Ok(line) => {
                if let Ok(value) = serde_json::from_str::<Value>(line.trim()) {
                    if value.get("id").and_then(Value::as_i64) == Some(1) {
                        break value
                            .get("result")
                            .map(has_usable_auth_method)
                            .unwrap_or(false);
                    }
                }
            }
            Err(RecvTimeoutError::Timeout) | Err(RecvTimeoutError::Disconnected) => break false,
        }
    };

    let _ = child.kill();
    let _ = child.wait();
    authed
}

/// Whether the initialize result advertises a method we can authenticate with.
fn has_usable_auth_method(init: &Value) -> bool {
    let ids: Vec<&str> = init
        .get("authMethods")
        .and_then(Value::as_array)
        .map(|methods| {
            methods
                .iter()
                .filter_map(|m| m.get("id").and_then(Value::as_str))
                .collect()
        })
        .unwrap_or_default();
    if ids.contains(&"cached_token") {
        return true;
    }
    ids.contains(&"xai.api_key")
        && std::env::var("XAI_API_KEY")
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cached_token_counts_as_authed() {
        let init = json!({ "authMethods": [{ "id": "cached_token" }] });
        assert!(has_usable_auth_method(&init));
    }

    #[test]
    fn api_key_method_needs_env() {
        let init = json!({ "authMethods": [{ "id": "xai.api_key" }] });
        // Without XAI_API_KEY set in the test environment this is not usable.
        std::env::remove_var("XAI_API_KEY");
        assert!(!has_usable_auth_method(&init));
    }
}
