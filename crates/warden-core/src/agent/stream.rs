//! Parser for a single line of `claude --output-format stream-json`. Each line
//! is one JSON object; we translate the backend-specific shapes into the
//! normalized `AgentEvent` enum the rest of warden speaks.

use serde_json::Value;

use crate::event::text::clip;
use crate::event::TokenUsageKeys;
use crate::{AgentEvent, TokenUsage, ToolDenial};

/// The outcome of parsing one stream-json line: the normalized events it
/// produced (possibly none), any cost reported by a `result` line, and any
/// token usage reported by an `assistant` line.
pub struct ParsedLine {
    pub events: Vec<AgentEvent>,
    pub cost_usd: Option<f64>,
    pub usage: Option<TokenUsage>,
}

impl ParsedLine {
    fn events(events: Vec<AgentEvent>) -> Self {
        Self {
            events,
            cost_usd: None,
            usage: None,
        }
    }

    fn empty() -> Self {
        Self {
            events: Vec::new(),
            cost_usd: None,
            usage: None,
        }
    }
}

/// Read a model `usage` object into [`TokenUsage`], or `None` if it's empty.
fn parse_usage(value: &Value) -> Option<TokenUsage> {
    TokenUsage::from_keys(
        value,
        &TokenUsageKeys {
            input: &["input_tokens"],
            output: &["output_tokens"],
            cache_read: &["cache_read_input_tokens"],
            cache_creation: &["cache_creation_input_tokens"],
        },
    )
}

/// Parse one line of stream-json. Returns `None` for blank lines or lines that
/// aren't JSON; unknown-but-valid shapes yield an empty `ParsedLine`. Never
/// panics — the agent stream is untrusted input.
pub fn parse_line(line: &str) -> Option<ParsedLine> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    let value: Value = serde_json::from_str(line).ok()?;

    match value.get("type").and_then(Value::as_str) {
        Some("system") => Some(parse_system(&value)),
        Some("assistant") => Some(ParsedLine {
            events: parse_content_blocks(&value, parse_assistant_block),
            cost_usd: None,
            usage: value
                .get("message")
                .and_then(|m| m.get("usage"))
                .and_then(parse_usage),
        }),
        Some("user") => Some(ParsedLine::events(parse_content_blocks(
            &value,
            parse_user_block,
        ))),
        Some("stream_event") => Some(parse_stream_event(&value)),
        Some("result") => Some(parse_result(&value)),
        _ => Some(ParsedLine::empty()),
    }
}

fn parse_system(value: &Value) -> ParsedLine {
    if value.get("subtype").and_then(Value::as_str) != Some("init") {
        return ParsedLine::empty();
    }
    let model = value
        .get("model")
        .and_then(Value::as_str)
        .map(str::to_string);
    let tools = value
        .get("tools")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|t| t.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    ParsedLine::events(vec![AgentEvent::SessionInit { model, tools }])
}

/// Iterate `/message/content[]` and map each block via `f`, dropping `None`s.
/// A line-level `parent_tool_use_id` (present when this line is a subagent's
/// output) is stamped onto any tool calls so the UI can nest them.
fn parse_content_blocks(
    value: &Value,
    f: impl Fn(&Value) -> Option<AgentEvent>,
) -> Vec<AgentEvent> {
    let parent = value
        .get("parent_tool_use_id")
        .and_then(Value::as_str)
        .map(str::to_string);
    value
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(Value::as_array)
        .map(|blocks| {
            blocks
                .iter()
                .filter_map(&f)
                .map(|event| with_parent(event, &parent))
                .collect()
        })
        .unwrap_or_default()
}

/// Stamp a subagent's `parent_tool_use_id` onto a tool call; other events pass
/// through unchanged.
fn with_parent(event: AgentEvent, parent: &Option<String>) -> AgentEvent {
    if parent.is_none() {
        return event;
    }
    match event {
        AgentEvent::ToolUse {
            id, name, input, ..
        } => AgentEvent::ToolUse {
            id,
            name,
            input,
            parent_tool_use_id: parent.clone(),
        },
        AgentEvent::AssistantText { text, .. } => AgentEvent::AssistantText {
            text,
            parent_tool_use_id: parent.clone(),
        },
        other => other,
    }
}

