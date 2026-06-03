//! Commands for the provider panel: list each agent CLI's install/auth status
//! and best-effort install/update via the user's package manager.

use std::process::Command;

use crate::error::{AppError, Result};
use crate::providers::{self, Provider, ProviderStatus};
use crate::util::silent_command;

/// The npm package that ships a provider's CLI.
fn npm_package(provider: Provider) -> &'static str {
    match provider {
        Provider::Claude => "@anthropic-ai/claude-code",
        Provider::Codex => "@openai/codex",
    }
}

#[tauri::command]
pub async fn list_provider_status() -> Result<Vec<ProviderStatus>> {
    providers::status_all().await
}

/// Install a provider's CLI globally via npm. Best-effort: surfaces the package
/// manager's error if it fails (e.g. npm missing or no network).
#[tauri::command]
pub async fn install_provider(id: String) -> Result<()> {
    npm_global(&id, false).await
}

/// Update a provider's CLI to the latest published version via npm.
#[tauri::command]
pub async fn update_provider(id: String) -> Result<()> {
    npm_global(&id, true).await
}

/// Run `npm install -g <pkg>` (or `<pkg>@latest` for updates) off the async
/// runtime. npm shells out through `cmd` on Windows.
async fn npm_global(id: &str, latest: bool) -> Result<()> {
    let provider = Provider::parse(id)
        .ok_or_else(|| AppError::Invalid(format!("unknown provider: {id}")))?;
    let pkg = npm_package(provider);
    let spec = if latest {
        format!("{pkg}@latest")
    } else {
        pkg.to_string()
    };

    tauri::async_runtime::spawn_blocking(move || run_npm_install(&spec))
        .await
        .map_err(|e| AppError::Agent(format!("install task failed: {e}")))?
}

fn run_npm_install(spec: &str) -> Result<()> {
    let mut cmd = if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.args(["/C", "npm", "install", "-g", spec]);
        c
    } else {
        let mut c = Command::new("npm");
        c.args(["install", "-g", spec]);
        c
    };

    let output = silent_command(&mut cmd)
        .output()
        .map_err(|e| AppError::Agent(format!("failed to run npm: {e}")))?;

    if output.status.success() {
        return Ok(());
    }
    let detail = String::from_utf8_lossy(&output.stderr);
    let detail = detail.trim();
    Err(AppError::Agent(if detail.is_empty() {
        format!("npm install -g {spec} failed")
    } else {
        detail.to_string()
    }))
}
