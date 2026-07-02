//! Personal Linear API key persistence. A thin binding over the generic
//! [`secret::Entry`] keychain handle (Windows Credential Manager / macOS
//! Keychain / Linux Secret Service): the key grants full workspace access, so it
//! never touches the plaintext `settings` table.

use crate::error::Result;
use crate::secret::Entry;

const SERVICE: &str = "warden";
const ACCOUNT: &str = "linear-api-key";

fn entry() -> Result<Entry> {
    Entry::new(SERVICE, ACCOUNT)
}

/// Store (or replace) the Linear API key.
pub fn store(key: &str) -> Result<()> {
    entry()?.store(key)
}

/// The stored Linear API key, or `None` when not connected.
pub fn load() -> Result<Option<String>> {
    entry()?.load()
}

/// Remove the stored key (disconnect). Idempotent — a missing entry is success.
pub fn clear() -> Result<()> {
    entry()?.clear()
}
