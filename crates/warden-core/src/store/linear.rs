//! The cached Linear issue set backing the Tasks inbox.

use crate::error::Result;
use crate::util::now_rfc3339;

use super::{query_vec, with_tx, Store};

/// A cached Linear issue row: indexed `id`/`updated_at` plus the full JSON
/// `payload` (a serialized `LinearIssue`) the UI deserializes.
pub struct LinearIssueRow {
    pub id: String,
    pub updated_at: String,
    pub payload: String,
}

impl Store {
    /// `(id, updated_at)` for every cached issue — used to detect changes cheaply.
    pub fn linear_issue_versions(&self) -> Result<Vec<(String, String)>> {
        query_vec(
            &self.lock(),
            "SELECT id, updated_at FROM linear_issues",
            [],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
    }

    /// Every cached issue's JSON payload, newest-updated first.
    pub fn linear_issue_payloads(&self) -> Result<Vec<String>> {
        query_vec(
            &self.lock(),
            "SELECT payload FROM linear_issues ORDER BY updated_at DESC",
            [],
            |r| r.get::<_, String>(0),
        )
    }

    /// Replace the entire cached issue set in one transaction.
    pub fn replace_linear_issues(&self, rows: &[LinearIssueRow]) -> Result<()> {
        let now = now_rfc3339();
        with_tx(&mut self.lock(), |tx| {
            tx.execute("DELETE FROM linear_issues", [])?;
            for row in rows {
                tx.execute(
                    "INSERT INTO linear_issues (id, updated_at, payload, synced_at)
                     VALUES (?1, ?2, ?3, ?4)",
                    (&row.id, &row.updated_at, &row.payload, &now),
                )?;
            }
            Ok(())
        })
    }
}
