mod migrations;

use std::path::Path;
use std::sync::{Arc, Mutex};

use rusqlite::{Connection, OptionalExtension, Row};

use crate::domain::{
    AgentEvent, Backend, EffortLevel, EventRecord, PermissionMode, Session, SessionRole,
    SessionStatus, Workspace,
};
use crate::error::{AppError, Result};
use crate::util::{now_rfc3339, uuid};

/// Fields required to create a session row. Keeps the insert call readable
/// instead of a dozen positional arguments.
pub struct NewSession {
    pub workspace_id: String,
    pub title: String,
    pub backend: Backend,
    pub model: String,
    pub permission_mode: PermissionMode,
    pub effort: EffortLevel,
    pub role: SessionRole,
    pub auto_named: bool,
    pub agent_session_id: String,
    pub working_dir: String,
    pub branch: Option<String>,
    pub base_sha: Option<String>,
    pub is_isolated: bool,
    pub parent_id: Option<String>,
}

/// Thread-safe handle to the SQLite database. Cloneable and `Send + Sync` so it
/// can be shared with background turn tasks. All access is serialized through a
/// mutex, which suits SQLite's single-writer model.
#[derive(Clone)]
pub struct Store {
    conn: Arc<Mutex<Connection>>,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        migrations::run(&conn)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        // A poisoned mutex means a prior holder panicked; recovering the guard
        // is correct here since our writes are independent and idempotent.
        self.conn.lock().unwrap_or_else(|p| p.into_inner())
    }

    // ----- workspaces -------------------------------------------------------

    pub fn upsert_workspace(&self, name: &str, path: &str, is_git: bool) -> Result<Workspace> {
        let conn = self.lock();
        if let Some(existing) = conn
            .query_row(
                "SELECT id, name, path, is_git, created_at FROM workspaces WHERE path = ?1",
                [path],
                map_workspace,
            )
            .optional()?
        {
            return Ok(existing);
        }

        let workspace = Workspace {
            id: uuid(),
            name: name.to_string(),
            path: path.to_string(),
            is_git,
            created_at: now_rfc3339(),
        };
        conn.execute(
            "INSERT INTO workspaces (id, name, path, is_git, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            (
                &workspace.id,
                &workspace.name,
                &workspace.path,
                workspace.is_git as i64,
                &workspace.created_at,
            ),
        )?;
        Ok(workspace)
    }

    pub fn list_workspaces(&self) -> Result<Vec<Workspace>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT id, name, path, is_git, created_at FROM workspaces ORDER BY created_at",
        )?;
        let rows = stmt.query_map([], map_workspace)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn get_workspace(&self, id: &str) -> Result<Workspace> {
        let conn = self.lock();
        conn.query_row(
            "SELECT id, name, path, is_git, created_at FROM workspaces WHERE id = ?1",
            [id],
            map_workspace,
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("workspace {id}")))
    }

    // ----- sessions ---------------------------------------------------------

    pub fn create_session(&self, new: NewSession) -> Result<Session> {
        let now = now_rfc3339();
        let session = Session {
            id: uuid(),
            workspace_id: new.workspace_id,
            title: new.title,
            backend: new.backend,
            model: new.model,
            permission_mode: new.permission_mode,
            effort: new.effort,
            status: SessionStatus::Idle,
            role: new.role,
            auto_named: new.auto_named,
            agent_session_id: new.agent_session_id,
            working_dir: new.working_dir,
            branch: new.branch,
            base_sha: new.base_sha,
            is_isolated: new.is_isolated,
            turns: 0,
            cost_usd: 0.0,
            parent_id: new.parent_id,
            created_at: now.clone(),
            updated_at: now,
        };

        let conn = self.lock();
        conn.execute(
            "INSERT INTO sessions (
                id, workspace_id, title, backend, model, permission_mode, status, role,
                agent_session_id, working_dir, branch, base_sha, is_isolated, turns, cost_usd,
                parent_id, created_at, updated_at, effort, auto_named
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20
             )",
            rusqlite::params![
                session.id,
                session.workspace_id,
                session.title,
                session.backend.as_str(),
                session.model,
                session.permission_mode.as_str(),
                session.status.as_str(),
                session.role.as_str(),
                session.agent_session_id,
                session.working_dir,
                session.branch,
                session.base_sha,
                session.is_isolated as i64,
                session.turns,
                session.cost_usd,
                session.parent_id,
                session.created_at,
                session.updated_at,
                session.effort.as_str(),
                session.auto_named as i64,
            ],
        )?;
        Ok(session)
    }

    pub fn get_session(&self, id: &str) -> Result<Session> {
        let conn = self.lock();
        conn.query_row(SESSION_SELECT, [id], map_session)
            .optional()?
            .ok_or_else(|| AppError::NotFound(format!("session {id}")))
    }

    pub fn list_sessions(&self, workspace_id: &str) -> Result<Vec<Session>> {
        let conn = self.lock();
        let sql = format!("{SESSION_SELECT_ALL} WHERE workspace_id = ?1 ORDER BY created_at");
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([workspace_id], map_session)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn set_session_status(&self, id: &str, status: SessionStatus) -> Result<()> {
        let conn = self.lock();
        conn.execute(
            "UPDATE sessions SET status = ?2, updated_at = ?3 WHERE id = ?1",
            (id, status.as_str(), now_rfc3339()),
        )?;
        Ok(())
    }

    /// Update the per-turn agent settings that the composer can change mid-session.
    pub fn update_session_settings(
        &self,
        id: &str,
        model: &str,
        permission_mode: PermissionMode,
        effort: EffortLevel,
    ) -> Result<()> {
        let conn = self.lock();
        conn.execute(
            "UPDATE sessions
             SET model = ?2, permission_mode = ?3, effort = ?4, updated_at = ?5
             WHERE id = ?1",
            (
                id,
                model,
                permission_mode.as_str(),
                effort.as_str(),
                now_rfc3339(),
            ),
        )?;
        Ok(())
    }

    /// User-initiated rename — also locks the title against background naming.
    pub fn rename_session(&self, id: &str, title: &str) -> Result<()> {
        let conn = self.lock();
        conn.execute(
            "UPDATE sessions SET title = ?2, auto_named = 0, updated_at = ?3 WHERE id = ?1",
            (id, title, now_rfc3339()),
        )?;
        Ok(())
    }

    /// Apply a background-generated title, but only if the user hasn't named the
    /// session in the meantime. Returns whether the title was applied.
    pub fn apply_auto_name(&self, id: &str, title: &str) -> Result<bool> {
        let conn = self.lock();
        let changed = conn.execute(
            "UPDATE sessions SET title = ?2, auto_named = 0, updated_at = ?3
             WHERE id = ?1 AND auto_named = 1",
            (id, title, now_rfc3339()),
        )?;
        Ok(changed > 0)
    }

    /// Delete a session. Its events are removed via the `ON DELETE CASCADE`
    /// foreign key.
    pub fn delete_session(&self, id: &str) -> Result<()> {
        let conn = self.lock();
        conn.execute("DELETE FROM sessions WHERE id = ?1", [id])?;
        Ok(())
    }

    /// Record the outcome of a completed turn: bump turn count and accrue cost.
    pub fn record_turn(&self, id: &str, added_cost: f64) -> Result<()> {
        let conn = self.lock();
        conn.execute(
            "UPDATE sessions
             SET turns = turns + 1, cost_usd = cost_usd + ?2, updated_at = ?3
             WHERE id = ?1",
            (id, added_cost, now_rfc3339()),
        )?;
        Ok(())
    }

    // ----- events -----------------------------------------------------------

    /// Append an event to a session's log, assigning the next sequence number.
    pub fn append_event(&self, session_id: &str, event: &AgentEvent) -> Result<EventRecord> {
        let conn = self.lock();
        let seq: i64 = conn.query_row(
            "SELECT COALESCE(MAX(seq), 0) + 1 FROM events WHERE session_id = ?1",
            [session_id],
            |row| row.get(0),
        )?;
        let record = EventRecord {
            id: uuid(),
            session_id: session_id.to_string(),
            seq,
            ts: now_rfc3339(),
            event: event.clone(),
        };
        conn.execute(
            "INSERT INTO events (id, session_id, seq, ts, payload) VALUES (?1, ?2, ?3, ?4, ?5)",
            (
                &record.id,
                &record.session_id,
                record.seq,
                &record.ts,
                serde_json::to_string(&record.event)?,
            ),
        )?;
        Ok(record)
    }

    pub fn list_events(&self, session_id: &str) -> Result<Vec<EventRecord>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT id, session_id, seq, ts, payload FROM events
             WHERE session_id = ?1 ORDER BY seq",
        )?;
        let rows = stmt.query_map([session_id], map_event)?;
        rows.map(|r| r.map_err(AppError::from).and_then(|x| x))
            .collect()
    }
}

