use rusqlite::Connection;

use crate::error::Result;

/// Ordered schema migrations. Each entry is applied exactly once; the database's
/// `user_version` pragma tracks how many have run. Append new migrations to the
/// end — never edit or reorder existing ones once the app has shipped.
const MIGRATIONS: &[&str] = &[
    // 0001 — baseline schema.
    //
    // A "group" is the top-level workspace: a named set of project roots, a saved
    // pane layout, and the sessions opened against it. A "project" is a single
    // repo folder, which can belong to multiple groups. A session keeps a primary
    // `project_id` (where its agent runs) and a `session_roots` list of every repo
    // it pulls into context.
    r#"
    CREATE TABLE projects (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        path        TEXT NOT NULL UNIQUE,
        is_git      INTEGER NOT NULL,
        created_at  TEXT NOT NULL
    );

    CREATE TABLE groups (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        layout      TEXT NOT NULL,
        created_at  TEXT NOT NULL
    );

    CREATE TABLE group_roots (
        group_id    TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        position    INTEGER NOT NULL,
        PRIMARY KEY (group_id, project_id)
    );

    CREATE TABLE sessions (
        id                TEXT PRIMARY KEY,
        group_id          TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title             TEXT NOT NULL,
        kind              TEXT NOT NULL DEFAULT 'agent',
        backend           TEXT NOT NULL,
        model             TEXT NOT NULL,
        permission_mode   TEXT NOT NULL,
        effort            TEXT NOT NULL DEFAULT 'high',
        status            TEXT NOT NULL,
        role              TEXT NOT NULL,
        auto_named        INTEGER NOT NULL DEFAULT 1,
        agent_session_id  TEXT NOT NULL,
        terminal_command  TEXT,
        terminal_started  INTEGER NOT NULL DEFAULT 0,
        terminal_resume_id TEXT,
        working_dir       TEXT NOT NULL,
        branch            TEXT,
        base_sha          TEXT,
        base_branch       TEXT,
        is_isolated       INTEGER NOT NULL,
        -- Worktree setup-commands lifecycle: running/failed/done, NULL when no
        -- setup is configured. `setup_error` holds the failure output tail.
        setup_status      TEXT,
        setup_error       TEXT,
        allowed_tools     TEXT NOT NULL DEFAULT '[]',
        turns             INTEGER NOT NULL DEFAULT 0,
        cost_usd          REAL NOT NULL DEFAULT 0,
        parent_id         TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        -- Set on sessions a workflow run spawns, so the sidebar groups them under
        -- the workflow instead of the flat session list. Cleared if the workflow
        -- is deleted (see delete_workflow).
        workflow_id       TEXT,
        -- Linear issue this session was spawned from; drives writeback (PR
        -- attachment on open, completed state on merge).
        linear_issue_id   TEXT,
        merged_at         TEXT,
        pr_number         INTEGER,
        pr_url            TEXT,
        pr_state          TEXT,
        pr_check_status   TEXT,
        pr_checked_at     INTEGER,
        pr_is_draft       INTEGER NOT NULL DEFAULT 0,
        pr_review_decision TEXT,
        -- JSON PrCheckCounts (per-state CI tallies), NULL when the PR has no checks.
        pr_check_counts   TEXT,
        pinned            INTEGER NOT NULL DEFAULT 0,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
    );
    CREATE INDEX idx_sessions_group ON sessions(group_id);
    CREATE INDEX idx_sessions_project ON sessions(project_id);
    CREATE INDEX idx_sessions_workflow ON sessions(workflow_id);

    CREATE TABLE session_roots (
        session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        is_primary  INTEGER NOT NULL DEFAULT 0,
        position    INTEGER NOT NULL,
        PRIMARY KEY (session_id, project_id)
    );
    CREATE INDEX idx_session_roots_session ON session_roots(session_id);

    CREATE TABLE events (
        id          TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        seq         INTEGER NOT NULL,
        ts          TEXT NOT NULL,
        payload     TEXT NOT NULL,
        UNIQUE(session_id, seq)
    );
    CREATE INDEX idx_events_session ON events(session_id, seq);

    -- Per-session context sources injected into the agent's system prompt
    -- (files, dirs, saved text). `payload` is a JSON ContextSource.
    CREATE TABLE session_context_sources (
        id          TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        position    INTEGER NOT NULL,
        enabled     INTEGER NOT NULL DEFAULT 1,
        payload     TEXT NOT NULL,
        created_at  TEXT NOT NULL
    );
    CREATE INDEX idx_ctx_sources_session ON session_context_sources(session_id);

    -- Authored workflow graphs (cross-provider agent DAGs). `graph` is the JSON
    -- document the React Flow editor round-trips.
    CREATE TABLE workflows (
        id          TEXT PRIMARY KEY,
        project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        graph       TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
    );
    CREATE INDEX idx_workflows_project ON workflows(project_id);

    -- A single execution of a workflow. `graph` is a frozen snapshot taken at
    -- launch, so the definition can be edited mid-run.
    CREATE TABLE workflow_runs (
        id           TEXT PRIMARY KEY,
        workflow_id  TEXT REFERENCES workflows(id) ON DELETE SET NULL,
        project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        group_id     TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        graph        TEXT NOT NULL,
        status       TEXT NOT NULL,
        error        TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
    );
    CREATE INDEX idx_workflow_runs_workflow ON workflow_runs(workflow_id);

    -- Per-node execution state; the node's session row carries its transcript.
    CREATE TABLE workflow_node_runs (
        run_id      TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
        node_id     TEXT NOT NULL,
        status      TEXT NOT NULL,
        session_id  TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        output      TEXT,
        error       TEXT,
        PRIMARY KEY (run_id, node_id)
    );

    -- App-wide key/value settings (e.g. each provider's CLI source preference).
    CREATE TABLE settings (
        key    TEXT PRIMARY KEY,
        value  TEXT NOT NULL
    );

    -- Per-project labels (GitHub-style), attachable to sessions.
    CREATE TABLE labels (
        id          TEXT PRIMARY KEY,
        project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        color       TEXT NOT NULL,
        created_at  TEXT NOT NULL
    );
    CREATE INDEX idx_labels_project ON labels(project_id);

    CREATE TABLE session_labels (
        session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        label_id    TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
        PRIMARY KEY (session_id, label_id)
    );
    CREATE INDEX idx_session_labels_session ON session_labels(session_id);
    CREATE INDEX idx_session_labels_label ON session_labels(label_id);

    -- Cached Linear issues for the Tasks inbox. `payload` is the full JSON
    -- LinearIssue the UI deserializes; id/updated_at are surfaced for cheap
    -- change detection during background sync.
    CREATE TABLE linear_issues (
        id          TEXT PRIMARY KEY,
        updated_at  TEXT NOT NULL,
        payload     TEXT NOT NULL,
        synced_at   TEXT NOT NULL
    );

    -- Detached agent processes that may outlive the app (survive & reattach).
    -- `out_offset` is how many bytes of `out_file` have been drained into
    -- `events`; `proc_id` is a per-spawn generation so a stale tailer can't
    -- clobber a newer spawn's row.
    CREATE TABLE agent_procs (
        session_id  TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
        proc_id     TEXT NOT NULL,
        pid         INTEGER NOT NULL,
        out_file    TEXT NOT NULL,
        err_file    TEXT NOT NULL,
        out_offset  INTEGER NOT NULL DEFAULT 0,
        spawned_at  TEXT NOT NULL
    );
    "#,
];

/// Apply the schema. When the DB's fingerprint matches the current baseline this
/// is a no-op; otherwise the behavior depends on the `dev-migrations` feature.
///
/// TODO: before shipping, replace the fingerprint scheme with an append-only
/// `user_version` migration loop so real user data survives upgrades. Until then
/// the destructive rebuild path stays behind `dev-migrations` (see below).
pub fn run(conn: &Connection) -> Result<()> {
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;

    let want = fingerprint();
    let have: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if have == want {
        return Ok(());
    }

    // A drifted schema. A freshly created DB starts at `user_version = 0`, so the
    // first-ever open also lands here and simply builds the baseline.
    rebuild(conn, want)
}

/// (Re)build the schema to the current baseline and stamp its fingerprint.
///
/// With `dev-migrations` on (pre-release dev workflow), a drifted *existing* DB
/// is wiped and rebuilt — its data is throwaway, which saves hand-deleting the
/// dev database after every schema edit. Without the feature this is **only**
/// safe on a fresh (empty) database; a populated, drifted DB panics rather than
/// silently destroy data in a library.
fn rebuild(conn: &Connection, want: i64) -> Result<()> {
    #[cfg(not(feature = "dev-migrations"))]
    {
        // PERMANENT GUARD: never wipe a populated database. A real append-only
        // migration loop must replace this before there is non-throwaway data.
        if has_user_data(conn)? {
            panic!(
                "warden-core: database schema drift detected on a non-empty database. \
                 The baseline fingerprint changed but no forward migration exists. \
                 Rebuilding would DESTROY user data, so this is refused. Enable the \
                 `dev-migrations` cargo feature to wipe-and-rebuild throwaway dev data, \
                 or implement an append-only migration. TODO: ship the real migration loop."
            );
        }
    }

    drop_all_tables(conn)?;
    for sql in MIGRATIONS {
        conn.execute_batch(sql)?;
    }
    // PRAGMA does not accept bound parameters.
    conn.execute_batch(&format!("PRAGMA user_version = {want};"))?;
    Ok(())
}

/// Whether the database already holds rows the rebuild would destroy. Used to
/// distinguish a fresh DB (safe to build) from a populated, drifted one.
#[cfg(not(feature = "dev-migrations"))]
fn has_user_data(conn: &Connection) -> Result<bool> {
    // The `projects` table is the root of every other entity; if it is absent
    // (a brand-new DB) or empty, there is nothing to lose.
    let exists: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='projects'",
            [],
            |_| Ok(true),
        )
        .unwrap_or(false);
    if !exists {
        return Ok(false);
    }
    let count: i64 = conn.query_row("SELECT count(*) FROM projects", [], |row| row.get(0))?;
    Ok(count > 0)
}

