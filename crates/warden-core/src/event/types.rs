use serde::{Deserialize, Serialize};
use specta::Type;

/// A tool call the CLI denied for lack of permission. `pattern` is the
/// `--allowedTools` token that would permit it (e.g. `Bash(echo hi)` or `Read`).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolDenial {
    pub tool_name: String,
    pub pattern: String,
    pub input: serde_json::Value,
}

/// The four [`TokenUsage`] fields and the candidate JSON keys each may appear
/// under, in priority order — passed to [`TokenUsage::from_keys`]. Lets one
/// parser serve every backend's naming (Claude `snake_case`, Codex `camelCase`
/// with a distinct cached-input key, …).
pub struct TokenUsageKeys<'a> {
    pub input: &'a [&'a str],
    pub output: &'a [&'a str],
    pub cache_read: &'a [&'a str],
    pub cache_creation: &'a [&'a str],
}

/// Token accounting for a turn, mirrored from the model's `usage` report. The
/// input side plus cache reads/writes approximates the context-window fill.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, Type)]
pub struct TokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    #[serde(default)]
    pub cache_read_input_tokens: u64,
    #[serde(default)]
    pub cache_creation_input_tokens: u64,
}

impl TokenUsage {
    /// Read a usage object into [`TokenUsage`], trying each field's candidate
    /// keys in order (first present wins). Returns `None` when every field reads
    /// zero, so the context gauge stays hidden rather than showing an empty turn.
    /// Replaces the per-backend `parse_usage`/`codex_usage`/`step_usage` triplets.
    pub fn from_keys(obj: &serde_json::Value, keys: &TokenUsageKeys<'_>) -> Option<Self> {
        let get = |candidates: &[&str]| {
            candidates
                .iter()
                .find_map(|k| obj.get(k).and_then(serde_json::Value::as_u64))
                .unwrap_or(0)
        };
        let usage = TokenUsage {
            input_tokens: get(keys.input),
            output_tokens: get(keys.output),
            cache_read_input_tokens: get(keys.cache_read),
            cache_creation_input_tokens: get(keys.cache_creation),
        };
        (usage != TokenUsage::default()).then_some(usage)
    }
}

/// A normalized agent event — the single contract the whole UI renders against,
/// regardless of which backend produced it. Backend-specific stream formats are
/// translated into this enum by each adapter.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    /// Emitted once the CLI confirms the conversation has started.
    SessionInit {
        model: Option<String>,
        tools: Vec<String>,
    },
    /// A message we sent on the user's behalf.
    UserMessage { text: String },
    /// A finalized assistant text block. `parent_tool_use_id` is set for a
    /// subagent's narration so the UI can fold it under the spawning Task.
    AssistantText {
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
    },
    /// A streaming text fragment. Transient — never persisted, UI-only sugar.
    TextDelta { text: String },
    /// Extended-thinking content.
    Thinking { text: String },
    /// The agent invoked a tool. `parent_tool_use_id` is set when the call ran
    /// inside a subagent (Task/Agent) — it points at that Task's tool_use id, so
    /// the UI can nest a subagent's activity under it.
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        parent_tool_use_id: Option<String>,
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
        /// Latest token usage (the final assistant message's), so the UI can
        /// show context-window fill. Stamped by the reader, not the parser.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        usage: Option<TokenUsage>,
    },
    /// One or more tool calls were denied for lack of permission. Approving
    /// resumes the turn with those tools added to the session's allowlist.
    PermissionRequest { denials: Vec<ToolDenial> },
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
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EventRecord {
    pub id: String,
    pub session_id: String,
    pub seq: i64,
    pub ts: String,
    #[serde(flatten)]
    pub event: AgentEvent,
}
