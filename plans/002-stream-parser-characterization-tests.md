# Plan 002: Characterization tests for the agent stream-JSON parser

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat c3fb026..HEAD -- src-tauri/src/agent/stream.rs src-tauri/src/domain/event.rs`
> If either file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/001-cargo-test-in-ci.md (so these tests run in CI; you may still write them before 001 lands)
- **Category**: tests
- **Planned at**: commit `c3fb026`, 2026-06-10

## Why this matters

`agent/stream.rs::parse_line` translates each line of `claude --output-format
stream-json` into warden's normalized `AgentEvent` enum — the single contract the
entire transcript UI renders against. It parses **untrusted** external process
output and is explicitly documented to "never panic." It has zero tests today, so
any change to the parsing (a new block type, a renamed field, a refactor) can
silently drop or corrupt a turn's events with nothing to catch it. Characterizing
the current behavior with tests locks in the contract and makes the parser safe to
evolve. It's also the lowest-risk place to establish the Rust testing pattern for
the rest of the backend.

## Current state

- `src-tauri/src/agent/stream.rs` — the parser. Pure functions, no IO. Public
  entry point:

```rust
// stream.rs:56
pub fn parse_line(line: &str) -> Option<ParsedLine> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    let value: Value = serde_json::from_str(line).ok()?;

    match value.get("type").and_then(Value::as_str) {
        Some("system") => Some(parse_system(&value)),
        Some("assistant") => Some(ParsedLine { events: ..., cost_usd: None, usage: ... }),
        Some("user") => Some(ParsedLine::events(...)),
        Some("stream_event") => Some(parse_stream_event(&value)),
        Some("result") => Some(parse_result(&value)),
        _ => Some(ParsedLine::empty()),
    }
}
```

- `ParsedLine` (stream.rs:17) has public fields: `events: Vec<AgentEvent>`,
  `cost_usd: Option<f64>`, `usage: Option<TokenUsage>`.
- The `AgentEvent` enum (`src-tauri/src/domain/event.rs:29`) is serde-tagged
  `#[serde(tag = "type", rename_all = "snake_case")]`. **It does NOT derive
  `PartialEq`** — so you CANNOT write `assert_eq!(event, AgentEvent::Foo{..})`.
  Assert by pattern-matching on the variant and checking its fields, OR by
  serializing to `serde_json::Value` and comparing. This plan uses
  pattern-matching (no extra derives, no source changes).
- Key behaviors to characterize (read the full file before writing tests):
  - Blank / whitespace-only line → `parse_line` returns `None` (stream.rs:57-60).
  - Non-JSON line → returns `None` (the `.ok()?` at stream.rs:61).
  - Unknown `type` (valid JSON, unrecognized) → `Some` with empty `events`
    (stream.rs:79).
  - `type:"system"` with `subtype:"init"` → one `SessionInit { model, tools }`;
    any other subtype → empty (stream.rs:83-101).
  - `type:"assistant"` with a `text` block → one `AssistantText`; empty-string
    text is dropped (stream.rs:154-162). `thinking` block → `Thinking`, dropped
    if blank (stream.rs:163-172). `tool_use` block → `ToolUse` (stream.rs:173-187).
  - A line-level `parent_tool_use_id` is stamped onto `ToolUse` / `AssistantText`
    via `with_parent` (stream.rs:106-149).
  - `type:"user"` with a `tool_result` block → `ToolResult`; content may be a bare
    string or an array of `{type:"text",text}` blocks (stream.rs:192-226).
  - Tool-result content longer than `MAX_TOOL_RESULT_CHARS` (16_000) is clipped
    with the suffix `… (truncated)` (stream.rs:11-12, 228-239).
  - `type:"stream_event"` carrying a `content_block_delta` / `text_delta` →
    `TextDelta`; anything else → empty (stream.rs:241-255).
  - `type:"result"` → a `Result` event; `total_cost_usd` is surfaced on
    `ParsedLine.cost_usd`; `permission_denials` produce a trailing
    `PermissionRequest` (stream.rs:257-287).
  - `usage` parsing: all-zero usage → `None` (stream.rs:42-51).

- **Test convention** (match this exactly): Rust tests live in a `#[cfg(test)]`
  module at the bottom of the same file. See the existing exemplar in
  `src-tauri/src/cli/install.rs`:

