//! Per-message chat attachments: files dropped on the composer. A file outside
//! the session's working dir is copied into a per-session attachments dir (which
//! the agent is always granted via `--add-dir`) so it can read it; a file
//! already inside the working dir is referenced in place. The agent reads them
//! with its own tools — paths in the message, no base64 — mirroring the desktop
//! apps.

use std::path::{Path, PathBuf};

use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, Result};
use crate::util::uuid;

const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"];

/// A staged attachment ready to reference in a message.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub name: String,
    /// The path the agent reads — in place, or the staged copy.
    pub path: String,
    pub is_image: bool,
    pub is_dir: bool,
}

/// The per-session directory staged attachments are copied into (created on
/// demand). Always granted to the agent so copied files are readable.
pub fn dir(app: &AppHandle, session_id: &str) -> Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Agent(format!("no app data dir: {e}")))?
        .join("attachments")
        .join(session_id);
    std::fs::create_dir_all(&dir).map_err(|e| AppError::Agent(e.to_string()))?;
    Ok(dir)
}

fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| IMAGE_EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// Stage dropped paths for a session: copy any file that lives outside the
/// working dir into the attachments dir; reference everything else in place.
pub fn stage(
    app: &AppHandle,
    session_id: &str,
    working_dir: &str,
    paths: &[String],
) -> Result<Vec<Attachment>> {
    let staged_dir = dir(app, session_id)?;
    let working = Path::new(working_dir);
    let mut out = Vec::with_capacity(paths.len());
    for raw in paths {
        let src = Path::new(raw);
        let is_dir = src.is_dir();
        let name = src
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| raw.clone());
        // In the working dir (or a directory) → already readable; reference as
        // is. Otherwise copy the file into the attachments dir.
        let effective = if is_dir || src.starts_with(working) {
            raw.clone()
        } else {
            let dest = staged_dir.join(format!("{}-{name}", &uuid()[..8]));
            std::fs::copy(src, &dest).map_err(|e| AppError::Agent(e.to_string()))?;
            dest.to_string_lossy().into_owned()
        };
        out.push(Attachment {
            id: uuid(),
            name,
            is_image: is_image(src),
            is_dir,
            path: effective,
        });
    }
    Ok(out)
}

/// The message-text reference line for an attachment path.
pub fn reference_line(path: &str) -> String {
    let p = Path::new(path);
    if p.is_dir() {
        format!("[Folder attached: {path} — use Glob and Read to explore it]")
    } else if is_image(p) {
        format!("[Image attached: {path} — use the Read tool to view it]")
    } else {
        format!("[File attached: {path} — use the Read tool to view it]")
    }
}
