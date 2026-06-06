mod migrations;

use std::path::Path;
use std::sync::{Arc, Mutex};

use rusqlite::{Connection, OptionalExtension, Row};

use crate::domain::{
    AgentEvent, Backend, CheckStatus, ContextSource, EffortLevel, EventRecord, Group,
    NodeRunStatus, PermissionMode, Project, RunStatus, Session, SessionContextSource, SessionKind,
    SessionRole, SessionStatus, Workflow, WorkflowGraph, WorkflowNodeRun, WorkflowRun,
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
    /// Provider CLI for a native terminal session (`claude`/`codex`); `None` runs the shell.
    pub terminal_command: Option<String>,
    pub working_dir: String,
    pub branch: Option<String>,
    pub base_sha: Option<String>,
    pub base_branch: Option<String>,
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
        conn.execute("UPDATE groups SET layout = ?2 WHERE id = ?1", (id, layout))?;
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

    // ----- context sources --------------------------------------------------

    /// Append a context source to a session, returning the stored record.
    pub fn add_context_source(
        &self,
        session_id: &str,
        source: &ContextSource,
    ) -> Result<SessionContextSource> {
        let conn = self.lock();
        let position: i64 = conn.query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM session_context_sources WHERE session_id = ?1",
            [session_id],
            |row| row.get(0),
        )?;
        let record = SessionContextSource {
            id: uuid(),
            session_id: session_id.to_string(),
            position,
            enabled: true,
            source: source.clone(),
        };
        conn.execute(
            "INSERT INTO session_context_sources (id, session_id, position, enabled, payload, created_at)
             VALUES (?1, ?2, ?3, 1, ?4, ?5)",
            (
                &record.id,
                session_id,
                position,
                serde_json::to_string(source)?,
                now_rfc3339(),
            ),
        )?;
        Ok(record)
    }

    pub fn list_context_sources(&self, session_id: &str) -> Result<Vec<SessionContextSource>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT id, session_id, position, enabled, payload
             FROM session_context_sources WHERE session_id = ?1 ORDER BY position",
        )?;
        let rows = stmt.query_map([session_id], map_context_source)?;
        rows.map(|r| r.map_err(AppError::from).and_then(|x| x))
            .collect()
    }

    pub fn remove_context_source(&self, id: &str) -> Result<()> {
        self.lock()
            .execute("DELETE FROM session_context_sources WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn set_context_source_enabled(&self, id: &str, enabled: bool) -> Result<()> {
        self.lock().execute(
            "UPDATE session_context_sources SET enabled = ?2 WHERE id = ?1",
            (id, enabled as i64),
        )?;
        Ok(())
    }

    /// Concatenate a session's assistant text across its turns — used to hand one
    /// workflow node's output to the next. Skips transient deltas and tool
    /// chatter; joins `AssistantText` blocks in order.
    pub fn get_session_assistant_text(&self, session_id: &str) -> Result<String> {
        let conn = self.lock();
        let mut stmt =
            conn.prepare("SELECT payload FROM events WHERE session_id = ?1 ORDER BY seq")?;
        let rows = stmt.query_map([session_id], |row| row.get::<_, String>("payload"))?;
        let mut out = String::new();
        for payload in rows {
            if let Ok(AgentEvent::AssistantText { text, .. }) =
                serde_json::from_str::<AgentEvent>(&payload?)
            {
                if !out.is_empty() {
                    out.push_str("\n\n");
                }
                out.push_str(&text);
            }
        }
        Ok(out)
    }

    // ----- workflows --------------------------------------------------------

    pub fn create_workflow(
        &self,
        project_id: &str,
        name: &str,
        graph: &WorkflowGraph,
    ) -> Result<Workflow> {
        let now = now_rfc3339();
        let wf = Workflow {
            id: uuid(),
            project_id: project_id.to_string(),
            name: name.to_string(),
            graph: graph.clone(),
            created_at: now.clone(),
            updated_at: now,
        };
        self.lock().execute(
            "INSERT INTO workflows (id, project_id, name, graph, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            (
                &wf.id,
                project_id,
                name,
                serde_json::to_string(graph)?,
                &wf.created_at,
                &wf.updated_at,
            ),
        )?;
        Ok(wf)
    }

    pub fn get_workflow(&self, id: &str) -> Result<Workflow> {
        let conn = self.lock();
        let (project_id, name, graph_json, created_at, updated_at): (
            String,
            String,
            String,
            String,
            String,
        ) = conn.query_row(
            "SELECT project_id, name, graph, created_at, updated_at FROM workflows WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )?;
        Ok(Workflow {
            id: id.to_string(),
            project_id,
            name,
            graph: serde_json::from_str(&graph_json)?,
            created_at,
            updated_at,
        })
    }

    pub fn list_workflows(&self, project_id: &str) -> Result<Vec<Workflow>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, name, graph, created_at, updated_at
             FROM workflows WHERE project_id = ?1 ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([project_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (id, project_id, name, graph_json, created_at, updated_at) = row?;
            out.push(Workflow {
                id,
                project_id,
                name,
                graph: serde_json::from_str(&graph_json)?,
                created_at,
                updated_at,
            });
        }
        Ok(out)
    }

    pub fn update_workflow(
        &self,
        id: &str,
        name: Option<&str>,
        graph: Option<&WorkflowGraph>,
    ) -> Result<Workflow> {
        {
            let conn = self.lock();
            if let Some(name) = name {
                conn.execute(
                    "UPDATE workflows SET name = ?2, updated_at = ?3 WHERE id = ?1",
                    (id, name, now_rfc3339()),
                )?;
            }
            if let Some(graph) = graph {
                conn.execute(
                    "UPDATE workflows SET graph = ?2, updated_at = ?3 WHERE id = ?1",
                    (id, serde_json::to_string(graph)?, now_rfc3339()),
                )?;
            }
        }
        self.get_workflow(id)
    }

    pub fn delete_workflow(&self, id: &str) -> Result<()> {
        self.lock()
            .execute("DELETE FROM workflows WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn create_workflow_run(
        &self,
        workflow_id: Option<&str>,
        project_id: &str,
        group_id: &str,
        graph: &WorkflowGraph,
    ) -> Result<WorkflowRun> {
        let now = now_rfc3339();
        let run = WorkflowRun {
            id: uuid(),
            workflow_id: workflow_id.map(str::to_string),
            project_id: project_id.to_string(),
            group_id: group_id.to_string(),
            status: RunStatus::Pending,
            error: None,
            created_at: now.clone(),
            updated_at: now,
        };
        self.lock().execute(
            "INSERT INTO workflow_runs
             (id, workflow_id, project_id, group_id, graph, status, error, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            (
                &run.id,
                &run.workflow_id,
                project_id,
                group_id,
                serde_json::to_string(graph)?,
                run.status.as_str(),
                &run.error,
                &run.created_at,
                &run.updated_at,
            ),
        )?;
        Ok(run)
    }

    pub fn set_workflow_run_status(
        &self,
        run_id: &str,
        status: RunStatus,
        error: Option<&str>,
    ) -> Result<()> {
        self.lock().execute(
            "UPDATE workflow_runs SET status = ?2, error = ?3, updated_at = ?4 WHERE id = ?1",
            (run_id, status.as_str(), error, now_rfc3339()),
        )?;
        Ok(())
    }

    pub fn get_workflow_run(&self, run_id: &str) -> Result<WorkflowRun> {
        let conn = self.lock();
        let (workflow_id, project_id, group_id, status, error, created_at, updated_at): (
            Option<String>,
            String,
            String,
            String,
            Option<String>,
            String,
            String,
        ) = conn.query_row(
            "SELECT workflow_id, project_id, group_id, status, error, created_at, updated_at
             FROM workflow_runs WHERE id = ?1",
            [run_id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                ))
            },
        )?;
        Ok(WorkflowRun {
            id: run_id.to_string(),
            workflow_id,
            project_id,
            group_id,
            status: RunStatus::parse(&status).unwrap_or(RunStatus::Failed),
            error,
            created_at,
            updated_at,
        })
    }

    /// The frozen graph snapshot a run was launched with (for resume).
    pub fn get_workflow_run_graph(&self, run_id: &str) -> Result<WorkflowGraph> {
        let conn = self.lock();
        let json: String = conn.query_row(
            "SELECT graph FROM workflow_runs WHERE id = ?1",
            [run_id],
            |r| r.get(0),
        )?;
        Ok(serde_json::from_str(&json)?)
    }

    /// The most recent run of a workflow, if any (for restoring run state when
    /// the editor reopens).
    pub fn latest_workflow_run(&self, workflow_id: &str) -> Result<Option<WorkflowRun>> {
        let id: Option<String> = {
            let conn = self.lock();
            match conn.query_row(
                "SELECT id FROM workflow_runs WHERE workflow_id = ?1
                 ORDER BY created_at DESC LIMIT 1",
                [workflow_id],
                |r| r.get::<_, String>(0),
            ) {
                Ok(id) => Some(id),
                Err(rusqlite::Error::QueryReturnedNoRows) => None,
                Err(e) => return Err(e.into()),
            }
        };
        match id {
            Some(id) => Ok(Some(self.get_workflow_run(&id)?)),
            None => Ok(None),
        }
    }

    pub fn upsert_node_run(&self, run: &WorkflowNodeRun) -> Result<()> {
        self.lock().execute(
            "INSERT INTO workflow_node_runs (run_id, node_id, status, session_id, output, error)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(run_id, node_id) DO UPDATE SET
               status = ?3, session_id = ?4, output = ?5, error = ?6",
            (
                &run.run_id,
                &run.node_id,
                run.status.as_str(),
                &run.session_id,
                &run.output,
                &run.error,
            ),
        )?;
        Ok(())
    }

    pub fn list_node_runs(&self, run_id: &str) -> Result<Vec<WorkflowNodeRun>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT run_id, node_id, status, session_id, output, error
             FROM workflow_node_runs WHERE run_id = ?1",
        )?;
        let rows = stmt.query_map([run_id], |r| {
            let status: String = r.get(2)?;
            Ok(WorkflowNodeRun {
                run_id: r.get(0)?,
                node_id: r.get(1)?,
                status: NodeRunStatus::parse(&status).unwrap_or(NodeRunStatus::Pending),
                session_id: r.get(3)?,
                output: r.get(4)?,
                error: r.get(5)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
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
            terminal_command: new.terminal_command,
            terminal_started: false,
            terminal_resume_id: None,
            working_dir: new.working_dir,
            branch: new.branch,
            base_sha: new.base_sha,
            base_branch: new.base_branch,
            is_isolated: new.is_isolated,
            allowed_tools: Vec::new(),
            turns: 0,
            cost_usd: 0.0,
            parent_id: new.parent_id,
            merged_at: None,
            pr_number: None,
            pr_url: None,
            pr_state: None,
            pr_check_status: None,
            pr_checked_at: None,
            created_at: now.clone(),
            updated_at: now,
        };

        let conn = self.lock();
        conn.execute(
            "INSERT INTO sessions (
                id, group_id, project_id, title, backend, model, permission_mode, status, role,
                agent_session_id, working_dir, branch, base_sha, is_isolated, allowed_tools, turns,
                cost_usd, parent_id, created_at, updated_at, effort, auto_named, kind,
                terminal_command, base_branch
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25
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
                serde_json::to_string(&session.allowed_tools)?,
                session.turns,
                session.cost_usd,
                session.parent_id,
                session.created_at,
                session.updated_at,
                session.effort.as_str(),
                session.auto_named as i64,
                session.kind.as_str(),
                session.terminal_command,
                session.base_branch,
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
    /// The backend is derived from the model (a model picks its own provider), so
    /// switching to a cross-provider model before the first turn re-homes it.
    pub fn update_session_settings(
        &self,
        id: &str,
        model: &str,
        backend: Backend,
        permission_mode: PermissionMode,
        effort: EffortLevel,
    ) -> Result<()> {
        let conn = self.lock();
        conn.execute(
            "UPDATE sessions
             SET model = ?2, backend = ?3, permission_mode = ?4, effort = ?5, updated_at = ?6
             WHERE id = ?1",
            (
                id,
                model,
                backend.as_str(),
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
        base_branch: Option<&str>,
        is_isolated: bool,
    ) -> Result<()> {
        let conn = self.lock();
        conn.execute(
            "UPDATE sessions
             SET working_dir = ?2, branch = ?3, base_sha = ?4, base_branch = ?5,
                 is_isolated = ?6, updated_at = ?7
             WHERE id = ?1",
            (
                id,
                working_dir,
                branch,
                base_sha,
                base_branch,
                is_isolated as i64,
                now_rfc3339(),
            ),
        )?;
        Ok(())
    }

    /// Mark a session as merged back into its base branch (its worktree is gone).
    pub fn mark_session_merged(&self, id: &str) -> Result<()> {
        let conn = self.lock();
        let now = now_rfc3339();
        conn.execute(
            "UPDATE sessions SET merged_at = ?2, updated_at = ?2 WHERE id = ?1",
            (id, now),
        )?;
        Ok(())
    }

    /// Record (or refresh) the pull request bound to a session's branch, with its
    /// CI-check rollup and the poll time.
    pub fn set_session_pr(
        &self,
        id: &str,
        number: i64,
        url: &str,
        state: &str,
        check_status: Option<CheckStatus>,
    ) -> Result<()> {
        let checked_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or_default();
        let conn = self.lock();
        conn.execute(
            "UPDATE sessions
             SET pr_number = ?2, pr_url = ?3, pr_state = ?4, pr_check_status = ?5,
                 pr_checked_at = ?6, updated_at = ?7
             WHERE id = ?1",
            (
                id,
                number,
                url,
                state,
                check_status.map(|c| c.as_str()),
                checked_at,
                now_rfc3339(),
            ),
        )?;
        Ok(())
    }

    /// Sessions with an open pull request whose worktree still exists — the set
    /// the background poller refreshes.
    pub fn sessions_with_open_pr(&self) -> Result<Vec<Session>> {
        let conn = self.lock();
        let sql = format!(
            "{SESSION_SELECT_ALL} WHERE pr_number IS NOT NULL AND merged_at IS NULL \
             AND (pr_state IS NULL OR pr_state = 'OPEN')"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], map_session)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
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

    /// Persist the backend conversation id for a session. Claude assigns this at
    /// creation (a client-chosen uuid); Codex learns its thread id from the
    /// server on `thread/start`, so it's set here once the thread exists.
    pub fn set_agent_session_id(&self, id: &str, agent_session_id: &str) -> Result<()> {
        let conn = self.lock();
        conn.execute(
            "UPDATE sessions SET agent_session_id = ?2, updated_at = ?3 WHERE id = ?1",
            (id, agent_session_id, now_rfc3339()),
        )?;
        Ok(())
    }

    /// Mark a native terminal session's CLI as launched, so the next spawn resumes
    /// the conversation rather than starting a fresh one.
    pub fn set_terminal_started(&self, id: &str) -> Result<()> {
        let conn = self.lock();
        conn.execute(
            "UPDATE sessions SET terminal_started = 1, updated_at = ?2 WHERE id = ?1",
            (id, now_rfc3339()),
        )?;
        Ok(())
    }

    /// Bind a native terminal session to the provider's own conversation id, so
    /// later launches resume that exact session.
    pub fn set_terminal_resume_id(&self, id: &str, resume_id: &str) -> Result<()> {
        let conn = self.lock();
        conn.execute(
            "UPDATE sessions SET terminal_resume_id = ?2, updated_at = ?3 WHERE id = ?1",
            (id, resume_id, now_rfc3339()),
        )?;
        Ok(())
    }

    // ----- settings ---------------------------------------------------------

    /// Read an app-wide setting by key.
    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.lock();
        Ok(conn
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
                row.get::<_, String>(0)
            })
            .optional()?)
    }

    /// Write an app-wide setting, replacing any existing value.
    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.lock();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )?;
        Ok(())
    }

    /// Every provider conversation id already claimed by a session, so a newly
    /// resumed terminal doesn't bind to a session another tab already owns.
    pub fn taken_resume_ids(&self) -> Result<std::collections::HashSet<String>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT terminal_resume_id FROM sessions WHERE terminal_resume_id IS NOT NULL",
        )?;
        let ids = stmt
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<std::collections::HashSet<String>>>()?;
        Ok(ids)
    }

    /// Add approved tool patterns to a session's allowlist (deduped), returning
    /// the full updated list.
    pub fn add_allowed_tools(&self, id: &str, patterns: &[String]) -> Result<Vec<String>> {
        let conn = self.lock();
        let current: String = conn.query_row(
            "SELECT allowed_tools FROM sessions WHERE id = ?1",
            [id],
            |row| row.get(0),
        )?;
        let mut tools: Vec<String> = serde_json::from_str(&current).unwrap_or_default();
        for pattern in patterns {
            if !pattern.is_empty() && !tools.contains(pattern) {
                tools.push(pattern.clone());
            }
        }
        conn.execute(
            "UPDATE sessions SET allowed_tools = ?2, updated_at = ?3 WHERE id = ?1",
            (id, serde_json::to_string(&tools)?, now_rfc3339()),
        )?;
        Ok(tools)
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
    agent_session_id, working_dir, branch, base_sha, is_isolated, allowed_tools, turns, cost_usd, \
    parent_id, created_at, updated_at, effort, auto_named, kind, terminal_command, terminal_started, \
    terminal_resume_id, base_branch, merged_at, pr_number, pr_url, pr_state, pr_check_status, \
    pr_checked_at FROM sessions WHERE id = ?1";

const SESSION_SELECT_ALL: &str =
    "SELECT id, group_id, project_id, title, backend, model, permission_mode, status, role, \
    agent_session_id, working_dir, branch, base_sha, is_isolated, allowed_tools, turns, cost_usd, \
    parent_id, created_at, updated_at, effort, auto_named, kind, terminal_command, terminal_started, \
    terminal_resume_id, base_branch, merged_at, pr_number, pr_url, pr_state, pr_check_status, \
    pr_checked_at FROM sessions";

fn map_project(row: &Row<'_>) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get("id")?,
        name: row.get("name")?,
        path: row.get("path")?,
        is_git: row.get::<_, i64>("is_git")? != 0,
        created_at: row.get("created_at")?,
    })
}

