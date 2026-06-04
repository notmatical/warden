//! Git: a thin wrapper over the `git` CLI plus worktree provisioning for
//! isolated sessions.

mod cli;
mod worktree;

pub use cli::*;
pub use worktree::{provision_working_dir, ProvisionedDir};
