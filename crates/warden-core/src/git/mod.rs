//! Git: a thin wrapper over the `git` CLI plus worktree provisioning for
//! isolated sessions. Tauri-free — setup spawns emit via the global event sink.

mod cli;
pub mod diff;
mod merge;
mod remote;
pub mod setup;
mod worktree;

pub use cli::*;
pub use merge::{pull_upstream, sync_onto_base, MergeMode, MergeOutcome};
pub use remote::{normalize_remote_url, remote_browse_url, resolve_ssh_host};
pub use worktree::{is_managed_worktree, provision_working_dir, ProvisionedDir};