```rust
// cli/install.rs (bottom of file)
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_version_from_cli_output() {
        assert_eq!(
            extract_version("claude 1.2.3 (abc)"),
            Some("1.2.3".to_string())
        );
    }
}
```

## Commands you will need

| Purpose            | Command                                                                          | Expected on success     |
|--------------------|----------------------------------------------------------------------------------|-------------------------|
| Run these tests    | `cargo test --manifest-path src-tauri/Cargo.toml stream::`                       | new tests pass          |
| Run full suite     | `cargo test --manifest-path src-tauri/Cargo.toml`                               | exit 0, `0 failed`      |
| Format check       | `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`               | exit 0                  |
| Clippy             | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`| exit 0, no warnings     |

> The first compile of the Tauri crate takes several minutes. A long pause is
> compilation, not a hang.

## Scope

**In scope** (the only file you should modify):
- `src-tauri/src/agent/stream.rs` — add a `#[cfg(test)] mod tests { … }` block at
  the end. Do not change any non-test code in this file.

**Out of scope** (do NOT touch):
- `src-tauri/src/domain/event.rs` — do NOT add `PartialEq` or any derive. Tests
  must work against the types as they are (pattern-match to assert).
- `providers/jsonrpc.rs`, `workflow/executor.rs`, `git/diff.rs` — these are the
  other untested high-risk modules, but `git/diff.rs` and `executor.rs` shell out
  to `git` / hold state and are NOT pure; they need fixtures and are deliberately
  deferred to a later plan. Test only `stream.rs` here.
- Any change to `parse_line`'s behavior. If a test reveals what looks like a bug,
  characterize the **current** behavior (the test documents what the code does
  today) and note the suspected bug in your report — do not "fix" it here.

## Git workflow

- Work on the current branch (isolated worktree).
- Conventional Commits: `test(agent): characterize stream-json parser`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add the test module skeleton

At the very end of `src-tauri/src/agent/stream.rs`, add:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::AgentEvent;

    // Helper: parse a line and return its events, asserting the line parsed.
    fn events(line: &str) -> Vec<AgentEvent> {
        parse_line(line).expect("line should parse").events
    }
}
```

**Verify**: `cargo test --manifest-path src-tauri/Cargo.toml stream::` → compiles
and runs (0 tests so far is fine).

### Step 2: Cover the `None` / empty cases

Add tests for the lines that produce no parse or no events:

```rust
    #[test]
    fn blank_line_is_none() {
        assert!(parse_line("   ").is_none());
        assert!(parse_line("").is_none());
    }

    #[test]
    fn non_json_is_none() {
        assert!(parse_line("not json at all").is_none());
    }

    #[test]
    fn unknown_type_yields_no_events() {
        let parsed = parse_line(r#"{"type":"banana"}"#).expect("parses");
        assert!(parsed.events.is_empty());
    }
```

**Verify**: `cargo test --manifest-path src-tauri/Cargo.toml stream::` → 3 passing.

### Step 3: Cover assistant text, thinking, and the empty-drop rule

Use pattern-matching to assert variant + field values. Example for an assistant
text block:

```rust
    #[test]
    fn assistant_text_block_becomes_assistant_text() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"hello"}]}}"#;
        let evs = events(line);
        assert_eq!(evs.len(), 1);
        match &evs[0] {
            AgentEvent::AssistantText { text, parent_tool_use_id } => {
                assert_eq!(text, "hello");
                assert!(parent_tool_use_id.is_none());
            }
            other => panic!("expected AssistantText, got {other:?}"),
        }
    }

    #[test]
    fn empty_assistant_text_is_dropped() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"text","text":""}]}}"#;
        assert!(events(line).is_empty());
    }
