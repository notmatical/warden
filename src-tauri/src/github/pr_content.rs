//! Draft a pull request's title and body from a branch's commits and diffstat,
//! via one cheap `claude` (Haiku) invocation — mirroring background naming.

use std::path::Path;
use std::process::Stdio;

use serde::Serialize;
use tokio::process::Command;

use crate::error::{AppError, Result};
use crate::git;
use crate::providers::claude::agent::resolve_claude;

/// A small, fast model is plenty for a PR title + body.
const MODEL: &str = "haiku";
/// Cap the diffstat fed to the model so a huge change stays cheap.
const MAX_STAT_CHARS: usize = 6000;

/// A generated PR title and body, for the user to review before opening.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrContent {
    pub title: String,
    pub body: String,
}

/// The repo's PR template, if one exists at a conventional path.
fn pr_template(worktree: &Path) -> Option<String> {
    for rel in [
        ".github/PULL_REQUEST_TEMPLATE.md",
        ".github/pull_request_template.md",
        "PULL_REQUEST_TEMPLATE.md",
        "docs/PULL_REQUEST_TEMPLATE.md",
    ] {
        if let Ok(text) = std::fs::read_to_string(worktree.join(rel)) {
            if !text.trim().is_empty() {
                return Some(text);
            }
        }
    }
    None
}

fn build_prompt(subjects: &str, stat: &str, template: Option<&str>) -> String {
    let template_block = match template {
        Some(t) => format!(
            "\n\nThe repository uses this PR template — follow its structure for the body:\n{t}"
        ),
        None => String::new(),
    };
    format!(
        "You are writing a GitHub pull request for a set of changes. This is a \
         writing task, not a conversation.\n\n\
         Output the PR TITLE on the first line (imperative mood, under 70 chars, no \
         trailing period), then a blank line, then the PR BODY in GitHub-flavored \
         markdown (a short summary followed by bullet points of the notable changes). \
         Do not wrap the output in code fences. Output only the title and body.\
         {template_block}\n\n\
         Commits:\n{subjects}\n\n\
         Files changed:\n{stat}"
    )
}

/// Parse the model's reply into title (first non-empty line) + body (the rest).
fn parse(raw: &str) -> Option<PrContent> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut lines = trimmed.lines();
    let title = lines
        .next()?
        .trim()
        .trim_matches(['"', '#', ' '])
        .to_string();
    if title.is_empty() {
        return None;
    }
    let body = lines.collect::<Vec<_>>().join("\n").trim().to_string();
    Some(PrContent { title, body })
}

/// Generate a PR title + body for `worktree`'s changes since `base`. Falls back
/// to the session title + commit list if the model call fails.
pub async fn generate_pr_content(
    worktree: &Path,
    base: &str,
    fallback_title: &str,
) -> Result<PrContent> {
    let commits = git::diff::commits_since(worktree, base, 30).unwrap_or_default();
    let subjects = commits
        .iter()
        .map(|c| format!("- {}", c.subject))
        .collect::<Vec<_>>()
        .join("\n");
    let stat: String = git::run(worktree, &["diff", base, "--stat"])
        .unwrap_or_default()
        .chars()
        .take(MAX_STAT_CHARS)
        .collect();

    let fallback = || PrContent {
        title: fallback_title.to_string(),
        body: subjects.clone(),
    };

    let prompt = build_prompt(&subjects, &stat, pr_template(worktree).as_deref());
    let output = Command::new(resolve_claude())
        .args([
            "-p",
            &prompt,
            "--output-format",
            "json",
            "--model",
            MODEL,
            "--permission-mode",
            "bypassPermissions",
            "--max-turns",
            "1",
        ])
        .current_dir(worktree)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|e| AppError::Agent(format!("failed to run claude: {e}")))?;

    if !output.status.success() {
        return Ok(fallback());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let result = serde_json::from_str::<serde_json::Value>(stdout.trim())
        .ok()
        .and_then(|v| v.get("result").and_then(|r| r.as_str()).map(str::to_string));
    Ok(result.as_deref().and_then(parse).unwrap_or_else(fallback))
}
