use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use specta::Type;

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
