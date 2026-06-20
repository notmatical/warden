//! Session rows: creation, lookup, lifecycle/status, per-turn settings, worktree
//! state, PR status, naming, terminal binding, and the allowlist/turn counters.
//!
//! NOTE: event *interpretation* (e.g. "does the last turn end on an unanswered
//! `AskUserQuestion`?", "concatenate a session's assistant output") deliberately
//! does NOT live here. The store returns raw event rows (`list_events`); those
//! payload-aware projections compute in `agent::transcript`. See `events.rs`.

use crate::error::{AppError, Result};
use crate::util::{now_rfc3339, uuid};
use crate::{
    Backend, CheckStatus, EffortLevel, PermissionMode, PrCheckCounts, Session, SessionKind,
    SessionRole, SessionStatus, SetupStatus,
};

use crate::git::ProvisionedDir;

use super::mappers::map_session;
use super::{query_opt, query_vec, Store, SESSION_SELECT_ALL};

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
    pub workflow_id: Option<String>,
    pub linear_issue_id: Option<String>,
}

impl NewSession {
    /// Build an agent session that runs in an already-provisioned worktree,
    /// varying only the per-role fields. Collapses the 15-field session-create
    /// boilerplate shared by workflow nodes and the plan→code recipe. The
    /// backend is derived from the model, each session gets a fresh agent
    /// conversation id, and role-labeled sessions aren't auto-renamed.
    #[allow(clippy::too_many_arguments)]
    pub fn agent_in_dir(
        group_id: &str,
        project_id: &str,
        title: String,
        model: String,
        permission_mode: PermissionMode,
        effort: EffortLevel,
        role: SessionRole,
        parent_id: Option<String>,
        workflow_id: Option<String>,
        dir: &ProvisionedDir,
    ) -> Self {
        NewSession {
            group_id: group_id.to_string(),
            project_id: project_id.to_string(),
            title,
            kind: SessionKind::Agent,
            backend: Backend::for_model(&model),
            model,
            permission_mode,
            effort,
            role,
            auto_named: false,
            agent_session_id: uuid(),
            terminal_command: None,
            working_dir: dir.working_dir.clone(),
            branch: dir.branch.clone(),
            base_sha: dir.base_sha.clone(),
            base_branch: dir.base_branch.clone(),
            is_isolated: dir.is_isolated,
            parent_id,
            workflow_id,
            linear_issue_id: None,
        }
    }
}

