//! GitHub issues over the `gh` CLI: the user's assigned open issues per repo,
//! plus lazy comment loading for the detail view.

use std::path::Path;

use serde::Serialize;
use serde_json::Value;
use specta::Type;

use crate::error::Result;

use super::{author_login, gh_json, str_field};

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

/// Open issues assigned to the user (empty when there's no remote / not a gh
/// repo / gh missing — pattern of [`super::pr::list_prs`]).
pub fn list_assigned_issues(repo: &Path) -> Vec<GhIssue> {
    let Ok(Some(value)) = gh_json(
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
    ) else {
        return Vec::new();
    };
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    Some(GhIssue {
                        number: item.get("number")?.as_i64()?,
                        title: item.get("title")?.as_str()?.to_string(),
                        url: item.get("url")?.as_str()?.to_string(),
                        body: str_field(item, "body").unwrap_or_default(),
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
                        updated_at: str_field(item, "updatedAt").unwrap_or_default(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// All comments on an issue, oldest first (gh returns them in that order).
pub fn issue_comments(repo: &Path, number: i64) -> Result<Vec<GhIssueComment>> {
    let Some(value) = gh_json(
        repo,
        &["issue", "view", &number.to_string(), "--json", "comments"],
    )?
    else {
        return Ok(Vec::new());
    };
    Ok(value
        .get("comments")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|item| GhIssueComment {
                    author: author_login(item.get("author")),
                    body: str_field(item, "body").unwrap_or_default(),
                    created_at: str_field(item, "createdAt").unwrap_or_default(),
                })
                .collect()
        })
        .unwrap_or_default())
}
