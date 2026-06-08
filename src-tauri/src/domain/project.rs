use serde::{Deserialize, Serialize};
use specta::Type;

/// A project is a project root the user has opened. When it is a git
/// repository, sessions get isolated worktrees; otherwise they run in-place.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_git: bool,
    pub created_at: String,
}
