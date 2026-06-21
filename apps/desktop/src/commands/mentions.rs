//! Mention-source command wrappers: `@` files, `/` commands, `#` GitHub refs.
//! The shell resolves the working dir + the user's `~/.claude`, then hands paths
//! to the Tauri-free `warden_core::mentions` service.

use std::path::Path;

use tauri::{AppHandle, Manager};

use warden_core::mentions::{
    self, FileEntry, RefKind, RepoRef, RepoRefBody, SlashCommand, MAX_FILES,
};
use warden_core::{AppError, CommandResult};

/// List files in the working directory, honoring .gitignore. Runs on a blocking
/// thread since the walk touches the filesystem.
#[tauri::command]
#[specta::specta]
pub async fn list_files(working_dir: String, max: Option<usize>) -> CommandResult<Vec<FileEntry>> {
    let limit = max.unwrap_or(MAX_FILES);
    tauri::async_runtime::spawn_blocking(move || mentions::walk_files(&working_dir, limit))
        .await
        .map_err(|e| AppError::Invalid(format!("file walk failed: {e}")).into())
}

/// List `/`-invocable items: custom commands from `.claude/commands` and skills
/// from `.claude/skills`, both project- and user-level. The shell resolves the
/// user's home `.claude`; core walks the directories.
#[tauri::command]
#[specta::specta]
pub async fn list_commands(
    app: AppHandle,
    working_dir: String,
) -> CommandResult<Vec<SlashCommand>> {
    let project_claude = Path::new(&working_dir).join(".claude");
    let user_claude = app.path().home_dir().ok().map(|h| h.join(".claude"));
    Ok(mentions::list_commands(
        &project_claude,
        user_claude.as_deref(),
    ))
}

/// List open issues and PRs for the repo via the `gh` CLI. Returns an empty
/// list (never an error) when gh is unavailable or the dir isn't a gh repo.
#[tauri::command]
#[specta::specta]
pub async fn list_repo_refs(working_dir: String) -> CommandResult<Vec<RepoRef>> {
    Ok(mentions::list_repo_refs(Path::new(&working_dir)))
}

/// Fetch the title and body of a single issue or PR via the `gh` CLI.
#[tauri::command]
#[specta::specta]
pub async fn fetch_repo_ref(
    working_dir: String,
    kind: String,
    number: u64,
) -> CommandResult<RepoRefBody> {
    mentions::fetch_repo_ref(Path::new(&working_dir), RefKind::parse(&kind), number)
        .map_err(Into::into)
}
