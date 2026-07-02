//! Per-project labels (GitHub-style) and their session assignments.

use std::collections::HashMap;

use crate::error::Result;
use crate::util::{now_rfc3339, uuid};
use crate::{Label, ProjectLabels};

use super::mappers::map_label;
use super::{query_vec, with_tx, Store};

impl Store {
    pub fn list_labels(&self, project_id: &str) -> Result<Vec<Label>> {
        query_vec(
            &self.lock(),
            "SELECT id, project_id, name, color, created_at FROM labels \
             WHERE project_id = ?1 ORDER BY name COLLATE NOCASE",
            [project_id],
            map_label,
        )
    }

    pub fn create_label(&self, project_id: &str, name: &str, color: &str) -> Result<Label> {
        let label = Label {
            id: uuid(),
            project_id: project_id.to_string(),
            name: name.to_string(),
            color: color.to_string(),
            created_at: now_rfc3339(),
        };
        self.lock().execute(
            "INSERT INTO labels (id, project_id, name, color, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5)",
            (
                &label.id,
                &label.project_id,
                &label.name,
                &label.color,
                &label.created_at,
            ),
        )?;
        Ok(label)
    }

    pub fn update_label(&self, id: &str, name: &str, color: &str) -> Result<()> {
        self.lock().execute(
            "UPDATE labels SET name = ?2, color = ?3 WHERE id = ?1",
            (id, name, color),
        )?;
        Ok(())
    }

    pub fn delete_label(&self, id: &str) -> Result<()> {
        self.lock()
            .execute("DELETE FROM labels WHERE id = ?1", [id])?;
        Ok(())
    }

    /// A project's labels + each session's label ids, in one round-trip.
    pub fn project_labels(&self, project_id: &str) -> Result<ProjectLabels> {
        let labels = self.list_labels(project_id)?;
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT sl.session_id, sl.label_id FROM session_labels sl \
             JOIN sessions s ON s.id = sl.session_id WHERE s.project_id = ?1",
        )?;
        let rows = stmt.query_map([project_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut assignments: HashMap<String, Vec<String>> = HashMap::new();
        for row in rows {
            let (session_id, label_id) = row?;
            assignments.entry(session_id).or_default().push(label_id);
        }
        Ok(ProjectLabels {
            labels,
            assignments,
        })
    }

    /// Replace a session's labels with `label_ids`.
    pub fn set_session_labels(&self, session_id: &str, label_ids: &[String]) -> Result<()> {
        with_tx(&mut self.lock(), |tx| {
            tx.execute(
                "DELETE FROM session_labels WHERE session_id = ?1",
                [session_id],
            )?;
            for label_id in label_ids {
                tx.execute(
                    "INSERT OR IGNORE INTO session_labels (session_id, label_id) VALUES (?1, ?2)",
                    (session_id, label_id),
                )?;
            }
            Ok(())
        })
    }
}
