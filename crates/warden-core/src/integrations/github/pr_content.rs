//! Draft a pull request's title and body from a branch's changes, via one
//! cheap one-shot on the session's own backend — mirroring background naming.

use std::path::Path;

use serde::Serialize;
use specta::Type;

use crate::agent::oneshot;
use crate::error::Result;
use crate::{git, Backend};

/// Cap the diffstat fed to the model so a huge change stays cheap.
const MAX_STAT_CHARS: usize = 6000;
/// Cap the unified diff likewise — enough substance for a good body.
const MAX_PATCH_CHARS: usize = 12000;

/// A generated PR title and body, for the user to review before opening.
#[derive(Debug, Clone, Serialize, Type)]
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

/// Everything the model gets to see about the change.
struct PromptContext<'a> {
    base_branch: Option<&'a str>,
    subjects: &'a str,
    recent_style: &'a str,
    status: &'a str,
    stat: &'a str,
    patch: &'a str,
    template: Option<&'a str>,
}

fn build_prompt(ctx: &PromptContext) -> String {
    let target = match ctx.base_branch {
        Some(b) => format!(" The PR targets the `{b}` branch."),
        None => String::new(),
    };
    let template_block = match ctx.template {
        Some(t) => format!(
            "\n\nThe repository uses this PR template — follow its structure for the body:\n{t}"
        ),
        None => "\n\nThere is no PR template. Structure the body as:\n\
                 ## What changed\n(bullet points of the notable changes)\n\
                 ## Why\n(a short paragraph on the motivation)\n\
                 ## Notes for review\n(only things a reviewer genuinely needs — \
                 caveats, behavior changes, verification done; omit the whole \
                 section when there are none)"
            .to_string(),
    };
    let subjects = if ctx.subjects.is_empty() {
        "(none yet — the changes below are still uncommitted; they will be \
         committed before the PR opens)"
    } else {
        ctx.subjects
    };
    format!(
        "You are writing a GitHub pull request for a set of changes. This is a \
         writing task, not a conversation: you already have all the context you \
         will get, below. Never ask questions or request more information — write \
         the best PR you can from it.{target}\n\n\
         Output the PR TITLE on the first line (imperative mood, under 70 chars, no \
         trailing period; match the style of the repository's commit subjects — e.g. \
         Conventional Commits like `feat(scope): …` — when they follow one), then a \
         blank line, then the PR BODY in GitHub-flavored markdown. \
         Do not wrap the output in code fences. Output only the title and body.\
         {template_block}\n\n\
         Commits on this branch:\n{subjects}\n\n\
         Recent commits in this repository (style reference only):\n{}\n\n\
         Uncommitted changes (`git status --porcelain`):\n{}\n\n\
         Files changed:\n{}\n\n\
         Diff against the base (may be truncated; content of new untracked files \
         is not shown — see the status above):\n{}",
        ctx.recent_style, ctx.status, ctx.stat, ctx.patch
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

fn capped(text: String, max: usize) -> String {
    if text.chars().count() <= max {
        return text;
    }
    let mut out: String = text.chars().take(max).collect();
    out.push_str("\n… (truncated)");
    out
}

/// Generate a PR title + body for `worktree`'s changes since `base` —
/// committed or not (the caller commits before opening the PR) — on the
/// session's own `backend`. Falls back to the session title + commit list if
/// there's no context or the call fails.
pub async fn generate_pr_content(
    backend: Backend,
    worktree: &Path,
    base: &str,
    base_branch: Option<&str>,
    fallback_title: &str,
) -> Result<PrContent> {
    let commits = git::diff::commits_since(worktree, base, 30).unwrap_or_default();
    let subjects = commits
        .iter()
        .map(|c| format!("- {}", c.subject))
        .collect::<Vec<_>>()
        .join("\n");
    // `git diff` is blind to untracked files, and an agent session's work is
    // often uncommitted new files — the porcelain status is what catches those.
    let status = git::run(worktree, &["status", "--porcelain"]).unwrap_or_default();
    let stat = capped(
        git::run(worktree, &["diff", base, "--stat"]).unwrap_or_default(),
        MAX_STAT_CHARS,
    );
    let patch = capped(
        git::run(worktree, &["diff", base]).unwrap_or_default(),
        MAX_PATCH_CHARS,
    );
    let recent_style = git::run(worktree, &["log", "-8", "--format=- %s", base])
        .unwrap_or_default()
        .trim()
        .to_string();

    let fallback = || PrContent {
        title: fallback_title.to_string(),
        body: subjects.clone(),
    };

    // Nothing to describe — asking the model would only invite made-up output.
    if subjects.is_empty() && status.trim().is_empty() && stat.trim().is_empty() {
        return Ok(fallback());
    }

    let template = pr_template(worktree);
    let prompt = build_prompt(&PromptContext {
        base_branch,
        subjects: &subjects,
        recent_style: &recent_style,
        status: &status,
        stat: &stat,
        patch: &patch,
        template: template.as_deref(),
    });
    let result = oneshot::run(backend, worktree, &prompt).await;
    Ok(result.as_deref().and_then(parse).unwrap_or_else(fallback))
}
