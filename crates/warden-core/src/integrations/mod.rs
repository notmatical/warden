//! External service integrations: GitHub (over the `gh` CLI) and Linear (over
//! GraphQL). The focus-tiered poll loops and the Tauri command wrappers live in
//! the shell; this is the Tauri-free client + service layer.

pub mod github;
pub mod linear;
