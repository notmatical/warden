//! Shared text helpers for agent output. The single home for tool-result
//! clipping, previously copy-pasted in `agent/stream` and `providers/mod`.

/// Cap on persisted tool-result text; oversized output is clipped.
pub const MAX_TOOL_RESULT_CHARS: usize = 16_000;
const TRUNCATION_NOTE: &str = "… (truncated)";

/// Clip oversized text to [`MAX_TOOL_RESULT_CHARS`], appending a truncation note.
pub fn clip(mut s: String) -> String {
    if s.chars().count() > MAX_TOOL_RESULT_CHARS {
        let byte = s
            .char_indices()
            .nth(MAX_TOOL_RESULT_CHARS)
            .map(|(i, _)| i)
            .unwrap_or(s.len());
        s.truncate(byte);
        s.push_str(TRUNCATION_NOTE);
    }
    s
}
