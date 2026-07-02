//! Detached agent process registrations for survive-and-reattach. `proc_id` is a
//! per-spawn generation, so a stale tailer can't clobber a newer spawn's row.

use crate::error::Result;

use super::mappers::map_agent_proc;
use super::{query_vec, Store};

/// A detached agent process registered for survive-and-reattach.
pub struct AgentProc {
    pub session_id: String,
    pub proc_id: String,
    pub pid: u32,
    pub out_file: String,
    pub err_file: String,
    pub out_offset: u64,
    pub spawned_at: String,
}

impl Store {
    /// Register a freshly spawned detached agent process (replacing any prior
    /// generation for the session).
    pub fn upsert_agent_proc(&self, proc: &AgentProc) -> Result<()> {
        self.lock().execute(
            "INSERT INTO agent_procs (session_id, proc_id, pid, out_file, err_file, out_offset, spawned_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(session_id) DO UPDATE SET
               proc_id = ?2, pid = ?3, out_file = ?4, err_file = ?5, out_offset = ?6, spawned_at = ?7",
            (
                &proc.session_id,
                &proc.proc_id,
                proc.pid,
                &proc.out_file,
                &proc.err_file,
                proc.out_offset as i64,
                &proc.spawned_at,
            ),
        )?;
        Ok(())
    }

    pub fn list_agent_procs(&self) -> Result<Vec<AgentProc>> {
        query_vec(
            &self.lock(),
            "SELECT session_id, proc_id, pid, out_file, err_file, out_offset, spawned_at
             FROM agent_procs",
            [],
            map_agent_proc,
        )
    }

    /// Remove a proc registration — only if this spawn generation still owns
    /// the row, so a stale tailer can't clobber a respawn's bookkeeping.
    pub fn delete_agent_proc(&self, session_id: &str, proc_id: &str) -> Result<()> {
        self.lock().execute(
            "DELETE FROM agent_procs WHERE session_id = ?1 AND proc_id = ?2",
            (session_id, proc_id),
        )?;
        Ok(())
    }

    /// Whether this spawn generation still owns the session's proc row (a newer
    /// spawn replaces it; deletion removes it).
    pub fn agent_proc_current(&self, session_id: &str, proc_id: &str) -> Result<bool> {
        let n: i64 = self.lock().query_row(
            "SELECT COUNT(*) FROM agent_procs WHERE session_id = ?1 AND proc_id = ?2",
            (session_id, proc_id),
            |r| r.get(0),
        )?;
        Ok(n > 0)
    }
}
