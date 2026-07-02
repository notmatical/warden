//! The global event sink. The desktop shell installs its `AppHandle` once at
//! startup via [`init`]; the emit helpers read it. Feature-gated so the core
//! builds (and emits as a no-op) without Tauri.

#[cfg(feature = "tauri")]
use std::sync::OnceLock;

#[cfg(feature = "tauri")]
static SINK: OnceLock<tauri::AppHandle> = OnceLock::new();

/// Install the app handle as the global emit sink. Call once in `setup()`,
/// **before** anything that emits (agent recovery, pollers).
#[cfg(feature = "tauri")]
pub fn init(app: tauri::AppHandle) {
    let _ = SINK.set(app);
}

/// Headless builds have no sink; emits become no-ops.
#[cfg(not(feature = "tauri"))]
pub fn init() {}

#[cfg(feature = "tauri")]
pub(crate) fn app() -> Option<&'static tauri::AppHandle> {
    SINK.get()
}