// ----- row mappers ----------------------------------------------------------

const SESSION_SELECT: &str =
    "SELECT id, workspace_id, title, backend, model, permission_mode, status, role, \
    agent_session_id, working_dir, branch, base_sha, is_isolated, turns, cost_usd, parent_id, \
    created_at, updated_at, effort, auto_named FROM sessions WHERE id = ?1";

const SESSION_SELECT_ALL: &str =
    "SELECT id, workspace_id, title, backend, model, permission_mode, status, role, \
    agent_session_id, working_dir, branch, base_sha, is_isolated, turns, cost_usd, parent_id, \
    created_at, updated_at, effort, auto_named FROM sessions";

fn map_workspace(row: &Row<'_>) -> rusqlite::Result<Workspace> {
    Ok(Workspace {
        id: row.get(0)?,
        name: row.get(1)?,
        path: row.get(2)?,
        is_git: row.get::<_, i64>(3)? != 0,
        created_at: row.get(4)?,
    })
}

fn map_session(row: &Row<'_>) -> rusqlite::Result<Session> {
    let backend_str: String = row.get(3)?;
    let pm_str: String = row.get(5)?;
    let status_str: String = row.get(6)?;
    let role_str: String = row.get(7)?;
    let effort_str: String = row.get(18)?;
    Ok(Session {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        title: row.get(2)?,
        backend: Backend::parse(&backend_str).unwrap_or(Backend::Claude),
        model: row.get(4)?,
        permission_mode: PermissionMode::parse(&pm_str).unwrap_or(PermissionMode::Default),
        effort: EffortLevel::parse(&effort_str).unwrap_or(EffortLevel::High),
        status: SessionStatus::parse(&status_str).unwrap_or(SessionStatus::Idle),
        role: SessionRole::parse(&role_str).unwrap_or(SessionRole::Chat),
        auto_named: row.get::<_, i64>(19)? != 0,
        agent_session_id: row.get(8)?,
        working_dir: row.get(9)?,
        branch: row.get(10)?,
        base_sha: row.get(11)?,
        is_isolated: row.get::<_, i64>(12)? != 0,
        turns: row.get(13)?,
        cost_usd: row.get(14)?,
        parent_id: row.get(15)?,
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
    })
}

/// Maps a row into a `Result<EventRecord>` because deserializing the JSON
/// payload can fail independently of the SQLite read.
fn map_event(row: &Row<'_>) -> rusqlite::Result<Result<EventRecord>> {
    let id: String = row.get(0)?;
    let session_id: String = row.get(1)?;
    let seq: i64 = row.get(2)?;
    let ts: String = row.get(3)?;
    let payload: String = row.get(4)?;
    Ok((|| {
        let event: AgentEvent = serde_json::from_str(&payload)?;
        Ok(EventRecord {
            id,
            session_id,
            seq,
            ts,
            event,
        })
    })())
}
