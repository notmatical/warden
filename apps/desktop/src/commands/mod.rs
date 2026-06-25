//! Thin `#[tauri::command]` wrappers, one module per domain. Each pulls the
//! shared `AppState`, calls into a `warden-core` service, and maps the core
//! error to the IPC error at the boundary. No domain logic lives here.

pub mod agent;
pub mod core;
pub mod external;
pub mod git;
pub mod github;
pub mod linear;
pub mod mcp;
pub mod mentions;
pub mod providers;
pub mod session;
pub mod terminal;
pub mod workflow;
pub mod workspace;