fn parse_assistant_block(block: &Value) -> Option<AgentEvent> {
    match block.get("type").and_then(Value::as_str)? {
        "text" => {
            let text = block.get("text").and_then(Value::as_str)?;
            if text.is_empty() {
                return None;
            }
            Some(AgentEvent::AssistantText {
                text: text.to_string(),
                parent_tool_use_id: None,
            })
        }
        "thinking" => {
            let text = block.get("thinking").and_then(Value::as_str)?;
            // skip empty/redacted thinking blocks
            if text.trim().is_empty() {
                return None;
            }
            Some(AgentEvent::Thinking {
                text: text.to_string(),
            })
        }
        "tool_use" => Some(AgentEvent::ToolUse {
            id: block
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            name: block
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            input: block.get("input").cloned().unwrap_or(Value::Null),
            // Filled by `with_parent` from the line-level field.
            parent_tool_use_id: None,
        }),
        _ => None,
    }
}

fn parse_user_block(block: &Value) -> Option<AgentEvent> {
    if block.get("type").and_then(Value::as_str)? != "tool_result" {
        return None;
    }
    let content = block
        .get("content")
        .map(stringify_content)
        .unwrap_or_default();
    Some(AgentEvent::ToolResult {
        tool_use_id: block
            .get("tool_use_id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        content: clip(content),
        is_error: block
            .get("is_error")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

/// Tool-result content may be a bare string or an array of `{type:"text",text}`
/// blocks; collapse either into a single string.
fn stringify_content(content: &Value) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .filter_map(|b| b.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        other => other.to_string(),
    }
}

fn parse_stream_event(value: &Value) -> ParsedLine {
    let event = value.get("event");
    let is_delta =
        event.and_then(|e| e.get("type")).and_then(Value::as_str) == Some("content_block_delta");
    let delta = event.and_then(|e| e.get("delta"));
    let is_text = delta.and_then(|d| d.get("type")).and_then(Value::as_str) == Some("text_delta");
    if is_delta && is_text {
        if let Some(text) = delta.and_then(|d| d.get("text")).and_then(Value::as_str) {
            return ParsedLine::events(vec![AgentEvent::TextDelta {
                text: text.to_string(),
            }]);
        }
    }
    ParsedLine::empty()
}

fn parse_result(value: &Value) -> ParsedLine {
    let cost_usd = value.get("total_cost_usd").and_then(Value::as_f64);
    let mut events = vec![AgentEvent::Result {
        is_error: value
            .get("is_error")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        cost_usd,
        duration_ms: value.get("duration_ms").and_then(Value::as_u64),
        num_turns: value.get("num_turns").and_then(Value::as_u64),
        // The result line's own usage (cumulative across the turn's API calls) is
        // a fallback; the reader prefers the last assistant message's usage.
        usage: value.get("usage").and_then(parse_usage),
    }];

    // Tools the CLI denied this turn become an approval request. AskUserQuestion
    // is excluded: the transcript surfaces it as its own Q&A widget (a headless
    // CLI reports it as "denied" because it can't run an interactive prompt, but
    // it is not a permission gate).
    let denials: Vec<ToolDenial> = value
        .get("permission_denials")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(parse_denial)
                .filter(|d| d.tool_name != "AskUserQuestion")
                .collect()
        })
        .unwrap_or_default();
    if !denials.is_empty() {
        events.push(AgentEvent::PermissionRequest { denials });
    }

    ParsedLine {
        events,
        cost_usd,
        usage: None,
    }
}

fn parse_denial(value: &Value) -> Option<ToolDenial> {
    let tool_name = value.get("tool_name").and_then(Value::as_str)?.to_string();
    let input = value.get("tool_input").cloned().unwrap_or(Value::Null);
    let pattern = tool_pattern(&tool_name, &input);
    Some(ToolDenial {
        tool_name,
        pattern,
        input,
    })
}

/// The `--allowedTools` token that would permit a denied call: scope Bash to its
/// exact command, otherwise allow the whole tool.
fn tool_pattern(tool_name: &str, input: &Value) -> String {
    if tool_name == "Bash" {
        if let Some(cmd) = input.get("command").and_then(Value::as_str) {
            return format!("Bash({cmd})");
        }
    }
    tool_name.to_string()
}
