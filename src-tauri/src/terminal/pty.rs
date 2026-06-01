//! Spawns an interactive `claude` process in a PTY and streams its output to
//! the frontend over a Tauri channel.

use std::io::Read;
use std::thread;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::ipc::Channel;

use super::registry::{self, Session};
use super::TerminalEvent;
use crate::error::{AppError, Result};

/// Build the command the PTY runs. On Windows `claude` is a `.cmd` shim, which
/// ConPTY can't exec directly, so go through `cmd /c`.
fn build_command(cwd: &str) -> Result<CommandBuilder> {
    let mut cmd = if cfg!(windows) {
        let mut c = CommandBuilder::new("cmd");
        c.args(["/c", "claude"]);
        c
    } else {
        let bin = which::which("claude")
            .map_err(|_| AppError::NotFound("`claude` was not found on PATH".to_string()))?;
        CommandBuilder::new(bin)
    };
    cmd.cwd(cwd);
    cmd.env("TERM", "xterm-256color");
    Ok(cmd)
}

pub fn spawn(
    on_output: Channel<TerminalEvent>,
    terminal_id: String,
    working_dir: String,
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
        .map_err(|e| AppError::Agent(format!("failed to open pty: {e}")))?;

    let child = pair
        .slave
        .spawn_command(build_command(&working_dir)?)
        .map_err(|e| AppError::Agent(format!("failed to launch claude: {e}")))?;
    // Drop the slave in the parent so EOF is observed when the child exits.
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| AppError::Agent(format!("failed to read pty: {e}")))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| AppError::Agent(format!("failed to write pty: {e}")))?;

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
                    if !text.is_empty()
                        && on_output
                            .send(TerminalEvent::Output { data: text })
                            .is_err()
                    {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let code = registry::reap(&terminal_id);
        let _ = on_output.send(TerminalEvent::Exit { code });
    });

    Ok(())
}

/// Decode the valid UTF-8 prefix of `pending`, leaving any incomplete trailing
/// bytes for the next read. Invalid sequences become a replacement char.
fn drain_utf8(pending: &mut Vec<u8>) -> String {
    match std::str::from_utf8(pending) {
        Ok(s) => {
            let out = s.to_string();
            pending.clear();
            out
        }
        Err(e) => {
            let valid = e.valid_up_to();
            let mut out = String::new();
            if valid > 0 {
                // Safe: `valid` is a UTF-8 boundary per `valid_up_to`.
                out.push_str(unsafe { std::str::from_utf8_unchecked(&pending[..valid]) });
            }
            match e.error_len() {
                Some(bad) => {
                    out.push('\u{FFFD}');
                    pending.drain(..valid + bad);
                    out.push_str(&drain_utf8(pending));
                }
                None => {
                    pending.drain(..valid);
                }
            }
            out
        }
    }
}