fn map_context_source(row: &Row<'_>) -> rusqlite::Result<Result<SessionContextSource>> {
    let id: String = row.get("id")?;
    let session_id: String = row.get("session_id")?;
    let position: i64 = row.get("position")?;
    let enabled: bool = row.get("enabled")?;
    let payload: String = row.get("payload")?;
    Ok((|| {
        let source: ContextSource = serde_json::from_str(&payload)?;
        Ok(SessionContextSource {
            id,
            session_id,
            position,
            enabled,
            source,
        })
    })())
}

fn map_group(row: &Row<'_>) -> rusqlite::Result<Group> {
    Ok(Group {
        id: row.get("id")?,
        name: row.get("name")?,
        layout: row.get("layout")?,
        created_at: row.get("created_at")?,
    })
}

fn map_session(row: &Row<'_>) -> rusqlite::Result<Session> {
    let backend_str: String = row.get("backend")?;
    let pm_str: String = row.get("permission_mode")?;
    let status_str: String = row.get("status")?;
    let role_str: String = row.get("role")?;
    let effort_str: String = row.get("effort")?;
    let kind_str: String = row.get("kind")?;
    Ok(Session {
        id: row.get("id")?,
        group_id: row.get("group_id")?,
        project_id: row.get("project_id")?,
        title: row.get("title")?,
        kind: SessionKind::parse(&kind_str).unwrap_or(SessionKind::Agent),
        backend: Backend::parse(&backend_str).unwrap_or(Backend::Claude),
        model: row.get("model")?,
        permission_mode: PermissionMode::parse(&pm_str).unwrap_or(PermissionMode::Default),
        effort: EffortLevel::parse(&effort_str).unwrap_or(EffortLevel::High),
        status: SessionStatus::parse(&status_str).unwrap_or(SessionStatus::Idle),
        role: SessionRole::parse(&role_str).unwrap_or(SessionRole::Chat),
        auto_named: row.get::<_, i64>("auto_named")? != 0,
        agent_session_id: row.get("agent_session_id")?,
        terminal_command: row.get("terminal_command")?,
        terminal_started: row.get::<_, i64>("terminal_started")? != 0,
        terminal_resume_id: row.get("terminal_resume_id")?,
        working_dir: row.get("working_dir")?,
        branch: row.get("branch")?,
        base_sha: row.get("base_sha")?,
        base_branch: row.get("base_branch")?,
        is_isolated: row.get::<_, i64>("is_isolated")? != 0,
        allowed_tools: serde_json::from_str(&row.get::<_, String>("allowed_tools")?)
            .unwrap_or_default(),
        turns: row.get("turns")?,
        cost_usd: row.get("cost_usd")?,
        parent_id: row.get("parent_id")?,
        merged_at: row.get("merged_at")?,
        pr_number: row.get("pr_number")?,
        pr_url: row.get("pr_url")?,
        pr_state: row.get("pr_state")?,
        pr_check_status: row
            .get::<_, Option<String>>("pr_check_status")?
            .and_then(|s| CheckStatus::parse(&s)),
        pr_checked_at: row.get("pr_checked_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// Maps a row into a `Result<EventRecord>` because deserializing the JSON
/// payload can fail independently of the SQLite read.
fn map_event(row: &Row<'_>) -> rusqlite::Result<Result<EventRecord>> {
    let id: String = row.get("id")?;
    let session_id: String = row.get("session_id")?;
    let seq: i64 = row.get("seq")?;
    let ts: String = row.get("ts")?;
    let payload: String = row.get("payload")?;
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
