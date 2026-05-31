use serde::{Deserialize, Serialize};

/// A normalized agent event — the single contract the whole UI renders against,
/// regardless of which backend produced it. Backend-specific stream formats are
/// translated into this enum by each adapter.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    /// Emitted once the CLI confirms the conversation has started.
    SessionInit {
        model: Option<String>,
        tools: Vec<String>,
    },
    /// A message we sent on the user's behalf.
    UserMessage { text: String },
    /// A finalized assistant text block.
    AssistantText { text: String },
    /// A streaming text fragment. Transient — never persisted, UI-only sugar.
    TextDelta { text: String },
    /// Extended-thinking content.
    Thinking { text: String },
    /// The agent invoked a tool.
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    /// The result of a tool invocation.
    ToolResult {
        tool_use_id: String,
        content: String,
        is_error: bool,
    },
    /// The turn completed.
    Result {
        is_error: bool,
        cost_usd: Option<f64>,
        duration_ms: Option<u64>,
        num_turns: Option<u64>,
    },
    /// A warden-level annotation (e.g. a handoff between sessions).
    Notice { text: String },
    /// A turn-level failure.
    Error { message: String },
}

impl AgentEvent {
    /// Transient events drive live UI but are not written to the event log.
    pub fn is_transient(&self) -> bool {
        matches!(self, AgentEvent::TextDelta { .. })
    }
}

/// A persisted, ordered event in a session's append-only log. The transcript
/// you render today and the cross-agent thread you render later are both just
/// projections over this log.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventRecord {
    pub id: String,
    pub session_id: String,
    pub seq: i64,
    pub ts: String,
    #[serde(flatten)]
    pub event: AgentEvent,
}