```

Add an analogous test for a `thinking` block → `AgentEvent::Thinking`, and that a
blank/whitespace `thinking` value is dropped.

**Verify**: `cargo test --manifest-path src-tauri/Cargo.toml stream::` → all pass.

### Step 4: Cover tool_use, the parent-id stamp, and tool_result (incl. truncation)

- A `tool_use` block (under `type:"assistant"`) → `AgentEvent::ToolUse` with the
  expected `id` / `name` / `input`.
- The same line **with** a top-level `"parent_tool_use_id":"task-1"` → the
  resulting `ToolUse` carries `parent_tool_use_id == Some("task-1")` (exercises
  `with_parent`).
- A `type:"user"` line with a `tool_result` block whose `content` is a bare
  string → `AgentEvent::ToolResult { content, .. }` with that string.
- A `tool_result` whose `content` is an array `[{"type":"text","text":"a"},
  {"type":"text","text":"b"}]` → content `"a\nb"`.
- Truncation: build a content string longer than 16_000 chars and assert the
  resulting `ToolResult.content` ends with `… (truncated)` and is shorter than the
  input. Example:

```rust
    #[test]
    fn long_tool_result_is_truncated() {
        let big = "x".repeat(20_000);
        let line = format!(
            r#"{{"type":"user","message":{{"content":[{{"type":"tool_result","tool_use_id":"t","content":"{big}"}}]}}}}"#
        );
        match &events(&line)[0] {
            AgentEvent::ToolResult { content, .. } => {
                assert!(content.ends_with("… (truncated)"));
                assert!(content.chars().count() < 20_000);
            }
            other => panic!("expected ToolResult, got {other:?}"),
        }
    }
```

**Verify**: `cargo test --manifest-path src-tauri/Cargo.toml stream::` → all pass.

### Step 5: Cover stream_event delta, result + cost, and permission denials

- A `stream_event` with `event.type == "content_block_delta"` and
  `event.delta.type == "text_delta"` and a `text` → one `AgentEvent::TextDelta`.
- A `stream_event` that is not a text delta → empty events.
- A `type:"result"` line with `"total_cost_usd": 0.42` → `ParsedLine.cost_usd ==
  Some(0.42)` and `events[0]` is `AgentEvent::Result`.
- A `result` line with a non-empty `permission_denials` array (each entry has
  `tool_name`, `tool_input`) → events contain a trailing
  `AgentEvent::PermissionRequest` whose `denials` is non-empty. For a `Bash`
  denial with `tool_input.command == "ls"`, the denial's `pattern` is `"Bash(ls)"`
  (see `tool_pattern`, stream.rs:302-309).

**Verify**: `cargo test --manifest-path src-tauri/Cargo.toml stream::` → all pass.

### Step 6: Full suite + lint gates

**Verify**:
- `cargo test --manifest-path src-tauri/Cargo.toml` → exit 0, `0 failed`.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check` → exit 0.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
  → exit 0 (clippy lints test code too; fix any warnings it raises in your tests).

## Test plan

- New tests: in `src-tauri/src/agent/stream.rs`, a `#[cfg(test)] mod tests`
  covering, at minimum: blank line, non-JSON, unknown type, system/init,
  assistant text (+empty drop), thinking (+blank drop), tool_use, parent-id
  stamping, tool_result (string and array content), truncation, text-delta,
  non-delta stream_event, result+cost, and a Bash permission denial pattern.
  Target ~12–14 `#[test]` functions.
- Structural pattern to follow: `src-tauri/src/cli/install.rs`'s `mod tests`.
- Verification: `cargo test --manifest-path src-tauri/Cargo.toml stream::` shows
  all new tests passing and the full suite stays green.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `src-tauri/src/agent/stream.rs` ends with a `#[cfg(test)] mod tests` block
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml stream::` runs ≥12 tests, all passing
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` exits 0 with `0 failed`
- [ ] `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check` exits 0
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` exits 0
- [ ] `git status --porcelain` shows only `src-tauri/src/agent/stream.rs` modified
- [ ] `plans/README.md` status row for 002 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `stream.rs` or `domain/event.rs` no longer matches the "Current state"
  excerpts (the parser drifted since this plan was written).
- You feel you must add `PartialEq` (or any derive) to `AgentEvent`, or change
  any non-test code, to make a test pass — that means an assertion approach is
  wrong; switch to pattern-matching and report if still stuck.
- A test you wrote to characterize *current* behavior reveals what looks like a
  real bug (e.g. data loss on a valid line). Keep the test asserting the actual
  current behavior, finish the plan, and flag the suspected bug in your report.

## Maintenance notes

- App crate (`"private": true`) — no changeset needed for test-only changes.
- These tests pin the **claude** stream format. When the Codex provider or a
  third backend gets the same treatment, give it its own `#[cfg(test)]` module in
  its own parser file rather than overloading this one.
- Reviewer should check that tests assert behavior (inputs → events), not
  internal structure, and that no production code in `stream.rs` changed.
- Deferred on purpose: `providers/jsonrpc.rs`, `workflow/executor.rs`, and
  `git/diff.rs` still lack tests; the latter two need process/fixture harnesses
  and belong in a follow-up plan.
