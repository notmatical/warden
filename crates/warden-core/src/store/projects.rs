//! Project rows: the opened repo roots every other entity references.

use crate::error::{AppError, Result};
use crate::util::{now_rfc3339, uuid};
use crate::Project;

use super::mappers::map_project;
use super::{query_opt, query_vec, Store};

impl Store {
    pub fn upsert_project(&self, name: &str, path: &str, is_git: bool) -> Result<Project> {
        let conn = self.lock();
        if let Some(existing) = query_opt(
            &conn,
            "SELECT id, name, path, is_git, created_at FROM projects WHERE path = ?1",
            [path],
            map_project,
        )? {
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
        query_vec(
            &self.lock(),
            "SELECT id, name, path, is_git, created_at FROM projects ORDER BY created_at",
            [],
            map_project,
        )
    }

    pub fn get_project(&self, id: &str) -> Result<Project> {
        query_opt(
            &self.lock(),
            "SELECT id, name, path, is_git, created_at FROM projects WHERE id = ?1",
            [id],
            map_project,
        )?
        .ok_or_else(|| AppError::NotFound(format!("project {id}")))
    }
}
