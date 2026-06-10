//! GitHub issues over the `gh` CLI: the user's assigned open issues per repo,
//! plus lazy comment loading for the detail view.

use std::path::Path;

use serde::Serialize;
use serde_json::Value;
use specta::Type;

use crate::error::{AppError, Result};

use super::gh_command as gh;

/// An open issue assigned to the user, from `gh issue list`.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GhIssue {
    pub number: i64,
    pub title: String,
    pub url: String,
    pub body: String,
    pub labels: Vec<String>,
    pub author: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GhIssueComment {
    pub author: String,
    pub body: String,
    pub created_at: String,
}

fn author_login(value: Option<&Value>) -> String {
    value
        .and_then(|a| a.get("login"))
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string()
}

/// Open issues assigned to the user (empty when there's no remote / not a gh
/// repo / gh missing — pattern of `list_prs`).
pub fn list_assigned_issues(repo: &Path) -> Vec<GhIssue> {
    let Ok(out) = gh(
        repo,
        &[
            "issue",
            "list",
            "--assignee",
            "@me",
            "--state",
            "open",
            "--limit",
            "100",
            "--json",
            "number,title,url,labels,updatedAt,author,body",
        ],
    )
    .output() else {
        return Vec::new();
    };
    if !out.status.success() {
        return Vec::new();
    }
    serde_json::from_slice::<Value>(&out.stdout)
        .ok()
        .and_then(|v| v.as_array().cloned())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    Some(GhIssue {
                        number: item.get("number")?.as_i64()?,
                        title: item.get("title")?.as_str()?.to_string(),
                        url: item.get("url")?.as_str()?.to_string(),
                        body: item
                            .get("body")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                        labels: item
                            .get("labels")
                            .and_then(Value::as_array)
                            .map(|labels| {
                                labels
                                    .iter()
                                    .filter_map(|l| l.get("name")?.as_str().map(str::to_string))
                                    .collect()
                            })
                            .unwrap_or_default(),
                        author: author_login(item.get("author")),
                        updated_at: item
                            .get("updatedAt")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// All comments on an issue, oldest first (gh returns them in that order).
pub fn issue_comments(repo: &Path, number: i64) -> Result<Vec<GhIssueComment>> {
    let out = gh(
        repo,
        &["issue", "view", &number.to_string(), "--json", "comments"],
    )
    .output()
    .map_err(|e| AppError::Integration(format!("gh issue view: {e}")))?;
    if !out.status.success() {
        return Err(AppError::Integration(format!(
            "gh issue view failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        )));
    }
    let value: Value = serde_json::from_slice(&out.stdout)
        .map_err(|e| AppError::Integration(format!("gh issue view decode: {e}")))?;
    Ok(value
        .get("comments")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|item| GhIssueComment {
                    author: author_login(item.get("author")),
                    body: item
                        .get("body")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    created_at: item
                        .get("createdAt")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                })
                .collect()
        })
        .unwrap_or_default())
}
