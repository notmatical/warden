//! Personal Linear API key persistence via the OS keychain (Windows Credential
//! Manager / macOS Keychain / Linux Secret Service). The key grants full
//! workspace access, so it never touches the plaintext `settings` table.

use keyring::Entry;

use crate::error::{AppError, Result};

const SERVICE: &str = "warden";
const ACCOUNT: &str = "linear-api-key";

fn entry() -> Result<Entry> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| AppError::Integration(format!("keychain: {e}")))
}

/// Store (or replace) the Linear API key.
pub fn store(key: &str) -> Result<()> {
    entry()?
        .set_password(key)
        .map_err(|e| AppError::Integration(format!("keychain store: {e}")))
}

/// The stored Linear API key, or `None` when not connected.
pub fn load() -> Result<Option<String>> {
    match entry()?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Integration(format!("keychain load: {e}"))),
    }
}

/// Remove the stored key (disconnect). Idempotent — a missing entry is success.
pub fn clear() -> Result<()> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Integration(format!("keychain clear: {e}"))),
    }
}
