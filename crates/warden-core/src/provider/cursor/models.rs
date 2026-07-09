//! Lists the models the local Cursor install can run, via `cursor-agent models`
//! (falling back to `--list-models`). Availability is per-account, so the picker
//! reads this live rather than a static list. Ids are returned with the
//! `cursor/` routing prefix; a failed or empty listing yields an empty list (the
//! picker keeps whatever it had).

use serde::Serialize;
use specta::Type;

use crate::cli::{self, Tool};
use crate::error::{AppError, Result};

/// One selectable Cursor model for the picker.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CursorModel {
    /// Picker model id, prefixed so it routes to the Cursor backend (`cursor/<model>`).
    pub id: String,
    /// Readable label as Cursor prints it.
    pub label: String,
}

pub async fn list() -> Result<Vec<CursorModel>> {
    let output = tokio::task::spawn_blocking(|| {
        // `models` is current; `--list-models` is the older spelling.
        for args in [["models"].as_slice(), ["--list-models"].as_slice()] {
            let mut cmd = std::process::Command::new(cli::resolve(Tool::Cursor));
            cmd.args(args);
            if let Ok(output) = crate::platform::silent_command(&mut cmd).output() {
                if output.status.success() {
                    let text = format!(
                        "{}\n{}",
                        String::from_utf8_lossy(&output.stdout),
                        String::from_utf8_lossy(&output.stderr)
                    );
                    let models = parse_models(&text);
                    if !models.is_empty() {
                        return models;
                    }
                }
            }
        }
        Vec::new()
    })
    .await
    .map_err(|e| AppError::Agent(format!("cursor-agent models task failed: {e}")))?;
    Ok(output)
}

/// Parse `id - Label` lines (optionally tagged `(current)`/`(default)`), prefixing
/// each id for backend routing. Noise (headers, tips, blank lines) is skipped.
fn parse_models(stdout: &str) -> Vec<CursorModel> {
    strip_ansi(stdout)
        .lines()
        .map(str::trim)
        .filter(|line| {
            !line.is_empty()
                && *line != "Available models"
                && !line.starts_with("Loading models")
                && !line.starts_with("Tip:")
        })
        .filter_map(|line| {
            let (id, rest) = line.split_once(" - ")?;
            let id = id.trim();
            if id.is_empty() {
                return None;
            }
            let label = rest
                .replace("(current)", "")
                .replace("(default)", "")
                .trim()
                .to_string();
            Some(CursorModel {
                id: format!("cursor/{id}"),
                label: if label.is_empty() {
                    id.to_string()
                } else {
                    label
                },
            })
        })
        .collect()
}

fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for c in chars.by_ref() {
                    if c.is_ascii_alphabetic() {
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
    fn parses_model_lines_and_prefixes_ids() {
        let stdout = "Available models\n\nauto - Auto\ncomposer-2.5-fast - Composer 2.5 Fast (default)\ncomposer-2 - Composer 2 (current)\n\u{1b}[2mnot a model\u{1b}[0m\nTip: use --model\n";
        let models = parse_models(stdout);
        let ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(
            ids,
            [
                "cursor/auto",
                "cursor/composer-2.5-fast",
                "cursor/composer-2"
            ]
        );
        assert_eq!(models[1].label, "Composer 2.5 Fast");
    }
}
