//! Interactive PTY terminal sessions — runs the native `claude` TUI inside the
//! app, distinct from the headless stream-json adapter in `agent`.
//!
//! Tauri-free: [`pty::spawn`] streams through the [`TerminalSink`] trait, which
//! the desktop shell adapts to a `Channel<TerminalEvent>`. The shell's command
//! wrappers (resolving the channel, building [`recipe::RecipeDeps`] from the
//! providers tier) live above this module.

mod pty;
mod recipe;
mod registry;

use serde::Serialize;
use specta::Type;

/// Streamed from a terminal's PTY to the frontend. A plain serde payload — the
/// shell carries it over a Tauri channel; core only fills it.
#[derive(Clone, Serialize, Type)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum TerminalEvent {
    Output { data: String },
    Exit { code: Option<i32> },
}

pub use pty::{spawn, TerminalSink};
pub use recipe::{bind_resume_id, launch_recipe, RecipeDeps};
pub use registry::{kill, kill_all, resize, write};
