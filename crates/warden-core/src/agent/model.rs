//! Model-id helpers shared across the turn adapters.

/// Split a `-fast` priority-tier suffix off a model id: `claude-x-fast` →
/// (`claude-x`, true), otherwise (id, false). The fast tier is re-applied by the
/// adapter in whatever form its CLI expects (`--settings {"fastMode":true}` for
/// Claude, `serviceTier` for Codex).
///
/// Codex restricts the suffix to specific model families and keeps its own
/// stricter splitter; this is the plain form the Claude adapter uses.
pub fn split_fast(id: &str) -> (&str, bool) {
    match id.strip_suffix("-fast") {
        Some(base) => (base, true),
        None => (id, false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_fast_suffix() {
        assert_eq!(split_fast("claude-opus-4-fast"), ("claude-opus-4", true));
        assert_eq!(split_fast("claude-opus-4"), ("claude-opus-4", false));
    }
}
