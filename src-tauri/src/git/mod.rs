//! Git: a thin wrapper over the `git` CLI plus worktree provisioning for
//! isolated sessions.

mod cli;
pub mod diff;
pub mod setup;
mod worktree;

pub use cli::*;
pub use worktree::{
    is_managed_worktree, provision_pr_worktree, provision_working_dir, ProvisionedDir,
};

pub mod commands;
