//! Groups (the top-level workspace) plus the relationship tables hung off them:
//! group roots, session roots, and per-session context sources.

use crate::error::{AppError, Result};
use crate::util::{now_rfc3339, uuid};
use crate::{ContextSource, Group, Project, SessionContextSource};

use super::mappers::{map_context_source, map_group, map_project};
use super::{next_position, query_opt, query_vec, query_vec_try, with_tx, Store, DEFAULT_LAYOUT};

impl Store {
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
        query_vec(
            &self.lock(),
            "SELECT id, name, layout, created_at FROM groups ORDER BY created_at",
            [],
            map_group,
        )
    }

    pub fn get_group(&self, id: &str) -> Result<Group> {
        query_opt(
            &self.lock(),
            "SELECT id, name, layout, created_at FROM groups WHERE id = ?1",
            [id],
            map_group,
        )?
        .ok_or_else(|| AppError::NotFound(format!("group {id}")))
    }

    pub fn delete_group(&self, id: &str) -> Result<()> {
        self.lock()
            .execute("DELETE FROM groups WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn update_group_layout(&self, id: &str, layout: &str) -> Result<()> {
        self.lock()
            .execute("UPDATE groups SET layout = ?2 WHERE id = ?1", (id, layout))?;
        Ok(())
    }

    pub fn rename_group(&self, id: &str, name: &str) -> Result<()> {
        self.lock()
            .execute("UPDATE groups SET name = ?2 WHERE id = ?1", (id, name))?;
        Ok(())
    }

    // ----- group roots ------------------------------------------------------

    /// The group a project already belongs to, or a freshly created single-root
    /// group named after the project. Lets project-first flows resolve a group.
    pub fn ensure_group_for_project(&self, project_id: &str, project_name: &str) -> Result<String> {
        if let Some(group_id) = query_opt(
            &self.lock(),
            "SELECT group_id FROM group_roots WHERE project_id = ?1 ORDER BY position LIMIT 1",
            [project_id],
            |row| row.get::<_, String>(0),
        )? {
            return Ok(group_id);
        }
        let group = self.create_group(project_name)?;
        self.add_group_root(&group.id, project_id)?;
        Ok(group.id)
    }

    pub fn add_group_root(&self, group_id: &str, project_id: &str) -> Result<()> {
        let conn = self.lock();
        let position = next_position(&conn, "group_roots", "group_id", group_id)?;
        conn.execute(
            "INSERT OR IGNORE INTO group_roots (group_id, project_id, position)
             VALUES (?1, ?2, ?3)",
            (group_id, project_id, position),
        )?;
        Ok(())
    }

    pub fn remove_group_root(&self, group_id: &str, project_id: &str) -> Result<()> {
        self.lock().execute(
            "DELETE FROM group_roots WHERE group_id = ?1 AND project_id = ?2",
            (group_id, project_id),
        )?;
        Ok(())
    }

    /// The projects that are roots of a group, in display order.
    pub fn list_group_roots(&self, group_id: &str) -> Result<Vec<Project>> {
        query_vec(
            &self.lock(),
            "SELECT p.id, p.name, p.path, p.is_git, p.created_at
             FROM group_roots r JOIN projects p ON p.id = r.project_id
             WHERE r.group_id = ?1 ORDER BY r.position",
            [group_id],
            map_project,
        )
    }

    // ----- session roots ----------------------------------------------------

    /// The project rows for a session's roots, primary first — for handing extra
    /// directories to the CLI and rendering git status.
    pub fn list_session_root_projects(&self, session_id: &str) -> Result<Vec<Project>> {
        query_vec(
            &self.lock(),
            "SELECT p.id, p.name, p.path, p.is_git, p.created_at
             FROM session_roots r JOIN projects p ON p.id = r.project_id
             WHERE r.session_id = ?1 ORDER BY r.is_primary DESC, r.position",
            [session_id],
            map_project,
        )
    }

    /// Replace a session's non-primary roots with `project_ids`, preserving the
    /// primary. Idempotent — the full set is rewritten each call.
    pub fn set_session_roots(&self, session_id: &str, project_ids: &[String]) -> Result<()> {
        with_tx(&mut self.lock(), |tx| {
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
            Ok(())
        })
    }

    // ----- context sources --------------------------------------------------

    /// Append a context source to a session, returning the stored record.
    pub fn add_context_source(
        &self,
        session_id: &str,
        source: &ContextSource,
    ) -> Result<SessionContextSource> {
        let conn = self.lock();
        let position = next_position(&conn, "session_context_sources", "session_id", session_id)?;
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
        query_vec_try(
            &self.lock(),
            "SELECT id, session_id, position, enabled, payload
             FROM session_context_sources WHERE session_id = ?1 ORDER BY position",
            [session_id],
            map_context_source,
        )
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
}
