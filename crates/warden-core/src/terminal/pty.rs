//! Spawns the user's default shell (or a provider CLI) in a PTY and streams its
//! output through a [`TerminalSink`]. The sink is generic so core stays Tauri-free:
//! the desktop shell adapts a `Channel<TerminalEvent>` to it in a one-line newtype.

use std::io::Read;
use std::thread;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};

use super::registry::{self, Session};
use crate::error::{AppError, Result};
use crate::util::drain_utf8;

/// Where a PTY's output and exit are delivered. The shell implements this over a
/// Tauri `Channel<TerminalEvent>`; core never names Tauri. `send_output` returns
/// `false` when the receiver is gone, which stops the reader thread.
pub trait TerminalSink: Send + 'static {
    fn send_output(&self, s: String) -> bool;
    fn send_exit(&self, code: Option<i32>);
}

/// Build the PTY command, started in `cwd`. With no `program`, runs the user's
/// default shell — Windows uses PowerShell; elsewhere `$SHELL` (falling back to
/// bash). When `program` is set (e.g. a provider's `claude`/`codex` CLI), it is
/// launched directly with `args` instead of the shell.
fn build_command(cwd: &str, program: Option<&str>, args: &[String]) -> CommandBuilder {
    let mut cmd = match program {
        Some(program) => {
            let mut cmd = CommandBuilder::new(program);
            cmd.args(args);
            cmd
        }
        None if cfg!(windows) => CommandBuilder::new("powershell.exe"),
        None => {
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
            CommandBuilder::new(shell)
        }
    };
    cmd.cwd(cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd
}

/// Open a PTY in `working_dir`, register it under `terminal_id`, and stream its
/// output to `sink` on a background reader thread. A PTY-level failure (open,
/// spawn, reader/writer setup) surfaces as [`AppError::Io`].
pub fn spawn(
    sink: impl TerminalSink,
    terminal_id: String,
    working_dir: String,
    command: Option<String>,
    args: Vec<String>,
    cols: u16,
    rows: u16,
) -> Result<()> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| AppError::Io(std::io::Error::other(format!("failed to open pty: {e}"))))?;

    let child = pair
        .slave
        .spawn_command(build_command(&working_dir, command.as_deref(), &args))
        .map_err(|e| {
            AppError::Io(std::io::Error::other(format!(
                "failed to launch terminal: {e}"
            )))
        })?;
    // Drop the slave in the parent so EOF is observed when the child exits.
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| AppError::Io(std::io::Error::other(format!("failed to read pty: {e}"))))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| AppError::Io(std::io::Error::other(format!("failed to write pty: {e}"))))?;

    registry::insert(
        terminal_id.clone(),
        Session {
            master: pair.master,
            writer,
            child,
        },
    );

    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut pending: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    let text = drain_utf8(&mut pending);
                    if !text.is_empty() && !sink.send_output(text) {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let code = registry::reap(&terminal_id);
        sink.send_exit(code);
    });

    Ok(())
}
