//! Row → struct mappers. The domain enums read through their `FromSql` impls (see
//! `sql.rs`), so an unrecognized DB value now surfaces as a real error instead of
//! the old `parse().unwrap_or(Default)` silent coercion. The two payload-bearing
//! mappers (`map_event`, `map_context_source`) return a nested `Result` because
//! JSON deserialization can fail independently of the SQLite read.

use rusqlite::Row;

use crate::error::Result;
use crate::event::AgentEvent;
use crate::{
    ContextSource, EventRecord, Group, Label, PrCheckCounts, Project, Session, SessionContextSource,
};

use super::procs::AgentProc;

pub(super) fn map_project(row: &Row<'_>) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get("id")?,
        name: row.get("name")?,
        path: row.get("path")?,
        is_git: row.get::<_, i64>("is_git")? != 0,
        created_at: row.get("created_at")?,
    })
}

pub(super) fn map_group(row: &Row<'_>) -> rusqlite::Result<Group> {
    Ok(Group {
        id: row.get("id")?,
        name: row.get("name")?,
        layout: row.get("layout")?,
        created_at: row.get("created_at")?,
    })
}

pub(super) fn map_label(row: &Row<'_>) -> rusqlite::Result<Label> {
    Ok(Label {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        name: row.get("name")?,
        color: row.get("color")?,
        created_at: row.get("created_at")?,
    })
}

pub(super) fn map_session(row: &Row<'_>) -> rusqlite::Result<Session> {
    Ok(Session {
        id: row.get("id")?,
        group_id: row.get("group_id")?,
        project_id: row.get("project_id")?,
        title: row.get("title")?,
        kind: row.get("kind")?,
        backend: row.get("backend")?,
        model: row.get("model")?,
        permission_mode: row.get("permission_mode")?,
        effort: row.get("effort")?,
        status: row.get("status")?,
        role: row.get("role")?,
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
        // Optional enum columns map through Option<T>: NULL stays None, a present
        // value parses (erroring on an unknown string) via the FromSql impl.
        setup_status: row.get("setup_status")?,
        setup_error: row.get("setup_error")?,
        allowed_tools: serde_json::from_str(&row.get::<_, String>("allowed_tools")?)
            .unwrap_or_default(),
        turns: row.get("turns")?,
        cost_usd: row.get("cost_usd")?,
        parent_id: row.get("parent_id")?,
        workflow_id: row.get("workflow_id")?,
        linear_issue_id: row.get("linear_issue_id")?,
        merged_at: row.get("merged_at")?,
        pr_number: row.get("pr_number")?,
        pr_url: row.get("pr_url")?,
        pr_state: row.get("pr_state")?,
        pr_check_status: row.get("pr_check_status")?,
        pr_checked_at: row.get("pr_checked_at")?,
        pr_is_draft: row.get::<_, i64>("pr_is_draft")? != 0,
        pr_review_decision: row.get("pr_review_decision")?,
        pr_check_counts: row
            .get::<_, Option<String>>("pr_check_counts")?
            .and_then(|s| serde_json::from_str::<PrCheckCounts>(&s).ok()),
        pinned: row.get::<_, i64>("pinned")? != 0,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// Maps a row into `Result<SessionContextSource>` — deserializing the JSON
/// `payload` can fail independently of the SQLite read.
pub(super) fn map_context_source(row: &Row<'_>) -> rusqlite::Result<Result<SessionContextSource>> {
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

/// Maps a row into `Result<EventRecord>` — deserializing the JSON payload can
/// fail independently of the SQLite read.
pub(super) fn map_event(row: &Row<'_>) -> rusqlite::Result<Result<EventRecord>> {
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

pub(super) fn map_agent_proc(row: &Row<'_>) -> rusqlite::Result<AgentProc> {
    Ok(AgentProc {
        session_id: row.get(0)?,
        proc_id: row.get(1)?,
        pid: row.get(2)?,
        out_file: row.get(3)?,
        err_file: row.get(4)?,
        out_offset: row.get::<_, i64>(5)? as u64,
        spawned_at: row.get(6)?,
    })
}
