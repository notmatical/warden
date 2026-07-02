//! Lists the models the local OpenCode install can actually run, via
//! `opencode models` — which prints only connected providers' catalogs. Model
//! availability is per-account (signed-in providers, even the Zen lineup), so
//! the picker reads this instead of a static list.

use serde::Serialize;
use specta::Type;

use crate::cli::{self, Tool};
use crate::error::{AppError, Result};

/// One selectable OpenCode model for the picker.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeModel {
    /// Picker model id, prefixed so it routes to the OpenCode backend
    /// (`opencode/<model>` for Zen, `opencode/<provider>/<model>` otherwise).
    pub id: String,
    /// The `provider/model` identifier as OpenCode prints it.
    pub label: String,
}

pub async fn list() -> Result<Vec<OpencodeModel>> {
    let output = tokio::task::spawn_blocking(|| {
        let mut cmd = std::process::Command::new(cli::resolve(Tool::Opencode));
        cmd.arg("models");
        crate::platform::silent_command(&mut cmd).output()
    })
    .await
    .map_err(|e| AppError::Agent(format!("opencode models task failed: {e}")))?
    .map_err(|e| AppError::Agent(format!("failed to run opencode models: {e}")))?;

    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Agent(format!(
            "opencode models exited with {}: {}",
            output.status,
            detail.trim()
        )));
    }
    Ok(parse_models(&String::from_utf8_lossy(&output.stdout)))
}

/// Pull `provider/model` lines out of the CLI output, in printed order,
/// deduplicated. Anything else (warnings, blank lines, decorations) is skipped.
fn parse_models(stdout: &str) -> Vec<OpencodeModel> {
    let mut seen = std::collections::HashSet::new();
    stdout
        .lines()
        .map(strip_ansi)
        .filter(|line| is_model_identifier(line))
        .filter(|line| seen.insert(line.clone()))
        .map(|line| {
            let id = if line.starts_with("opencode/") {
                line.clone()
            } else {
                format!("opencode/{line}")
            };
            OpencodeModel { id, label: line }
        })
        .collect()
}

/// One or more `/`-separated segments of identifier characters, with an
/// optional `:qualifier` suffix (e.g. `anthropic/claude-sonnet-4-6`,
/// `openrouter/qwen3:free`).
fn is_model_identifier(s: &str) -> bool {
    s.contains('/')
        && !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_' | '.' | ':'))
}

/// Drop ANSI escape sequences (`ESC [ … <letter>`) and surrounding whitespace.
fn strip_ansi(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for esc in chars.by_ref() {
                    if esc.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(c);
    }
    out.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_model_lines_and_skips_noise() {
        let stdout = "Warning: something\n\nopencode/big-pickle\nanthropic/claude-sonnet-4-6\nanthropic/claude-sonnet-4-6\n\u{1b}[2mollama/qwen3:latest\u{1b}[0m\nnot a model line\n";
        let models = parse_models(stdout);
        let ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(
            ids,
            [
                "opencode/big-pickle",
                "opencode/anthropic/claude-sonnet-4-6",
                "opencode/ollama/qwen3:latest",
            ]
        );
        assert_eq!(models[1].label, "anthropic/claude-sonnet-4-6");
    }
}
