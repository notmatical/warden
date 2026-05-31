use rusqlite::Connection;

use crate::error::Result;

/// Ordered schema migrations. Each entry is applied exactly once; the database's
/// `user_version` pragma tracks how many have run. Append new migrations to the
/// end — never edit or reorder existing ones.
const MIGRATIONS: &[&str] = &[
    // 0001 — workspaces
    r#"
    CREATE TABLE workspaces (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        path        TEXT NOT NULL UNIQUE,
        is_git      INTEGER NOT NULL,
        created_at  TEXT NOT NULL
    );
    "#,
    // 0002 — sessions
    r#"
    CREATE TABLE sessions (
        id                TEXT PRIMARY KEY,
        workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        title             TEXT NOT NULL,
        backend           TEXT NOT NULL,
        model             TEXT NOT NULL,
        permission_mode   TEXT NOT NULL,
        status            TEXT NOT NULL,
        role              TEXT NOT NULL,
        agent_session_id  TEXT NOT NULL,
        working_dir       TEXT NOT NULL,
        branch            TEXT,
        base_sha          TEXT,
        is_isolated       INTEGER NOT NULL,
        turns             INTEGER NOT NULL DEFAULT 0,
        cost_usd          REAL NOT NULL DEFAULT 0,
        parent_id         TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
    );
    CREATE INDEX idx_sessions_workspace ON sessions(workspace_id);
    "#,
    // 0003 — append-only event log
    r#"
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
    // 0004 — per-session reasoning effort
    r#"
    ALTER TABLE sessions ADD COLUMN effort TEXT NOT NULL DEFAULT 'high';
    "#,
    // 0005 — whether a session's title is still auto-assigned (eligible for
    // background auto-naming) vs. set by the user.
    r#"
    ALTER TABLE sessions ADD COLUMN auto_named INTEGER NOT NULL DEFAULT 1;
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