/// A stable, positive 31-bit fingerprint of the schema (fits `user_version`).
fn fingerprint() -> i64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325; // FNV-1a offset basis
    for sql in MIGRATIONS {
        for byte in sql.bytes() {
            hash ^= byte as u64;
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    (hash & 0x7fff_ffff) as i64
}

fn drop_all_tables(conn: &Connection) -> Result<()> {
    let tables: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    conn.execute_batch("PRAGMA foreign_keys = OFF;")?;
    for table in tables {
        conn.execute_batch(&format!("DROP TABLE IF EXISTS \"{table}\";"))?;
    }
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn columns(conn: &Connection, table: &str) -> Vec<String> {
        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info({table})"))
            .unwrap();
        let rows = stmt.query_map([], |row| row.get::<_, String>(1)).unwrap();
        rows.map(|r| r.unwrap()).collect()
    }

    #[test]
    fn builds_a_fresh_db_to_the_current_baseline() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();

        let cols = columns(&conn, "sessions");
        assert!(cols.contains(&"allowed_tools".to_string()));
        assert!(cols.contains(&"group_id".to_string()));
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, fingerprint());
    }

    #[test]
    fn is_idempotent_when_up_to_date() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();
        // A second run must not drop/rebuild (data would be lost).
        conn.execute_batch(
            "INSERT INTO projects(id,name,path,is_git,created_at) \
             VALUES('p','n','/tmp',0,'t');",
        )
        .unwrap();
        run(&conn).unwrap();
        let count: i64 = conn
            .query_row("SELECT count(*) FROM projects", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    /// With `dev-migrations`, a stale dev DB is wiped and rebuilt to the baseline.
    #[cfg(feature = "dev-migrations")]
    #[test]
    fn dev_migrations_rebuilds_a_stale_db() {
        let conn = Connection::open_in_memory().unwrap();
        // A stale schema (an old `sessions` shape) at a different version, with a
        // populated `projects` table — throwaway under `dev-migrations`.
        conn.execute_batch(
            "CREATE TABLE sessions(id TEXT); \
             CREATE TABLE projects(id TEXT, name TEXT, path TEXT, is_git INT, created_at TEXT); \
             INSERT INTO projects VALUES('p','n','/tmp',0,'t'); \
             PRAGMA user_version = 1;",
        )
        .unwrap();

        run(&conn).unwrap();

        let cols = columns(&conn, "sessions");
        assert!(cols.contains(&"allowed_tools".to_string()));
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, fingerprint());
    }

    /// Without `dev-migrations`, drift on a *populated* DB must refuse to wipe.
    #[cfg(not(feature = "dev-migrations"))]
    #[test]
    #[should_panic(expected = "schema drift")]
    fn refuses_to_wipe_populated_db_on_drift() {
        let conn = Connection::open_in_memory().unwrap();
        run(&conn).unwrap();
        conn.execute_batch(
            "INSERT INTO projects(id,name,path,is_git,created_at) \
             VALUES('p','n','/tmp',0,'t');",
        )
        .unwrap();
        // Force drift: a fingerprint the baseline will never produce.
        conn.execute_batch("PRAGMA user_version = 1;").unwrap();
        run(&conn).unwrap();
    }
}
