use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use specta::Type;

/// The top-level workspace: a named set of project roots plus a saved pane
/// layout. Sessions are opened against a group and may pull any of its roots
/// into context.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub name: String,
    /// Opaque JSON describing the saved pane layout (grid mode + pane→session
    /// assignments). The backend stores it verbatim; only the UI interprets it.
    pub layout: String,
    pub created_at: String,
}

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

/// A per-project label (GitHub-style) that can be attached to sessions.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Label {
    pub id: String,
    pub project_id: String,
    pub name: String,
    /// A palette token the frontend maps to fill/text/ring classes.
    pub color: String,
    pub created_at: String,
}

/// A project's labels plus which sessions each is attached to — one round-trip
/// for the folder view. `assignments` maps a session id to its label ids.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLabels {
    pub labels: Vec<Label>,
    pub assignments: HashMap<String, Vec<String>>,
}
