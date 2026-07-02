//! Process introspection and tree-kill, used by agent-process recovery and
//! reattach. Shells out (`taskkill`/`pgrep`/`tasklist`/`ps`) so we need no
//! process-inspection crate; callers use these at startup recovery and on a slow
//! reattach poll, never in a hot loop.

use std::process::Command;

use super::silent_command;

/// Best-effort kill of a process *and its descendants*. The agent CLI is often
/// a shim/wrapper that spawns `node`; terminating only the direct child (e.g.
/// via `Child::start_kill`) orphans `node`, which keeps streaming to the
/// inherited pipe and holds the Claude session lock. Windows tears the tree
/// down with `taskkill /T`; Unix walks children via `pgrep -P` depth-first
/// (children before parent, so nothing respawns or reparents mid-walk).
pub fn kill_process_tree(pid: u32) {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("taskkill");
        cmd.args(["/F", "/T", "/PID", &pid.to_string()]);
        let _ = silent_command(&mut cmd).output();
    }
    #[cfg(unix)]
    {
        fn kill_recursive(pid: u32) {
            if let Ok(out) = Command::new("pgrep")
                .args(["-P", &pid.to_string()])
                .output()
            {
                for child in String::from_utf8_lossy(&out.stdout).split_whitespace() {
                    if let Ok(child_pid) = child.parse::<u32>() {
                        kill_recursive(child_pid);
                    }
                }
            }
            let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
        }
        kill_recursive(pid);
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = pid;
    }
}

/// The executable name behind `pid`, if such a process is running.
pub fn process_name(pid: u32) -> Option<String> {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("tasklist");
        cmd.args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"]);
        let output = silent_command(&mut cmd).output().ok()?;
        let text = String::from_utf8_lossy(&output.stdout);
        // CSV row: "name","pid",... — anything else means no match.
        let name = text.trim().strip_prefix('"')?.split('"').next()?;
        Some(name.to_string())
    }
    #[cfg(not(windows))]
    {
        let mut cmd = Command::new("ps");
        cmd.args(["-p", &pid.to_string(), "-o", "comm="]);
        let output = silent_command(&mut cmd).output().ok()?;
        if !output.status.success() {
            return None;
        }
        let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
        (!name.is_empty()).then_some(name)
    }
}

/// Whether a process with `pid` is currently running.
pub fn process_alive(pid: u32) -> bool {
    process_name(pid).is_some()
}
