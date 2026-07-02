//! Read-side projections over a session's event log that the engine and the
//! workflow executor need: the concatenated assistant output a node hands to the
//! next, and whether a turn ended blocked on a user question. Parsing logic
//! about `AgentEvent` shapes (`ExitPlanMode`, `AskUserQuestion`) belongs with the
//! agent engine, not the store — the store stays a dumb event sink.

use crate::error::Result;
use crate::store::Store;
use crate::AgentEvent;

/// Concatenate a session's output across its turns — used to hand one workflow
/// node's result to the next. Joins `AssistantText` blocks, plus the plan from an
/// `ExitPlanMode` call (a plan node delivers its plan there, not as assistant
/// text), in order. Skips transient deltas and tool chatter.
pub fn get_session_assistant_text(store: &Store, session_id: &str) -> Result<String> {
    let mut out = String::new();
    for record in store.list_events(session_id)? {
        let text = match record.event {
            AgentEvent::AssistantText { text, .. } => text,
            AgentEvent::ToolUse { name, input, .. } if name == "ExitPlanMode" => input
                .get("plan")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            _ => continue,
        };
        if text.trim().is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push_str("\n\n");
        }
        out.push_str(&text);
    }
    Ok(out)
}

/// Whether a session's most recent turn ended on an unanswered
/// `AskUserQuestion` — i.e. the agent is waiting for the user, even though its
/// status settled to Idle. Scans newest-first: a later user message means the
/// question was already answered.
pub fn session_has_pending_question(store: &Store, session_id: &str) -> Result<bool> {
    for record in store.list_events(session_id)?.into_iter().rev() {
        match record.event {
            AgentEvent::UserMessage { .. } => return Ok(false),
            AgentEvent::ToolUse { name, .. } if name == "AskUserQuestion" => return Ok(true),
            _ => {}
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::NewSession;
    use crate::util::uuid;
    use crate::{Backend, EffortLevel, PermissionMode, SessionKind, SessionRole};
    use serde_json::json;

    // The events table FK-references sessions, so tests seed a real row.
    fn store_with_session() -> (Store, String) {
        let store = Store::open_in_memory().unwrap();
        let project = store.upsert_project("proj", "C:/tmp/proj", false).unwrap();
        let group_id = store.ensure_group_for_project(&project.id, "proj").unwrap();
        let session = store
            .create_session(NewSession {
                group_id,
                project_id: project.id,
                title: "t".into(),
                kind: SessionKind::Agent,
                backend: Backend::Claude,
                model: "claude-fable-5".into(),
                permission_mode: PermissionMode::Default,
                effort: EffortLevel::High,
                role: SessionRole::Chat,
                auto_named: false,
                agent_session_id: uuid(),
                terminal_command: None,
                working_dir: "C:/tmp/proj".into(),
                branch: None,
                base_sha: None,
                base_branch: None,
                is_isolated: false,
                parent_id: None,
                workflow_id: None,
                linear_issue_id: None,
            })
            .unwrap();
        (store, session.id)
    }

    #[test]
    fn assistant_text_joins_blocks_and_plans() {
        let (store, sid) = store_with_session();
        store
            .append_event(
                &sid,
                &AgentEvent::AssistantText {
                    text: "first".to_string(),
                    parent_tool_use_id: None,
                },
            )
            .unwrap();
        store
            .append_event(
                &sid,
                &AgentEvent::ToolUse {
                    id: "1".to_string(),
                    name: "ExitPlanMode".to_string(),
                    input: json!({ "plan": "the plan" }),
                    parent_tool_use_id: None,
                },
            )
            .unwrap();
        assert_eq!(
            get_session_assistant_text(&store, &sid).unwrap(),
            "first\n\nthe plan"
        );
    }

    #[test]
    fn pending_question_detected_until_answered() {
        let (store, sid) = store_with_session();
        store
            .append_event(
                &sid,
                &AgentEvent::ToolUse {
                    id: "1".to_string(),
                    name: "AskUserQuestion".to_string(),
                    input: json!({}),
                    parent_tool_use_id: None,
                },
            )
            .unwrap();
        assert!(session_has_pending_question(&store, &sid).unwrap());
        store
            .append_event(
                &sid,
                &AgentEvent::UserMessage {
                    text: "answer".to_string(),
                },
            )
            .unwrap();
        assert!(!session_has_pending_question(&store, &sid).unwrap());
    }
}
