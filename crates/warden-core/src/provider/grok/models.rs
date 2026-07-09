//! Lists the models the local Grok install can run, via `grok models`. Ids are
//! returned with the `grok/` routing prefix; a failed or empty listing falls
//! back to the known pair (`grok-composer-2.5-fast` default, `grok-build`).

use serde::Serialize;
use specta::Type;

use crate::cli::{self, Tool};
use crate::error::{AppError, Result};

/// One selectable Grok model for the picker.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GrokModel {
    /// Picker model id, prefixed so it routes to the Grok backend (`grok/<model>`).
    pub id: String,
    /// Readable label.
    pub label: String,
}

/// The known Grok models, used when the CLI can't be listed.
fn fallback() -> Vec<GrokModel> {
    vec![
        GrokModel {
            id: "grok/grok-composer-2.5-fast".to_string(),
            label: "Grok Composer 2.5 Fast".to_string(),
        },
        GrokModel {
            id: "grok/grok-build".to_string(),
            label: "Grok Build".to_string(),
        },
    ]
}

pub async fn list() -> Result<Vec<GrokModel>> {
    let models = tokio::task::spawn_blocking(|| {
        let mut cmd = std::process::Command::new(cli::resolve(Tool::Grok));
        cmd.arg("models");
        match crate::platform::silent_command(&mut cmd).output() {
            Ok(output) if output.status.success() => {
                let models = parse_models(&String::from_utf8_lossy(&output.stdout));
                if models.is_empty() {
                    fallback()
                } else {
                    models
                }
            }
            _ => fallback(),
        }
    })
    .await
    .map_err(|e| AppError::Agent(format!("grok models task failed: {e}")))?;
    Ok(models)
}

/// Parse `grok models` output: bullet lines (`* id (default)` / `- id`) with an
/// optional `Default model: <id>` header. Ids are prefixed for backend routing.
fn parse_models(stdout: &str) -> Vec<GrokModel> {
    let text = super::strip_ansi(stdout);
    let mut models = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        let Some(candidate) = line.strip_prefix('*').or_else(|| line.strip_prefix('-')) else {
            continue;
        };
        let id = candidate
            .split_whitespace()
            .next()
            .unwrap_or_default()
            .trim();
        if id.is_empty() {
            continue;
        }
        models.push(GrokModel {
            id: format!("grok/{id}"),
            label: format_label(id),
        });
    }
    models
}

/// Title-case a hyphenated id into a label (`grok-composer-2.5-fast` →
/// `Grok Composer 2.5 Fast`), leaving numeric segments untouched.
fn format_label(id: &str) -> String {
    id.split('-')
        .map(|part| {
            if part.chars().all(|c| c.is_ascii_digit() || c == '.') {
                part.to_string()
            } else {
                let mut chars = part.chars();
                match chars.next() {
                    Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                    None => String::new(),
                }
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_bulleted_models_and_prefixes_ids() {
        let stdout = "Default model: grok-composer-2.5-fast\n\nAvailable models:\n  * grok-composer-2.5-fast (default)\n  - grok-build\n";
        let models = parse_models(stdout);
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "grok/grok-composer-2.5-fast");
        assert_eq!(models[0].label, "Grok Composer 2.5 Fast");
        assert_eq!(models[1].id, "grok/grok-build");
    }

    #[test]
    fn empty_output_parses_to_nothing() {
        assert!(parse_models("You are logged in.\n").is_empty());
    }
}
