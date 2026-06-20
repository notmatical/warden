//! App-wide key/value settings.

use crate::error::Result;

use super::{query_opt, Store};

impl Store {
    /// Read an app-wide setting by key.
    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        query_opt(
            &self.lock(),
            "SELECT value FROM settings WHERE key = ?1",
            [key],
            |row| row.get::<_, String>(0),
        )
    }

    /// Write an app-wide setting, replacing any existing value.
    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.lock().execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )?;
        Ok(())
    }
}
