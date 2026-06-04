//! Background generation of a concise, human-friendly session title from the
//! user's first message, via a single cheap `claude` invocation.

use std::process::Stdio;

use tokio::process::Command;

use super::claude::resolve_claude;

/// A small, fast model is plenty for a few-word title.
const NAMING_MODEL: &str = "haiku";
/// Cap the message we send so a huge first prompt stays cheap.
const MAX_MESSAGE_CHARS: usize = 2000;
/// Cap the resulting title length.
const MAX_TITLE_CHARS: usize = 48;

fn build_prompt(message: &str) -> String {
    let truncated: String = message.chars().take(MAX_MESSAGE_CHARS).collect();
    format!(
        "You label a session in a developer tool with a short title, based on the \
         user's first message. This is a labeling task, not a conversation.\n\n\
         Always output a concise title (2 to 5 words, sentence case). Even if the \
         message is a greeting, vague, off-topic, or not a coding request, still \
         produce a fitting label describing what it is — for example \"General \
         greeting\", \"Casual conversation\", or \"Quick question\".\n\n\
         Never ask a question. Never refuse or reply with a sentence or explanation. \
         No surrounding quotes, no trailing period. Do not begin with a verb like \
         Add, Fix, Update, Implement, or Refactor.\n\n\
         Output ONLY the title.\n\n\
         Message:\n{truncated}"
    )
}

/// Tidy the model's reply into a usable title, or `None` if it's unusable.
fn sanitize_title(raw: &str) -> Option<String> {
    let first_line = raw.lines().next().unwrap_or("").trim();
    let unquoted =
        first_line.trim_matches(|c: char| c == '"' || c == '\'' || c == '.' || c.is_whitespace());
    let cleaned = unquoted.split_whitespace().collect::<Vec<_>>().join(" ");
    if cleaned.is_empty() {
        return None;
    }

    // Guard against the model answering instead of labeling: real titles are a
    // few words and never a question.
    if cleaned.ends_with('?') || cleaned.split_whitespace().count() > 7 {
        return None;
    }

    let capped: String = if cleaned.chars().count() > MAX_TITLE_CHARS {
        cleaned
            .chars()
            .take(MAX_TITLE_CHARS)
            .collect::<String>()
            .trim_end()
            .to_string()
    } else {
        cleaned
    };

    match capped.to_lowercase().as_str() {
        "new session" | "coding task" | "untitled" => None,
        _ => Some(capped),
    }
}

/// Generate a title for a session from its first message. Returns `None` on any
/// failure so the caller can keep the existing title.
pub async fn generate_session_title(working_dir: &str, message: &str) -> Option<String> {
    let bin = resolve_claude();
    let prompt = build_prompt(message);

    let output = Command::new(bin)
        .args([
            "-p",
            &prompt,
            "--output-format",
            "json",
            "--model",
            NAMING_MODEL,
            "--permission-mode",
            "bypassPermissions",
            "--max-turns",
            "1",
        ])
        .current_dir(working_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .output()
        .await
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let value: serde_json::Value = serde_json::from_str(stdout.trim()).ok()?;
    let result = value.get("result")?.as_str()?;
    sanitize_title(result)
}
