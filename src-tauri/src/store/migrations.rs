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
        working_dir       TEXT NOT NULL,
        branch            TEXT,
        base_sha          TEXT,
        is_isolated       INTEGER NOT NULL,
        pty_started       INTEGER NOT NULL DEFAULT 0,
        turns             INTEGER NOT NULL DEFAULT 0,
        cost_usd          REAL NOT NULL DEFAULT 0,
        parent_id         TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
    );
    CREATE INDEX idx_sessions_group ON sessions(group_id);
    CREATE INDEX idx_sessions_project ON sessions(project_id);

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
    "#,
];

pub fn run(conn: &Connection) -> Result<()> {
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    let current: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;

    for (idx, sql) in MIGRATIONS.iter().enumerate() {
        let version = (idx + 1) as i64;
        if version > current {
            conn.execute_batch(sql)?;
            // PRAGMA does not accept bound parameters.
            conn.execute_batch(&format!("PRAGMA user_version = {version};"))?;
        }
    }

    Ok(())
}
