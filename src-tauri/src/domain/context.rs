use serde::{Deserialize, Serialize};

/// A piece of context injected into an agent's system prompt for a session.
/// Phase 1 covers manual sources; GitHub refs and node-graph outputs come later.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ContextSource {
    /// A single file: its directory is made accessible and it's referenced by
    /// path in the prompt.
    File { path: String },
    /// A directory added to the agent's accessible roots.
    Dir { path: String },
    /// A saved text snippet inlined into the prompt.
    Text { label: String, body: String },
}

/// A persisted, ordered, toggleable context source on a session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionContextSource {
    pub id: String,
    pub session_id: String,
    pub position: i64,
    pub enabled: bool,
    pub source: ContextSource,
}
