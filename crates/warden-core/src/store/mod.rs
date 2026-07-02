//! The SQLite persistence layer — `Store` plus its per-entity `impl` blocks.
//!
//! Strictly Tauri-free: pure rusqlite, returning [`crate::error::Result`]. The
//! shell shares one cloneable `Store` handle across background turn tasks; all
//! access serializes through a mutex, which suits SQLite's single-writer model.
//!
//! The monolith is split by concern: `migrations` (schema), `sql` (enum<->column
//! bridges), `mappers` (row->struct), and one file per entity holding its
//! `impl Store` methods. The shared query/transaction helpers below collapse the
//! repeated `query_map(...).collect()` and manual `transaction()/commit()` sites.

mod mappers;
mod migrations;
mod sql;

mod events;
mod groups;
mod labels;
mod linear;
mod procs;
mod projects;
mod sessions;
mod settings;
mod workflows;

use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};

use rusqlite::{Connection, OptionalExtension, Params, Row, Transaction};

use crate::error::Result;

pub use linear::LinearIssueRow;
pub use procs::AgentProc;
pub use sessions::NewSession;

/// Layout a freshly created group starts with: a single full-window pane.
const DEFAULT_LAYOUT: &str = r#"{"mode":"single","panes":[null]}"#;

/// The full session column list, in the order `map_session` reads. Single-row
/// queries build off this with `format!("{SESSION_SELECT_ALL} WHERE id = ?1")`,
/// so there is exactly one source of truth for the column set.
const SESSION_SELECT_ALL: &str = "SELECT \
    id, group_id, project_id, title, kind, backend, model, permission_mode, effort, status, role, \
    auto_named, agent_session_id, terminal_command, terminal_started, terminal_resume_id, \
    working_dir, branch, base_sha, base_branch, is_isolated, setup_status, setup_error, \
    allowed_tools, turns, cost_usd, parent_id, workflow_id, linear_issue_id, merged_at, \
    pr_number, pr_url, pr_state, pr_check_status, pr_checked_at, pr_is_draft, pr_review_decision, \
    pr_check_counts, pinned, created_at, updated_at \
    FROM sessions";

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

    /// Open an in-memory database (tests).
    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        migrations::run(&conn)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    fn lock(&self) -> MutexGuard<'_, Connection> {
        // A poisoned mutex means a prior holder panicked; recovering the guard
        // is correct here since our writes are independent and idempotent.
        self.conn.lock().unwrap_or_else(|p| p.into_inner())
    }
}

// ----- shared query/transaction helpers -------------------------------------
//
// Free functions taking a `&Connection`/`&Transaction` so they work equally from
// a locked store and inside a transaction. They collapse the ~20 sites that each
// hand-wrote `prepare` + `query_map` + `collect::<rusqlite::Result<Vec<_>>>()`.

