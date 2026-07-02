//! Secret persistence via the OS keychain (Windows Credential Manager / macOS
//! Keychain / Linux Secret Service). For credentials that grant broad access (a
//! Linear API key, an OAuth token), so they never touch the plaintext `settings`
//! table. Generic over `(service, account)`; callers pick stable identifiers.

use keyring::Entry as KeyringEntry;

use crate::error::{AppError, Result};

/// A handle to one keychain credential, identified by `(service, account)`.
pub struct Entry {
    inner: KeyringEntry,
}

impl Entry {
    /// Open the credential at `(service, account)` (no I/O until `store`/`load`).
    pub fn new(service: &str, account: &str) -> Result<Self> {
        KeyringEntry::new(service, account)
            .map(|inner| Entry { inner })
            .map_err(|e| AppError::Integration(format!("keychain: {e}")))
    }

    /// Store (or replace) the secret.
    pub fn store(&self, secret: &str) -> Result<()> {
        self.inner
            .set_password(secret)
            .map_err(|e| AppError::Integration(format!("keychain store: {e}")))
    }

    /// The stored secret, or `None` when no entry exists.
    pub fn load(&self) -> Result<Option<String>> {
        match self.inner.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AppError::Integration(format!("keychain load: {e}"))),
        }
    }

    /// Remove the stored secret. Idempotent — a missing entry is success.
    pub fn clear(&self) -> Result<()> {
        match self.inner.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AppError::Integration(format!("keychain clear: {e}"))),
        }
    }
}
