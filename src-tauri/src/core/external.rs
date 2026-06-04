//! Commands for opening a directory in external apps (editor, terminal, file
//! manager) — the header's "open in…" button group.

use std::path::Path;
use std::process::Command;

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::error::{AppError, Result};

/// Open `path` in an external app selected by `target`:
/// `"folder"`, `"terminal"`, `"zed"`, or `"vscode"`.
#[tauri::command]
pub async fn open_in(app: AppHandle, target: String, path: String) -> Result<()> {
    if !Path::new(&path).exists() {
        return Err(AppError::NotFound(format!("path does not exist: {path}")));
    }

    match target.as_str() {
        "folder" => app
            .opener()
            .open_path(path, None::<&str>)
            .map_err(|e| AppError::Agent(format!("failed to open folder: {e}"))),
        "terminal" => open_terminal(&path),
        "zed" => open_editor("zed", &path),
        "vscode" => open_editor("code", &path),
        other => Err(AppError::Invalid(format!("unknown open target: {other}"))),
    }
}

/// Launch an editor by its CLI name, resolved on PATH (handles Windows shims).
fn open_editor(bin: &str, path: &str) -> Result<()> {
    let exe = which::which(bin)
        .map_err(|_| AppError::NotFound(format!("`{bin}` was not found on PATH")))?;
    Command::new(exe)
        .arg(path)
        .spawn()
        .map_err(|e| AppError::Agent(format!("failed to launch {bin}: {e}")))?;
    Ok(())
}

#[cfg(windows)]
fn open_terminal(path: &str) -> Result<()> {
    Command::new("cmd")
        .args(["/C", "start", "powershell"])
        .current_dir(path)
        .spawn()
        .map_err(|e| AppError::Agent(format!("failed to open terminal: {e}")))?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn open_terminal(path: &str) -> Result<()> {
    Command::new("open")
        .args(["-a", "Terminal", path])
        .spawn()
        .map_err(|e| AppError::Agent(format!("failed to open terminal: {e}")))?;
    Ok(())
}

#[cfg(all(not(windows), not(target_os = "macos")))]
fn open_terminal(path: &str) -> Result<()> {
    Command::new("x-terminal-emulator")
        .current_dir(path)
        .spawn()
        .map_err(|e| AppError::Agent(format!("failed to open terminal: {e}")))?;
    Ok(())
}
