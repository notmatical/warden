use serde::{Deserialize, Serialize};

/// The top-level workspace: a named set of project roots plus a saved pane
/// layout. Sessions are opened against a group and may pull any of its roots
/// into context.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub name: String,
    /// Opaque JSON describing the saved pane layout (grid mode + pane→session
    /// assignments). The backend stores it verbatim; only the UI interprets it.
    pub layout: String,
    pub created_at: String,
}

