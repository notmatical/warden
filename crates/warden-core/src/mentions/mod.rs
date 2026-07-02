//! Data sources for composer mentions: `@` files, `/` commands and skills, and
//! `#` GitHub issue/PR references. The Tauri command wrappers (resolving the
//! working dir, the user's home for `.claude`, and the blocking-thread offload)
//! live in the shell; this is the Tauri-free service layer.

mod commands_index;
mod files;
mod repo_refs;

pub use commands_index::{list_commands, CommandScope, SlashCommand};
pub use files::{walk_files, FileEntry, MAX_FILES};
pub use repo_refs::{fetch_repo_ref, list_repo_refs, RefKind, RepoComment, RepoRef, RepoRefBody};
