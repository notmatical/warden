//! rusqlite `ToSql`/`FromSql` bridges for the strum-derived domain enums, so a
//! column reads/writes its canonical string form directly. Unlike the old
//! `.parse().unwrap_or(Default)` reads, an unrecognized DB value surfaces as a
//! `FromSqlError` rather than silently coercing to a default — schema drift in a
//! string column becomes a loud error, not a wrong-but-quiet row.

use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSqlOutput, ValueRef};
use rusqlite::ToSql;

use crate::workflow::{NodeRunStatus, RunStatus};
use crate::{
    Backend, CheckStatus, EffortLevel, PermissionMode, SessionKind, SessionRole, SessionStatus,
    SetupStatus,
};

/// Wire a strum enum (with `as_str`/`parse`) into rusqlite as its canonical
/// string. Writes go through `as_str`; reads through `parse`, mapping an unknown
/// value to `FromSqlError::Other` so it propagates as a real error.
macro_rules! sql_enum {
    ($ty:ty) => {
        impl ToSql for $ty {
            fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
                Ok(ToSqlOutput::from(self.as_str()))
            }
        }

        impl FromSql for $ty {
            fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
                let s = value.as_str()?;
                <$ty>::parse(s).ok_or_else(|| {
                    FromSqlError::Other(
                        format!("invalid {} value in database: {s:?}", stringify!($ty)).into(),
                    )
                })
            }
        }
    };
}

sql_enum!(Backend);
sql_enum!(PermissionMode);
sql_enum!(EffortLevel);
sql_enum!(SessionStatus);
sql_enum!(SessionKind);
sql_enum!(SessionRole);
sql_enum!(SetupStatus);
sql_enum!(CheckStatus);
sql_enum!(RunStatus);
sql_enum!(NodeRunStatus);

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn enum_roundtrips_through_sqlite() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE t (v TEXT NOT NULL);")
            .unwrap();
        conn.execute("INSERT INTO t (v) VALUES (?1)", [Backend::Codex])
            .unwrap();
        let got: Backend = conn.query_row("SELECT v FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(got, Backend::Codex);
        // The stored value is the canonical string, not a numeric discriminant.
        let raw: String = conn.query_row("SELECT v FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(raw, "codex");
    }

    #[test]
    fn unknown_value_is_an_error_not_a_default() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE t (v TEXT NOT NULL); INSERT INTO t (v) VALUES ('bogus');")
            .unwrap();
        let res: rusqlite::Result<SessionStatus> =
            conn.query_row("SELECT v FROM t", [], |r| r.get(0));
        assert!(
            res.is_err(),
            "unknown enum value must not coerce to Default"
        );
    }
}
