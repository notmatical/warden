//! Workflow definitions, runs, and per-node run state.
//!
//! Status columns read through their `FromSql` impls (`sql.rs`), so an
//! unrecognized DB value surfaces as an error rather than the old
//! `parse().unwrap_or(Failed/Pending)` silent coercion.

use crate::error::Result;
use crate::util::{now_rfc3339, uuid};
use crate::workflow::{RunStatus, Workflow, WorkflowGraph, WorkflowNodeRun, WorkflowRun};

use super::{query_opt, query_vec, Store};

impl Store {
    // ----- workflow definitions ---------------------------------------------

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
        let (project_id, name, graph_json, created_at, updated_at): (
            String,
            String,
            String,
            String,
            String,
        ) = self.lock().query_row(
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
        let conn = self.lock();
        // Orphan its sessions back to the regular list, then drop the workflow.
        conn.execute(
            "UPDATE sessions SET workflow_id = NULL WHERE workflow_id = ?1",
            [id],
        )?;
        conn.execute("DELETE FROM workflows WHERE id = ?1", [id])?;
        Ok(())
    }

    // ----- workflow runs ----------------------------------------------------

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
                run.status,
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
            (run_id, status, error, now_rfc3339()),
        )?;
        Ok(())
    }

    pub fn get_workflow_run(&self, run_id: &str) -> Result<WorkflowRun> {
        Ok(self.lock().query_row(
            "SELECT id, workflow_id, project_id, group_id, status, error, created_at, updated_at
             FROM workflow_runs WHERE id = ?1",
            [run_id],
            map_workflow_run,
        )?)
    }

    /// The frozen graph snapshot a run was launched with (for resume).
    pub fn get_workflow_run_graph(&self, run_id: &str) -> Result<WorkflowGraph> {
        let json: String = self.lock().query_row(
            "SELECT graph FROM workflow_runs WHERE id = ?1",
            [run_id],
            |r| r.get(0),
        )?;
        Ok(serde_json::from_str(&json)?)
    }

    /// A workflow's runs, newest first (run history).
    pub fn list_workflow_runs(&self, workflow_id: &str, limit: u32) -> Result<Vec<WorkflowRun>> {
        query_vec(
            &self.lock(),
            "SELECT id, workflow_id, project_id, group_id, status, error, created_at, updated_at
             FROM workflow_runs WHERE workflow_id = ?1
             ORDER BY created_at DESC LIMIT ?2",
            (workflow_id, limit),
            map_workflow_run,
        )
    }

    /// The most recent run of a workflow, if any (for restoring run state when
    /// the editor reopens).
    pub fn latest_workflow_run(&self, workflow_id: &str) -> Result<Option<WorkflowRun>> {
        let id: Option<String> = query_opt(
            &self.lock(),
            "SELECT id FROM workflow_runs WHERE workflow_id = ?1
             ORDER BY created_at DESC LIMIT 1",
            [workflow_id],
            |r| r.get::<_, String>(0),
        )?;
        match id {
            Some(id) => Ok(Some(self.get_workflow_run(&id)?)),
            None => Ok(None),
        }
    }

    /// Settle runs a previous app process left behind: their executor task died
    /// with it, so a `pending`/`running` run would otherwise stay live-looking
    /// forever. Paused runs are untouched — gates resume across restarts.
    pub fn fail_interrupted_workflow_runs(&self) -> Result<()> {
        let conn = self.lock();
        conn.execute(
            "UPDATE workflow_node_runs
             SET status = 'failed', error = 'interrupted by app restart'
             WHERE status IN ('running', 'awaitingInput')
               AND run_id IN (SELECT id FROM workflow_runs WHERE status IN ('pending', 'running'))",
            [],
        )?;
        conn.execute(
            "UPDATE workflow_runs
             SET status = 'failed', error = 'interrupted by app restart', updated_at = ?1
             WHERE status IN ('pending', 'running')",
            [now_rfc3339()],
        )?;
        Ok(())
    }

    // ----- node runs --------------------------------------------------------

    pub fn upsert_node_run(&self, run: &WorkflowNodeRun) -> Result<()> {
        self.lock().execute(
            "INSERT INTO workflow_node_runs (run_id, node_id, status, session_id, output, error)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(run_id, node_id) DO UPDATE SET
               status = ?3, session_id = ?4, output = ?5, error = ?6",
            (
                &run.run_id,
                &run.node_id,
                run.status,
                &run.session_id,
                &run.output,
                &run.error,
            ),
        )?;
        Ok(())
    }

    pub fn list_node_runs(&self, run_id: &str) -> Result<Vec<WorkflowNodeRun>> {
        query_vec(
            &self.lock(),
            "SELECT run_id, node_id, status, session_id, output, error
             FROM workflow_node_runs WHERE run_id = ?1",
            [run_id],
            |r| {
                Ok(WorkflowNodeRun {
                    run_id: r.get(0)?,
                    node_id: r.get(1)?,
                    status: r.get(2)?,
                    session_id: r.get(3)?,
                    output: r.get(4)?,
                    error: r.get(5)?,
                })
            },
        )
    }
}

fn map_workflow_run(r: &rusqlite::Row<'_>) -> rusqlite::Result<WorkflowRun> {
    Ok(WorkflowRun {
        id: r.get(0)?,
        workflow_id: r.get(1)?,
        project_id: r.get(2)?,
        group_id: r.get(3)?,
        status: r.get(4)?,
        error: r.get(5)?,
        created_at: r.get(6)?,
        updated_at: r.get(7)?,
    })
}

#[cfg(test)]
mod tests {
    use super::super::tests::store_with_session;
    use crate::workflow::{NodeRunStatus, RunStatus, WorkflowGraph, WorkflowNodeRun};

    #[test]
    fn run_and_node_status_roundtrip_through_sql() {
        let (store, _session_id) = store_with_session();
        let project = store.upsert_project("p2", "C:/tmp/p2", false).unwrap();
        let group_id = store.ensure_group_for_project(&project.id, "p2").unwrap();
        let run = store
            .create_workflow_run(None, &project.id, &group_id, &WorkflowGraph::default())
            .unwrap();
        assert_eq!(run.status, RunStatus::Pending);

        store
            .set_workflow_run_status(&run.id, RunStatus::Completed, None)
            .unwrap();
        assert_eq!(
            store.get_workflow_run(&run.id).unwrap().status,
            RunStatus::Completed
        );

        store
            .upsert_node_run(&WorkflowNodeRun {
                run_id: run.id.clone(),
                node_id: "n1".into(),
                status: NodeRunStatus::AwaitingInput,
                session_id: None,
                output: None,
                error: None,
            })
            .unwrap();
        let nodes = store.list_node_runs(&run.id).unwrap();
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].status, NodeRunStatus::AwaitingInput);
    }
}
