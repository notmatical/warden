//! Data sources for composer mentions: `@` files, `/` commands, and `#` GitHub
//! issue/PR references.

use std::collections::HashSet;
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
pub struct RepoComment {
    pub author: String,
    pub body: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoRefBody {
    pub title: String,
    pub body: String,
    pub comments: Vec<RepoComment>,
}

/// How many of an issue/PR's comments to inject, and the per-comment char cap —
/// enough for context without flooding the prompt.
const MAX_COMMENTS: usize = 5;
const MAX_COMMENT_CHARS: usize = 600;

/// A `gh` command in `working_dir`, run through the managed binary with the
/// brokered token and no console flash on Windows.
fn gh_cmd(working_dir: &str, args: &[&str]) -> Command {
    let mut cmd = Command::new(crate::cli::resolve(crate::cli::Tool::Gh));
    crate::platform::silent_command(&mut cmd);
    cmd.current_dir(working_dir).args(args);
    if let Some(token) = crate::github::resolve_token() {
        cmd.env("GH_TOKEN", token);
    }
    cmd
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

/// List `/`-invocable items: custom commands from `.claude/commands` and skills
/// from `.claude/skills`, both project- and user-level. Names are deduped, with
/// project entries winning over user entries.
#[tauri::command]
pub async fn list_commands(app: AppHandle, working_dir: String) -> Result<Vec<SlashCommand>> {
    let project = Path::new(&working_dir).join(".claude");
    let home_claude = app.path().home_dir().ok().map(|h| h.join(".claude"));

    let mut out = Vec::new();
    let mut seen = HashSet::new();

    collect_commands(project.join("commands"), "project", &mut out, &mut seen);
    if let Some(claude) = &home_claude {
        collect_commands(claude.join("commands"), "user", &mut out, &mut seen);
    }
    collect_skills(project.join("skills"), &mut out, &mut seen);
    if let Some(claude) = &home_claude {
        collect_skills(claude.join("skills"), &mut out, &mut seen);
    }

    Ok(out)
}

fn collect_commands(
    dir: PathBuf,
    scope: &str,
    out: &mut Vec<SlashCommand>,
    seen: &mut HashSet<String>,
) {
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
        if !seen.insert(name.to_string()) {
            continue;
        }
        out.push(SlashCommand {
            name: name.to_string(),
            description: command_description(&path),
            scope: scope.to_string(),
        });
    }
}

/// Skills are subdirectories containing a `SKILL.md`.
fn collect_skills(dir: PathBuf, out: &mut Vec<SlashCommand>, seen: &mut HashSet<String>) {
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let skill_md = path.join("SKILL.md");
        if !path.is_dir() || !skill_md.exists() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if !seen.insert(name.to_string()) {
            continue;
        }
        out.push(SlashCommand {
            name: name.to_string(),
            description: skill_description(&skill_md),
            scope: "skill".to_string(),
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

/// The `description:` field from a SKILL.md YAML frontmatter, clipped for display.
fn skill_description(skill_md: &Path) -> Option<String> {
    let content = std::fs::read_to_string(skill_md).ok()?;
    let mut in_frontmatter = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == "---" {
            if in_frontmatter {
                break;
            }
            in_frontmatter = true;
            continue;
        }
        if in_frontmatter {
            if let Some(rest) = trimmed.strip_prefix("description:") {
                let value = rest.trim().trim_matches(['"', '\'']).trim();
                if !value.is_empty() {
                    return Some(value.chars().take(120).collect());
                }
            }
        }
    }
    None
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
    let output = gh_cmd(
        working_dir,
        &[kind, "list", "--json", "number,title", "--limit", GH_LIMIT],
    )
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
pub async fn fetch_repo_ref(working_dir: String, kind: String, number: u64) -> Result<RepoRefBody> {
    let sub = if kind == "pr" { "pr" } else { "issue" };
    let output = gh_cmd(
        &working_dir,
        &[
            sub,
            "view",
            &number.to_string(),
            "--json",
            "title,body,comments",
        ],
    )
    .output()?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Invalid(format!(
            "gh {sub} view {number} failed: {}",
            stderr.trim()
        )));
    }
    let parsed: serde_json::Value = serde_json::from_slice(&output.stdout)?;
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
