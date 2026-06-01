//! Data sources for composer mentions: `@` files, `/` commands, and `#` GitHub
//! issue/PR references.

use std::path::{Path, PathBuf};
use std::process::Command;

use ignore::WalkBuilder;
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, Result};

const MAX_FILES: usize = 5000;
const GH_LIMIT: &str = "50";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    /// Path relative to the working directory, using forward slashes.
    pub path: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlashCommand {
    pub name: String,
    pub description: Option<String>,
    /// "project" or "user".
    pub scope: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoRef {
    pub number: u64,
    pub title: String,
    /// "issue" or "pr".
    pub kind: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoRefBody {
    pub title: String,
    pub body: String,
}

/// List files in the working directory, honoring .gitignore. Runs on a blocking
/// thread since the walk touches the filesystem.
#[tauri::command]
pub async fn list_files(working_dir: String, max: Option<usize>) -> Result<Vec<FileEntry>> {
    let limit = max.unwrap_or(MAX_FILES);
    tauri::async_runtime::spawn_blocking(move || walk_files(&working_dir, limit))
        .await
        .map_err(|e| AppError::Invalid(format!("file walk failed: {e}")))
}

fn walk_files(working_dir: &str, max: usize) -> Vec<FileEntry> {
    let root = Path::new(working_dir);
    let mut out = Vec::new();

    let walker = WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .require_git(false)
        .build();

    for entry in walker.flatten() {
        if out.len() >= max {
            break;
        }
        let path = entry.path();
        if path == root || path.components().any(|c| c.as_os_str() == ".git") {
            continue;
        }
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let rel = path.strip_prefix(root).unwrap_or(path);
        out.push(FileEntry {
            path: rel.to_string_lossy().replace('\\', "/"),
            name: path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
        });
    }

    out
}

/// List custom slash commands from `.claude/commands` (project, then user).
#[tauri::command]
pub async fn list_commands(app: AppHandle, working_dir: String) -> Result<Vec<SlashCommand>> {
    let mut out = Vec::new();
    collect_commands(
        Path::new(&working_dir).join(".claude").join("commands"),
        "project",
        &mut out,
    );
    if let Ok(home) = app.path().home_dir() {
        collect_commands(home.join(".claude").join("commands"), "user", &mut out);
    }
    Ok(out)
}

fn collect_commands(dir: PathBuf, scope: &str, out: &mut Vec<SlashCommand>) {
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let Some(name) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        out.push(SlashCommand {
            name: name.to_string(),
            description: command_description(&path),
            scope: scope.to_string(),
        });
    }
}

/// First meaningful line of a command file (skipping frontmatter and headings).
fn command_description(path: &Path) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    content
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && *line != "---" && !line.starts_with('#'))
        .map(|line| line.to_string())
}

/// List open issues and PRs for the repo via the `gh` CLI. Returns an empty
/// list (never an error) when gh is unavailable or the dir isn't a gh repo.
#[tauri::command]
pub async fn list_repo_refs(working_dir: String) -> Result<Vec<RepoRef>> {
    let mut out = gh_list(&working_dir, "issue");
    out.extend(gh_list(&working_dir, "pr"));
    Ok(out)
}

fn gh_list(working_dir: &str, kind: &str) -> Vec<RepoRef> {
    let output = Command::new("gh")
        .current_dir(working_dir)
        .args([kind, "list", "--json", "number,title", "--limit", GH_LIMIT])
        .output();
    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    let parsed: serde_json::Value = match serde_json::from_slice(&output.stdout) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    parsed
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    Some(RepoRef {
                        number: item.get("number")?.as_u64()?,
                        title: item.get("title")?.as_str()?.to_string(),
                        kind: if kind == "pr" { "pr" } else { "issue" }.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Fetch the title and body of a single issue or PR via the `gh` CLI.
#[tauri::command]
pub async fn fetch_repo_ref(
    working_dir: String,
    kind: String,
    number: u64,
) -> Result<RepoRefBody> {
    let sub = if kind == "pr" { "pr" } else { "issue" };
    let output = Command::new("gh")
        .current_dir(&working_dir)
        .args([sub, "view", &number.to_string(), "--json", "title,body"])
        .output()?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Invalid(format!(
            "gh {sub} view {number} failed: {}",
            stderr.trim()
        )));
    }
    let parsed: serde_json::Value = serde_json::from_slice(&output.stdout)?;
    Ok(RepoRefBody {
        title: parsed
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        body: parsed
            .get("body")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
    })
}
