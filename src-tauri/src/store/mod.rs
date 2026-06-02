mod migrations;

use std::path::Path;
use std::sync::{Arc, Mutex};

use rusqlite::{Connection, OptionalExtension, Row};

use crate::domain::{
    AgentEvent, Backend, EffortLevel, EventRecord, Group, PermissionMode, Project, Session,
    SessionKind, SessionRole, SessionStatus,
};
use crate::error::{AppError, Result};
use crate::util::{now_rfc3339, uuid};

/// Layout a freshly created group starts with: a single full-window pane.
const DEFAULT_LAYOUT: &str = r#"{"mode":"single","panes":[null]}"#;

/// Fields required to create a session row. Keeps the insert call readable
/// instead of a dozen positional arguments.
pub struct NewSession {
    pub group_id: String,
    pub project_id: String,
    pub title: String,
    pub kind: SessionKind,
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

    // ----- projects -------------------------------------------------------

    pub fn upsert_project(&self, name: &str, path: &str, is_git: bool) -> Result<Project> {
        let conn = self.lock();
        if let Some(existing) = conn
            .query_row(
                "SELECT id, name, path, is_git, created_at FROM projects WHERE path = ?1",
                [path],
                map_project,
            )
            .optional()?
        {
            return Ok(existing);
        }

        let project = Project {
            id: uuid(),
            name: name.to_string(),
            path: path.to_string(),
            is_git,
            created_at: now_rfc3339(),
        };
        conn.execute(
            "INSERT INTO projects (id, name, path, is_git, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            (
                &project.id,
                &project.name,
                &project.path,
                project.is_git as i64,
                &project.created_at,
            ),
        )?;
        Ok(project)
    }

    pub fn list_projects(&self) -> Result<Vec<Project>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT id, name, path, is_git, created_at FROM projects ORDER BY created_at",
        )?;
        let rows = stmt.query_map([], map_project)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn get_project(&self, id: &str) -> Result<Project> {
        let conn = self.lock();
        conn.query_row(
            "SELECT id, name, path, is_git, created_at FROM projects WHERE id = ?1",
            [id],
            map_project,
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("project {id}")))
    }

    // ----- groups -----------------------------------------------------------

    pub fn create_group(&self, name: &str) -> Result<Group> {
        let conn = self.lock();
        let group = Group {
            id: uuid(),
            name: name.to_string(),
            layout: DEFAULT_LAYOUT.to_string(),
            created_at: now_rfc3339(),
        };
        conn.execute(
            "INSERT INTO groups (id, name, layout, created_at) VALUES (?1, ?2, ?3, ?4)",
            (&group.id, &group.name, &group.layout, &group.created_at),
        )?;
        Ok(group)
    }

    pub fn list_groups(&self) -> Result<Vec<Group>> {
        let conn = self.lock();
        let mut stmt =
            conn.prepare("SELECT id, name, layout, created_at FROM groups ORDER BY created_at")?;
        let rows = stmt.query_map([], map_group)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn get_group(&self, id: &str) -> Result<Group> {
        let conn = self.lock();
        conn.query_row(
            "SELECT id, name, layout, created_at FROM groups WHERE id = ?1",
            [id],
            map_group,
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("group {id}")))
    }

    pub fn delete_group(&self, id: &str) -> Result<()> {
        let conn = self.lock();
        conn.execute("DELETE FROM groups WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn update_group_layout(&self, id: &str, layout: &str) -> Result<()> {
        let conn = self.lock();
        conn.execute(
            "UPDATE groups SET layout = ?2 WHERE id = ?1",
            (id, layout),
        )?;
        Ok(())
    }

    pub fn rename_group(&self, id: &str, name: &str) -> Result<()> {
        let conn = self.lock();
        conn.execute("UPDATE groups SET name = ?2 WHERE id = ?1", (id, name))?;
        Ok(())
    }

    /// The group a project already belongs to, or a freshly created single-root
    /// group named after the project. Lets project-first flows resolve a group.
    pub fn ensure_group_for_project(&self, project_id: &str, project_name: &str) -> Result<String> {
        if let Some(group_id) = self
            .lock()
            .query_row(
                "SELECT group_id FROM group_roots WHERE project_id = ?1 ORDER BY position LIMIT 1",
                [project_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
        {
            return Ok(group_id);
        }
        let group = self.create_group(project_name)?;
        self.add_group_root(&group.id, project_id)?;
        Ok(group.id)
    }

    pub fn add_group_root(&self, group_id: &str, project_id: &str) -> Result<()> {
        let conn = self.lock();
        let position: i64 = conn.query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM group_roots WHERE group_id = ?1",
            [group_id],
            |row| row.get(0),
        )?;
        conn.execute(
            "INSERT OR IGNORE INTO group_roots (group_id, project_id, position)
             VALUES (?1, ?2, ?3)",
            (group_id, project_id, position),
        )?;
        Ok(())
    }

    pub fn remove_group_root(&self, group_id: &str, project_id: &str) -> Result<()> {
        let conn = self.lock();
        conn.execute(
            "DELETE FROM group_roots WHERE group_id = ?1 AND project_id = ?2",
            (group_id, project_id),
        )?;
        Ok(())
    }

    /// The projects that are roots of a group, in display order.
    pub fn list_group_roots(&self, group_id: &str) -> Result<Vec<Project>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT p.id, p.name, p.path, p.is_git, p.created_at
             FROM group_roots r JOIN projects p ON p.id = r.project_id
             WHERE r.group_id = ?1 ORDER BY r.position",
        )?;
        let rows = stmt.query_map([group_id], map_project)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn list_group_sessions(&self, group_id: &str) -> Result<Vec<Session>> {
        let conn = self.lock();
        let sql = format!("{SESSION_SELECT_ALL} WHERE group_id = ?1 ORDER BY created_at");
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([group_id], map_session)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    // ----- session roots ----------------------------------------------------

    /// The project rows for a session's roots, primary first — for handing extra
    /// directories to the CLI and rendering git status.
    pub fn list_session_root_projects(&self, session_id: &str) -> Result<Vec<Project>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT p.id, p.name, p.path, p.is_git, p.created_at
             FROM session_roots r JOIN projects p ON p.id = r.project_id
             WHERE r.session_id = ?1 ORDER BY r.is_primary DESC, r.position",
        )?;
        let rows = stmt.query_map([session_id], map_project)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Replace a session's non-primary roots with `project_ids`, preserving the
    /// primary. Idempotent — the full set is rewritten each call.
    pub fn set_session_roots(&self, session_id: &str, project_ids: &[String]) -> Result<()> {
        let mut conn = self.lock();
        let tx = conn.transaction()?;
        tx.execute(
            "DELETE FROM session_roots WHERE session_id = ?1 AND is_primary = 0",
            [session_id],
        )?;
        for (idx, project_id) in project_ids.iter().enumerate() {
            tx.execute(
                "INSERT OR IGNORE INTO session_roots (session_id, project_id, is_primary, position)
                 VALUES (?1, ?2, 0, ?3)",
                (session_id, project_id, (idx as i64) + 1),
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    // ----- sessions ---------------------------------------------------------

    pub fn create_session(&self, new: NewSession) -> Result<Session> {
        let now = now_rfc3339();
        let session = Session {
            id: uuid(),
            group_id: new.group_id,
            project_id: new.project_id,
            title: new.title,
            kind: new.kind,
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
            pty_started: false,
            turns: 0,
            cost_usd: 0.0,
            parent_id: new.parent_id,
            created_at: now.clone(),
            updated_at: now,
        };

        let conn = self.lock();
        conn.execute(
            "INSERT INTO sessions (
                id, group_id, project_id, title, backend, model, permission_mode, status, role,
                agent_session_id, working_dir, branch, base_sha, is_isolated, pty_started, turns,
                cost_usd, parent_id, created_at, updated_at, effort, auto_named, kind
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23
             )",
            rusqlite::params![
                session.id,
                session.group_id,
                session.project_id,
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
                session.pty_started as i64,
                session.turns,
                session.cost_usd,
                session.parent_id,
                session.created_at,
                session.updated_at,
                session.effort.as_str(),
                session.auto_named as i64,
                session.kind.as_str(),
            ],
        )?;
        // Seed the primary root. Additional roots are added via set_session_roots.
        conn.execute(
            "INSERT INTO session_roots (session_id, project_id, is_primary, position)
             VALUES (?1, ?2, 1, 0)",
            (&session.id, &session.project_id),
        )?;
        Ok(session)
    }

    pub fn get_session(&self, id: &str) -> Result<Session> {
        let conn = self.lock();
        conn.query_row(SESSION_SELECT, [id], map_session)
            .optional()?
            .ok_or_else(|| AppError::NotFound(format!("session {id}")))
    }

    pub fn list_sessions(&self, project_id: &str) -> Result<Vec<Session>> {
        let conn = self.lock();
        let sql = format!("{SESSION_SELECT_ALL} WHERE project_id = ?1 ORDER BY created_at");
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([project_id], map_session)?;
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

    /// Repoint a session's working directory (used when toggling worktree
    /// isolation before the first turn).
    pub fn update_session_workdir(
        &self,
        id: &str,
        working_dir: &str,
        branch: Option<&str>,
        base_sha: Option<&str>,
        is_isolated: bool,
    ) -> Result<()> {
        let conn = self.lock();
        conn.execute(
            "UPDATE sessions
             SET working_dir = ?2, branch = ?3, base_sha = ?4, is_isolated = ?5, updated_at = ?6
             WHERE id = ?1",
            (
                id,
                working_dir,
                branch,
                base_sha,
                is_isolated as i64,
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

    /// Mark a terminal session's PTY conversation as opened, so reopening it
    /// resumes the existing CLI conversation rather than starting a new one.
    pub fn mark_pty_started(&self, id: &str) -> Result<()> {
        let conn = self.lock();
        conn.execute(
            "UPDATE sessions SET pty_started = 1, updated_at = ?2 WHERE id = ?1",
            (id, now_rfc3339()),
        )?;
        Ok(())
    }

    /// Point a terminal session at a fresh CLI conversation (new id, not yet
    /// started), abandoning the previous one.
    pub fn reset_terminal_session(&self, id: &str, agent_session_id: &str) -> Result<()> {
        let conn = self.lock();
        conn.execute(
            "UPDATE sessions
             SET agent_session_id = ?2, pty_started = 0, updated_at = ?3
             WHERE id = ?1",
            (id, agent_session_id, now_rfc3339()),
        )?;
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
    "SELECT id, group_id, project_id, title, backend, model, permission_mode, status, role, \
    agent_session_id, working_dir, branch, base_sha, is_isolated, pty_started, turns, cost_usd, \
    parent_id, created_at, updated_at, effort, auto_named, kind FROM sessions WHERE id = ?1";

const SESSION_SELECT_ALL: &str =
    "SELECT id, group_id, project_id, title, backend, model, permission_mode, status, role, \
    agent_session_id, working_dir, branch, base_sha, is_isolated, pty_started, turns, cost_usd, \
    parent_id, created_at, updated_at, effort, auto_named, kind FROM sessions";

fn map_project(row: &Row<'_>) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        path: row.get(2)?,
        is_git: row.get::<_, i64>(3)? != 0,
        created_at: row.get(4)?,
    })
}

fn map_group(row: &Row<'_>) -> rusqlite::Result<Group> {
    Ok(Group {
        id: row.get(0)?,
        name: row.get(1)?,
        layout: row.get(2)?,
        created_at: row.get(3)?,
    })
}

fn map_session(row: &Row<'_>) -> rusqlite::Result<Session> {
    let backend_str: String = row.get(4)?;
    let pm_str: String = row.get(6)?;
    let status_str: String = row.get(7)?;
    let role_str: String = row.get(8)?;
    let effort_str: String = row.get(20)?;
    let kind_str: String = row.get(22)?;
    Ok(Session {
        id: row.get(0)?,
        group_id: row.get(1)?,
        project_id: row.get(2)?,
        title: row.get(3)?,
        kind: SessionKind::parse(&kind_str).unwrap_or(SessionKind::Agent),
        backend: Backend::parse(&backend_str).unwrap_or(Backend::Claude),
        model: row.get(5)?,
        permission_mode: PermissionMode::parse(&pm_str).unwrap_or(PermissionMode::Default),
        effort: EffortLevel::parse(&effort_str).unwrap_or(EffortLevel::High),
        status: SessionStatus::parse(&status_str).unwrap_or(SessionStatus::Idle),
        role: SessionRole::parse(&role_str).unwrap_or(SessionRole::Chat),
        auto_named: row.get::<_, i64>(21)? != 0,
        agent_session_id: row.get(9)?,
        working_dir: row.get(10)?,
        branch: row.get(11)?,
        base_sha: row.get(12)?,
        is_isolated: row.get::<_, i64>(13)? != 0,
        pty_started: row.get::<_, i64>(14)? != 0,
        turns: row.get(15)?,
        cost_usd: row.get(16)?,
        parent_id: row.get(17)?,
        created_at: row.get(18)?,
        updated_at: row.get(19)?,
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
