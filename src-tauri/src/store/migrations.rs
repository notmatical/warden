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
        allowed_tools     TEXT NOT NULL DEFAULT '[]',
        turns             INTEGER NOT NULL DEFAULT 0,
        cost_usd          REAL NOT NULL DEFAULT 0,
        parent_id         TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        merged_at         TEXT,
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

    -- App-wide key/value settings (e.g. each provider's CLI source preference).
    CREATE TABLE settings (
        key    TEXT PRIMARY KEY,
        value  TEXT NOT NULL
    );
    "#,
];

pub fn run(conn: &Connection) -> Result<()> {
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;

    // Pre-release: the schema is a single baseline we edit freely. Rather than
    // hand-wiping the dev database after every change, rebuild it automatically
    // whenever the baseline's fingerprint changes. Existing data is throwaway.
    //
    // TODO: before shipping, replace this with an append-only `user_version`
    // migration loop so real user data survives upgrades.
    let want = fingerprint();
    let have: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if have == want {
        return Ok(());
    }

    drop_all_tables(conn)?;
    for sql in MIGRATIONS {
        conn.execute_batch(sql)?;
    }
    // PRAGMA does not accept bound parameters.
    conn.execute_batch(&format!("PRAGMA user_version = {want};"))?;
    Ok(())
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
    fn rebuilds_a_stale_db_to_the_current_baseline() {
        let conn = Connection::open_in_memory().unwrap();
        // A stale schema (an old `sessions` shape) at a different version.
        conn.execute_batch("CREATE TABLE sessions(id TEXT); PRAGMA user_version = 1;")
            .unwrap();

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
}
