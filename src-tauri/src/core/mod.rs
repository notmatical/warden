//! Cross-cutting foundation shared across the crate: error types, the app state
//! handle, the Tauri event bridge, and small helpers.

pub mod error;
pub mod events;
pub mod platform;
pub mod state;
pub mod util;

pub mod external;