impl Store {
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
            setup_status: None,
            setup_error: None,
            allowed_tools: Vec::new(),
            turns: 0,
            cost_usd: 0.0,
            parent_id: new.parent_id,
            workflow_id: new.workflow_id,
            linear_issue_id: new.linear_issue_id,
            merged_at: None,
            pr_number: None,
            pr_url: None,
            pr_state: None,
            pr_check_status: None,
            pr_checked_at: None,
            pr_is_draft: false,
            pr_review_decision: None,
            pr_check_counts: None,
            pinned: false,
            created_at: now.clone(),
            updated_at: now,
        };

        let conn = self.lock();
        conn.execute(
            "INSERT INTO sessions (
                id, group_id, project_id, title, backend, model, permission_mode, status, role,
                agent_session_id, working_dir, branch, base_sha, is_isolated, allowed_tools, turns,
                cost_usd, parent_id, created_at, updated_at, effort, auto_named, kind,
                terminal_command, base_branch, workflow_id, linear_issue_id
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27
             )",
            rusqlite::params![
                session.id,
                session.group_id,
                session.project_id,
                session.title,
                session.backend,
                session.model,
                session.permission_mode,
                session.status,
                session.role,
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
                session.effort,
                session.auto_named as i64,
                session.kind,
                session.terminal_command,
                session.base_branch,
                session.workflow_id,
                session.linear_issue_id,
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
        let sql = format!("{SESSION_SELECT_ALL} WHERE id = ?1");
        query_opt(&self.lock(), &sql, [id], map_session)?
            .ok_or_else(|| AppError::NotFound(format!("session {id}")))
    }

    pub fn list_sessions(&self, project_id: &str) -> Result<Vec<Session>> {
        let sql = format!("{SESSION_SELECT_ALL} WHERE project_id = ?1 ORDER BY created_at");
        query_vec(&self.lock(), &sql, [project_id], map_session)
    }

    /// A group's regular sessions — workflow-spawned sessions are excluded (they
    /// live under their workflow in the sidebar).
    pub fn list_group_sessions(&self, group_id: &str) -> Result<Vec<Session>> {
        let sql = format!(
            "{SESSION_SELECT_ALL} WHERE group_id = ?1 AND workflow_id IS NULL ORDER BY created_at"
        );
        query_vec(&self.lock(), &sql, [group_id], map_session)
    }

    /// The sessions a workflow's runs have spawned, newest first.
    pub fn list_workflow_sessions(&self, workflow_id: &str) -> Result<Vec<Session>> {
        let sql = format!("{SESSION_SELECT_ALL} WHERE workflow_id = ?1 ORDER BY created_at DESC");
        query_vec(&self.lock(), &sql, [workflow_id], map_session)
    }

    /// Sessions whose status is `Running` — startup recovery settles the ones
    /// without a live process behind them.
    pub fn list_running_sessions(&self) -> Result<Vec<Session>> {
        let sql = format!("{SESSION_SELECT_ALL} WHERE status = 'running'");
        query_vec(&self.lock(), &sql, [], map_session)
    }

    /// Sessions with an open pull request whose worktree still exists — the set
    /// the background poller refreshes.
    pub fn sessions_with_open_pr(&self) -> Result<Vec<Session>> {
        let sql = format!(
            "{SESSION_SELECT_ALL} WHERE pr_number IS NOT NULL AND merged_at IS NULL \
             AND (pr_state IS NULL OR pr_state = 'OPEN')"
        );
        query_vec(&self.lock(), &sql, [], map_session)
    }

    pub fn set_session_status(&self, id: &str, status: SessionStatus) -> Result<()> {
        self.lock().execute(
            "UPDATE sessions SET status = ?2, updated_at = ?3 WHERE id = ?1",
            (id, status, now_rfc3339()),
        )?;
        Ok(())
    }

    /// Pin/unpin a session. Deliberately does *not* touch `updated_at` — pinning
    /// shouldn't re-sort the session as if it were just active.
    pub fn set_session_pinned(&self, id: &str, pinned: bool) -> Result<()> {
        self.lock().execute(
            "UPDATE sessions SET pinned = ?2 WHERE id = ?1",
            (id, pinned as i64),
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
        self.lock().execute(
            "UPDATE sessions
             SET model = ?2, backend = ?3, permission_mode = ?4, effort = ?5, updated_at = ?6
             WHERE id = ?1",
            (id, model, backend, permission_mode, effort, now_rfc3339()),
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
        self.lock().execute(
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

    /// Record the worktree setup-commands lifecycle for a session. `None` clears
    /// it (no setup configured, or the user dismissed a failure).
    pub fn set_session_setup(
        &self,
        id: &str,
        status: Option<SetupStatus>,
        error: Option<&str>,
    ) -> Result<()> {
        self.lock().execute(
            "UPDATE sessions SET setup_status = ?2, setup_error = ?3, updated_at = ?4 WHERE id = ?1",
            (id, status, error, now_rfc3339()),
        )?;
        Ok(())
    }

    /// How many *other* sessions run in the same working directory. Plan→code
    /// pairs and workflow nodes share one worktree; it must outlive each of them.
    pub fn count_sessions_sharing_workdir(
        &self,
        working_dir: &str,
        exclude_id: &str,
    ) -> Result<i64> {
        Ok(self.lock().query_row(
            "SELECT count(*) FROM sessions WHERE working_dir = ?1 AND id != ?2",
            (working_dir, exclude_id),
            |row| row.get(0),
        )?)
    }

    /// Mark a session as merged back into its base branch (its worktree is gone).
    pub fn mark_session_merged(&self, id: &str) -> Result<()> {
        let now = now_rfc3339();
        self.lock().execute(
            "UPDATE sessions SET merged_at = ?2, updated_at = ?2 WHERE id = ?1",
            (id, now),
        )?;
        Ok(())
    }

    /// Record (or refresh) the pull request bound to a session's branch, with its
    /// review/draft state, CI-check rollup + tallies, and the poll time.
    /// Deliberately does *not* touch `updated_at` — background polling isn't
    /// activity, and "last active" staleness keys off that column.
    ///
    /// Takes decomposed primitives rather than a github `PrInfo` so the store does
    /// not depend on the integrations layer (severs a future circular dep). The
    /// `pr_checked_at` poll time is derived here via `now_rfc3339`'s clock source.
    #[allow(clippy::too_many_arguments)]
    pub fn set_session_pr(
        &self,
        id: &str,
        number: Option<i64>,
        url: Option<&str>,
        state: Option<&str>,
        check_status: Option<CheckStatus>,
        is_draft: bool,
        review_decision: Option<&str>,
        check_counts: Option<&PrCheckCounts>,
    ) -> Result<()> {
        let checked_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or_default();
        let check_counts = check_counts.map(serde_json::to_string).transpose()?;
        self.lock().execute(
            "UPDATE sessions
             SET pr_number = ?2, pr_url = ?3, pr_state = ?4, pr_check_status = ?5,
                 pr_checked_at = ?6, pr_is_draft = ?7, pr_review_decision = ?8,
                 pr_check_counts = ?9
             WHERE id = ?1",
            (
                id,
                number,
                url,
                state,
                check_status,
                checked_at,
                is_draft as i64,
                review_decision,
                check_counts,
            ),
        )?;
        Ok(())
    }

    /// User-initiated rename — also locks the title against background naming.
    pub fn rename_session(&self, id: &str, title: &str) -> Result<()> {
        self.lock().execute(
            "UPDATE sessions SET title = ?2, auto_named = 0, updated_at = ?3 WHERE id = ?1",
            (id, title, now_rfc3339()),
        )?;
        Ok(())
    }

    /// Apply a background-generated title, but only if the user hasn't named the
    /// session in the meantime. Returns whether the title was applied.
    pub fn apply_auto_name(&self, id: &str, title: &str) -> Result<bool> {
        let changed = self.lock().execute(
            "UPDATE sessions SET title = ?2, auto_named = 0, updated_at = ?3
             WHERE id = ?1 AND auto_named = 1",
            (id, title, now_rfc3339()),
        )?;
        Ok(changed > 0)
    }

    /// Delete a session. Its events are removed via the `ON DELETE CASCADE`
    /// foreign key.
    pub fn delete_session(&self, id: &str) -> Result<()> {
        self.lock()
            .execute("DELETE FROM sessions WHERE id = ?1", [id])?;
        Ok(())
    }

    /// Persist the backend conversation id for a session. Claude assigns this at
    /// creation (a client-chosen uuid); Codex learns its thread id from the
    /// server on `thread/start`, so it's set here once the thread exists.
    pub fn set_agent_session_id(&self, id: &str, agent_session_id: &str) -> Result<()> {
        self.lock().execute(
            "UPDATE sessions SET agent_session_id = ?2, updated_at = ?3 WHERE id = ?1",
            (id, agent_session_id, now_rfc3339()),
        )?;
        Ok(())
    }

    /// Mark a native terminal session's CLI as launched, so the next spawn resumes
    /// the conversation rather than starting a fresh one.
    pub fn set_terminal_started(&self, id: &str) -> Result<()> {
        self.lock().execute(
            "UPDATE sessions SET terminal_started = 1, updated_at = ?2 WHERE id = ?1",
            (id, now_rfc3339()),
        )?;
        Ok(())
    }

    /// Bind a native terminal session to the provider's own conversation id, so
    /// later launches resume that exact session.
    pub fn set_terminal_resume_id(&self, id: &str, resume_id: &str) -> Result<()> {
        self.lock().execute(
            "UPDATE sessions SET terminal_resume_id = ?2, updated_at = ?3 WHERE id = ?1",
            (id, resume_id, now_rfc3339()),
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
        self.lock().execute(
            "UPDATE sessions
             SET turns = turns + 1, cost_usd = cost_usd + ?2, updated_at = ?3
             WHERE id = ?1",
            (id, added_cost, now_rfc3339()),
        )?;
        Ok(())
    }
}
