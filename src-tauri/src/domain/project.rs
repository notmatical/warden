use serde::{Deserialize, Serialize};

/// A project is a project root the user has opened. When it is a git
/// repository, sessions get isolated worktrees; otherwise they run in-place.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_git: bool,
    pub created_at: String,
}
