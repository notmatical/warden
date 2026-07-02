//! `#`-mention data: a repo's open issues and PRs, and the title/body/comments of
//! a single one, over the `gh` CLI. Soft-fails to an empty list when gh is
//! unavailable or the dir isn't a gh repo.

use std::path::Path;

use serde::Serialize;
use serde_json::Value;
use specta::Type;
use strum::{EnumString, IntoStaticStr};

use crate::error::{AppError, Result};
use crate::integrations::github::{gh_command, gh_json};

const GH_LIMIT: &str = "50";

/// How many of an issue/PR's comments to inject, and the per-comment char cap —
/// enough for context without flooding the prompt.
const MAX_COMMENTS: usize = 5;
const MAX_COMMENT_CHARS: usize = 600;

/// Whether a `#`-reference points at an issue or a pull request. Drives which
/// `gh` subcommand to call.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type, EnumString, IntoStaticStr)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case", ascii_case_insensitive)]
pub enum RefKind {
    Issue,
    Pr,
}

impl RefKind {
    pub fn as_str(self) -> &'static str {
        self.into()
    }

    /// Parse the frontend's token, defaulting to `Issue` for anything but `pr`
    /// (mirrors the original `if kind == "pr"` branch).
    pub fn parse(s: &str) -> Self {
        if s.eq_ignore_ascii_case("pr") {
            RefKind::Pr
        } else {
            RefKind::Issue
        }
    }

    /// The `gh` subcommand for this kind (`issue` / `pr`).
    fn subcommand(self) -> &'static str {
        match self {
            RefKind::Issue => "issue",
            RefKind::Pr => "pr",
        }
    }
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RepoRef {
    pub number: u64,
    pub title: String,
    pub kind: RefKind,
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RepoComment {
    pub author: String,
    pub body: String,
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RepoRefBody {
    pub title: String,
    pub body: String,
    pub comments: Vec<RepoComment>,
}

/// Open issues and PRs for the repo at `working_dir`. Empty (never an error) when
/// gh is unavailable or the dir isn't a gh repo.
pub fn list_repo_refs(working_dir: &Path) -> Vec<RepoRef> {
    let mut out = gh_list(working_dir, RefKind::Issue);
    out.extend(gh_list(working_dir, RefKind::Pr));
    out
}

fn gh_list(working_dir: &Path, kind: RefKind) -> Vec<RepoRef> {
    let Ok(Some(value)) = gh_json(
        working_dir,
        &[
            kind.subcommand(),
            "list",
            "--json",
            "number,title",
            "--limit",
            GH_LIMIT,
        ],
    ) else {
        return Vec::new();
    };
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    Some(RepoRef {
                        number: item.get("number")?.as_u64()?,
                        title: item.get("title")?.as_str()?.to_string(),
                        kind,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The title, body, and most recent few comments of a single issue or PR. Errors
/// when `gh ... view` fails (unlike the list path, a referenced ref is expected
/// to exist).
pub fn fetch_repo_ref(working_dir: &Path, kind: RefKind, number: u64) -> Result<RepoRefBody> {
    let sub = kind.subcommand();
    let out = gh_command(
        working_dir,
        &[
            sub,
            "view",
            &number.to_string(),
            "--json",
            "title,body,comments",
        ],
        None,
    )
    .output()
    .map_err(|e| AppError::Integration(format!("failed to run gh: {e}")))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(AppError::Integration(format!(
            "gh {sub} view {number} failed: {}",
            stderr.trim()
        )));
    }
    let parsed: Value = serde_json::from_slice(&out.stdout)?;
    let str_field = |key: &str| {
        parsed
            .get(key)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string()
    };
    // gh shapes comments as `[{ author: { login }, body }]`; take the most recent
    // few, clipped, as grounding for the agent.
    let comments = parsed
        .get("comments")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .rev()
                .take(MAX_COMMENTS)
                .map(|c| RepoComment {
                    author: c
                        .get("author")
                        .and_then(|a| a.get("login"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("someone")
                        .to_string(),
                    body: c
                        .get("body")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .chars()
                        .take(MAX_COMMENT_CHARS)
                        .collect(),
                })
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect()
        })
        .unwrap_or_default();
    Ok(RepoRefBody {
        title: str_field("title"),
        body: str_field("body"),
        comments,
    })
}