/// Run a query and map every row, collecting into a `Vec`. The mapper is
/// infallible-on-JSON (returns `rusqlite::Result<T>`); use [`query_vec_try`] for
/// mappers whose row decode can fail (JSON payloads).
fn query_vec<T, P, F>(conn: &Connection, sql: &str, params: P, mapper: F) -> Result<Vec<T>>
where
    P: Params,
    F: FnMut(&Row<'_>) -> rusqlite::Result<T>,
{
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params, mapper)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Like [`query_vec`] but for mappers that return a nested `Result<T>` (the row
/// read succeeded but decoding its JSON payload may fail). Flattens both layers.
fn query_vec_try<T, P, F>(conn: &Connection, sql: &str, params: P, mapper: F) -> Result<Vec<T>>
where
    P: Params,
    F: FnMut(&Row<'_>) -> rusqlite::Result<Result<T>>,
{
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params, mapper)?;
    rows.map(|r| r.map_err(crate::error::AppError::from).and_then(|x| x))
        .collect()
}

/// Run a query expected to return at most one row, mapping it if present.
fn query_opt<T, P, F>(conn: &Connection, sql: &str, params: P, mapper: F) -> Result<Option<T>>
where
    P: Params,
    F: FnOnce(&Row<'_>) -> rusqlite::Result<T>,
{
    Ok(conn.query_row(sql, params, mapper).optional()?)
}

/// Run a transaction, committing if the closure succeeds and rolling back (via
/// drop) on error. Standardizes the manual `transaction()`/`commit()` pairs.
fn with_tx<T, F>(conn: &mut Connection, f: F) -> Result<T>
where
    F: FnOnce(&Transaction<'_>) -> Result<T>,
{
    let tx = conn.transaction()?;
    let out = f(&tx)?;
    tx.commit()?;
    Ok(out)
}

/// The next 0-based position for an ordered list, scoped to one parent row.
/// `MAX(position) + 1`, or 0 for the first entry. Centralizes the position math
/// the ordered-insert sites repeated.
fn next_position(conn: &Connection, table: &str, scope_col: &str, scope_val: &str) -> Result<i64> {
    let sql = format!("SELECT COALESCE(MAX(position), -1) + 1 FROM {table} WHERE {scope_col} = ?1");
    Ok(conn.query_row(&sql, [scope_val], |row| row.get(0))?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::AgentEvent;
    use crate::util::{now_rfc3339, uuid};
    use crate::{Backend, EffortLevel, PermissionMode, SessionKind, SessionRole, SessionStatus};

    use super::procs::AgentProc;
    use super::sessions::NewSession;

    pub(super) fn store_with_session() -> (Store, String) {
        let store = Store::open_in_memory().unwrap();
        let project = store.upsert_project("proj", "C:/tmp/proj", false).unwrap();
        let group_id = store.ensure_group_for_project(&project.id, "proj").unwrap();
        let session = store
            .create_session(NewSession {
                group_id,
                project_id: project.id,
                title: "t".into(),
                kind: SessionKind::Agent,
                backend: Backend::Claude,
                model: "claude-fable-5".into(),
                permission_mode: PermissionMode::Default,
                effort: EffortLevel::High,
                role: SessionRole::Chat,
                auto_named: false,
                agent_session_id: uuid(),
                terminal_command: None,
                working_dir: "C:/tmp/proj".into(),
                branch: None,
                base_sha: None,
                base_branch: None,
                is_isolated: false,
                parent_id: None,
                workflow_id: None,
                linear_issue_id: None,
            })
            .unwrap();
        (store, session.id)
    }

    fn proc_row(session_id: &str, proc_id: &str) -> AgentProc {
        AgentProc {
            session_id: session_id.to_string(),
            proc_id: proc_id.to_string(),
            pid: 4242,
            out_file: "out.jsonl".into(),
            err_file: "err.log".into(),
            out_offset: 0,
            spawned_at: now_rfc3339(),
        }
    }

    #[test]
    fn agent_proc_crud_is_generation_guarded() {
        let (store, session_id) = store_with_session();
        store
            .upsert_agent_proc(&proc_row(&session_id, "gen1"))
            .unwrap();
        assert!(store.agent_proc_current(&session_id, "gen1").unwrap());

        // A respawn replaces the row; the old generation no longer owns it.
        store
            .upsert_agent_proc(&proc_row(&session_id, "gen2"))
            .unwrap();
        assert!(!store.agent_proc_current(&session_id, "gen1").unwrap());
        assert!(store.agent_proc_current(&session_id, "gen2").unwrap());

        // A stale tailer's delete is a no-op; the current generation's lands.
        store.delete_agent_proc(&session_id, "gen1").unwrap();
        assert_eq!(store.list_agent_procs().unwrap().len(), 1);
        store.delete_agent_proc(&session_id, "gen2").unwrap();
        assert!(store.list_agent_procs().unwrap().is_empty());
    }

    #[test]
    fn append_events_with_offset_is_atomic_and_guarded() {
        let (store, session_id) = store_with_session();
        store
            .upsert_agent_proc(&proc_row(&session_id, "gen1"))
            .unwrap();

        let events = vec![
            AgentEvent::AssistantText {
                text: "hello".into(),
                parent_tool_use_id: None,
            },
            AgentEvent::Result {
                is_error: false,
                cost_usd: Some(0.01),
                duration_ms: None,
                num_turns: Some(1),
                usage: None,
            },
        ];
        let records = store
            .append_events_with_offset(&session_id, "gen1", &events, 512)
            .unwrap();
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].seq, 1);
        assert_eq!(records[1].seq, 2);
        assert_eq!(store.list_events(&session_id).unwrap().len(), 2);
        assert_eq!(store.list_agent_procs().unwrap()[0].out_offset, 512);

        // A stale generation still appends its drained events, but cannot
        // touch the new generation's offset bookkeeping.
        store
            .upsert_agent_proc(&proc_row(&session_id, "gen2"))
            .unwrap();
        store
            .append_events_with_offset(
                &session_id,
                "gen1",
                &[AgentEvent::Notice {
                    text: "tail".into(),
                }],
                1024,
            )
            .unwrap();
        assert_eq!(store.list_events(&session_id).unwrap().len(), 3);
        assert_eq!(store.list_agent_procs().unwrap()[0].out_offset, 0);
    }

    #[test]
    fn running_sessions_listed_for_recovery() {
        let (store, session_id) = store_with_session();
        assert!(store.list_running_sessions().unwrap().is_empty());
        store
            .set_session_status(&session_id, SessionStatus::Running)
            .unwrap();
        let running = store.list_running_sessions().unwrap();
        assert_eq!(running.len(), 1);
        assert_eq!(running[0].id, session_id);
    }
}
