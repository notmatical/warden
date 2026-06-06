//! Interactive PTY terminal sessions — runs the native `claude` TUI inside the
//! app, distinct from the headless stream-json adapter in `agent`.

mod pty;
mod registry;

use serde::Serialize;
use specta::Type;

/// Streamed from a terminal's PTY to the frontend over a Tauri channel.
#[derive(Clone, Serialize, Type)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum TerminalEvent {
    Output { data: String },
    Exit { code: Option<i32> },
}

pub use pty::spawn;
pub use registry::{kill, kill_all, resize, write};

pub mod commands;
