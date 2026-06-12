//! Commands for opening a directory in external apps (editor, terminal, file
//! manager) — the titlebar's "open in…" menu. Editors and terminals come from
//! a known-app registry probed against this machine, so the menu only offers
//! what's actually installed.

use std::path::Path;
use std::process::Command;

use serde::Serialize;
use specta::Type;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::error::{AppError, CommandResult, Result};

/// An app warden knows how to detect and launch. `bin` is the CLI on PATH
/// (all platforms; empty when the app has no CLI); `mac_app` is the
/// application-bundle name used on macOS, where CLIs are often not installed.
struct AppDef {
    id: &'static str,
    name: &'static str,
    bin: &'static str,
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    mac_app: &'static str,
}

const EDITORS: &[AppDef] = &[
    AppDef {
        id: "vscode",
        name: "VS Code",
        bin: "code",
        mac_app: "Visual Studio Code",
    },
    AppDef {
        id: "vscode-insiders",
        name: "VS Code Insiders",
        bin: "code-insiders",
        mac_app: "Visual Studio Code - Insiders",
    },
    AppDef {
        id: "cursor",
        name: "Cursor",
        bin: "cursor",
        mac_app: "Cursor",
    },
    AppDef {
        id: "zed",
        name: "Zed",
        bin: "zed",
        mac_app: "Zed",
    },
    AppDef {
        id: "sublime",
        name: "Sublime Text",
        bin: "subl",
        mac_app: "Sublime Text",
    },
    AppDef {
        id: "idea",
        name: "IntelliJ IDEA",
        bin: "idea",
        mac_app: "IntelliJ IDEA",
    },
    AppDef {
        id: "webstorm",
        name: "WebStorm",
        bin: "webstorm",
        mac_app: "WebStorm",
    },
    AppDef {
        id: "pycharm",
        name: "PyCharm",
        bin: "pycharm",
        mac_app: "PyCharm",
    },
    AppDef {
        id: "rider",
        name: "Rider",
        bin: "rider",
        mac_app: "Rider",
    },
    AppDef {
        id: "goland",
        name: "GoLand",
        bin: "goland",
        mac_app: "GoLand",
    },
    AppDef {
        id: "clion",
        name: "CLion",
        bin: "clion",
        mac_app: "CLion",
    },
    AppDef {
        id: "rustrover",
        name: "RustRover",
        bin: "rustrover",
        mac_app: "RustRover",
    },
    AppDef {
        id: "fleet",
        name: "Fleet",
        bin: "fleet",
        mac_app: "Fleet",
    },
    AppDef {
        id: "antigravity",
        name: "Antigravity",
        bin: "antigravity",
        mac_app: "Antigravity",
    },
];

fn find_app(registry: &'static [AppDef], id: &str) -> Option<&'static AppDef> {
    registry.iter().find(|a| a.id == id)
}

/// Whether an app is installed here: its CLI resolves on PATH, or (macOS)
/// its application bundle exists.
fn app_installed(def: &AppDef) -> bool {
    if !def.bin.is_empty() && which::which(def.bin).is_ok() {
        return true;
    }
    #[cfg(target_os = "macos")]
    {
        if def.mac_app.is_empty() {
            return false;
        }
        let bundle = format!("{}.app", def.mac_app);
        if Path::new("/Applications").join(&bundle).exists() {
            return true;
        }
        if let Some(home) = crate::util::home_dir() {
            return home.join("Applications").join(&bundle).exists();
        }
    }
    false
}

/// One installed editor, surfaced to the "open in…" menu.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OpenApp {
    pub id: String,
    pub name: String,
}

/// The editors installed on this machine, in registry order. The folder and
/// terminal targets are always available and not listed here (the terminal
/// opens the OS default).
#[tauri::command]
#[specta::specta]
pub async fn list_open_apps() -> CommandResult<Vec<OpenApp>> {
    let apps = tauri::async_runtime::spawn_blocking(|| {
        EDITORS
            .iter()
            .filter(|def| app_installed(def))
            .map(|def| OpenApp {
                id: def.id.to_string(),
                name: def.name.to_string(),
            })
            .collect::<Vec<_>>()
    })
    .await
    .map_err(|e| AppError::Agent(format!("app probe failed: {e}")))?;
    Ok(apps)
}

/// Open `path` in an external app selected by `target`: `"folder"`,
/// `"terminal"` (the OS default), or an editor id from [`list_open_apps`].
#[tauri::command]
#[specta::specta]
pub async fn open_in(app: AppHandle, target: String, path: String) -> CommandResult<()> {
    if !Path::new(&path).exists() {
        return Err(AppError::NotFound(format!("path does not exist: {path}")).into());
    }

    match target.as_str() {
        "folder" => app
            .opener()
            .open_path(path, None::<&str>)
            .map_err(|e| AppError::Agent(format!("failed to open folder: {e}")).into()),
        "terminal" => open_terminal(&path).map_err(Into::into),
        other => match find_app(EDITORS, other) {
            Some(def) => open_editor(def, &path).map_err(Into::into),
            None => Err(AppError::Invalid(format!("unknown open target: {other}")).into()),
        },
    }
}

/// Launch an editor: its CLI resolved on PATH (handles Windows shims), or the
/// macOS application bundle when no CLI is installed.
fn open_editor(def: &AppDef, path: &str) -> Result<()> {
    if let Ok(exe) = which::which(def.bin) {
        Command::new(exe)
            .arg(path)
            .spawn()
            .map_err(|e| AppError::Agent(format!("failed to launch {}: {e}", def.name)))?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-a", def.mac_app, path])
            .spawn()
            .map_err(|e| AppError::Agent(format!("failed to launch {}: {e}", def.name)))?;
        return Ok(());
    }
    #[cfg(not(target_os = "macos"))]
    Err(AppError::NotFound(format!(
        "`{}` was not found on PATH",
        def.bin
    )))
}

/// Prefer Windows Terminal when installed; fall back to a PowerShell window.
#[cfg(windows)]
fn open_terminal(path: &str) -> Result<()> {
    if let Ok(wt) = which::which("wt") {
        if Command::new(wt).args(["-d", path]).spawn().is_ok() {
            return Ok(());
        }
    }
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

/// Linux has no canonical terminal: honor the user's `$TERMINAL`, then the
/// Debian alternatives shim, then well-known emulators with their workdir
/// flag. `current_dir` covers the flagless entries.
#[cfg(all(not(windows), not(target_os = "macos")))]
fn open_terminal(path: &str) -> Result<()> {
    let user_term = std::env::var("TERMINAL").unwrap_or_default();
    let candidates: [(&str, &[&str]); 10] = [
        (user_term.as_str(), &[]),
        ("x-terminal-emulator", &[]),
        ("gnome-terminal", &["--working-directory", path]),
        ("konsole", &["--workdir", path]),
        ("xfce4-terminal", &["--working-directory", path]),
        ("kitty", &["--directory", path]),
        ("alacritty", &["--working-directory", path]),
        ("wezterm", &["start", "--cwd", path]),
        ("ghostty", &[]),
        ("xterm", &[]),
    ];
    for (bin, args) in candidates {
        if bin.is_empty() {
            continue;
        }
        let Ok(exe) = which::which(bin) else {
            continue;
        };
        if Command::new(exe)
            .args(args)
            .current_dir(path)
            .spawn()
            .is_ok()
        {
            return Ok(());
        }
    }
    Err(AppError::NotFound(
        "no terminal emulator found; set $TERMINAL to your preferred one".into(),
    ))
}
