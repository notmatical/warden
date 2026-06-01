//! Global table of live PTY sessions. Each holds the master (for resize), a
//! writer (for input), and the child process handle (for kill/reap).

use std::collections::HashMap;
use std::io::Write;
use std::sync::{LazyLock, Mutex};

use portable_pty::{Child, MasterPty, PtySize};

use crate::error::{AppError, Result};

pub struct Session {
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn Child + Send + Sync>,
}

static SESSIONS: LazyLock<Mutex<HashMap<String, Session>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn lock() -> std::sync::MutexGuard<'static, HashMap<String, Session>> {
    SESSIONS.lock().unwrap_or_else(|p| p.into_inner())
}

pub fn insert(id: String, session: Session) {
    lock().insert(id, session);
}

pub fn write(id: &str, data: &str) -> Result<()> {
    let mut guard = lock();
    let session = guard
        .get_mut(id)
        .ok_or_else(|| AppError::NotFound(format!("terminal {id}")))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(AppError::Io)?;
    session.writer.flush().map_err(AppError::Io)?;
    Ok(())
}

pub fn resize(id: &str, cols: u16, rows: u16) -> Result<()> {
    let guard = lock();
    let session = guard
        .get(id)
        .ok_or_else(|| AppError::NotFound(format!("terminal {id}")))?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| AppError::Agent(format!("failed to resize terminal: {e}")))?;
    Ok(())
}

/// Kill a session's process and drop it. Returns whether one was present.
pub fn kill(id: &str) -> bool {
    if let Some(mut session) = lock().remove(id) {
        let _ = session.child.kill();
        true
    } else {
        false
    }
}

/// Remove a finished session and wait for its exit code (called by the reader
/// thread once the PTY reaches EOF).
pub fn reap(id: &str) -> Option<i32> {
    let session = lock().remove(id)?;
    let Session { mut child, .. } = session;
    child.wait().ok().map(|status| status.exit_code() as i32)
}

/// Kill every live terminal — used on app exit.
pub fn kill_all() {
    let mut guard = lock();
    for (_, mut session) in guard.drain() {
        let _ = session.child.kill();
    }
}
