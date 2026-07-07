//! The tool surface Warden exposes to agents, and its dispatch.
//!
//! v1 is Linear writes (plus a team lookup so `create_linear_issue` is usable):
//! create an issue, comment on one, move one's status. Each resolves the Linear
//! key from the keychain and calls the same GraphQL client the app uses.

use serde_json::{json, Value};

use crate::integrations::linear::{client, key, writeback};

/// The advertised tools, as MCP `tools/list` entries.
pub fn registry() -> Value {
    json!([
        {
            "name": "list_linear_teams",
            "description": "List the user's Linear teams (id, key, name). Call this first to find the teamId that create_linear_issue needs.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "create_linear_issue",
            "description": "Create a Linear issue on a team. Returns the new issue's identifier (e.g. ENG-123) and URL.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "teamId": { "type": "string", "description": "Linear team id from list_linear_teams." },
                    "title": { "type": "string" },
                    "description": { "type": "string", "description": "Optional markdown body." }
                },
                "required": ["teamId", "title"],
                "additionalProperties": false
            }
        },
        {
            "name": "comment_on_linear_issue",
            "description": "Post a comment on a Linear issue.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "issueId": { "type": "string", "description": "Linear issue id (UUID) or identifier." },
                    "body": { "type": "string", "description": "Comment markdown." }
                },
                "required": ["issueId", "body"],
                "additionalProperties": false
            }
        },
        {
            "name": "set_linear_issue_status",
            "description": "Move a Linear issue to its team's primary state of a given type.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "issueId": { "type": "string" },
                    "status": {
                        "type": "string",
                        "enum": ["backlog", "unstarted", "started", "completed", "canceled"],
                        "description": "Linear workflow state type. Aliases: todo=unstarted, in_progress=started, done=completed."
                    }
                },
                "required": ["issueId", "status"],
                "additionalProperties": false
            }
        },
        {
            "name": "comment_on_github_issue",
            "description": "Post a comment on a GitHub issue in the current repository (the session's working directory).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "number": { "type": "integer", "description": "Issue number." },
                    "body": { "type": "string", "description": "Comment markdown." }
                },
                "required": ["number", "body"],
                "additionalProperties": false
            }
        },
        {
            "name": "set_github_issue_status",
            "description": "Open or close a GitHub issue in the current repository.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "number": { "type": "integer" },
                    "state": {
                        "type": "string",
                        "enum": ["open", "closed"],
                        "description": "Target state."
                    }
                },
                "required": ["number", "state"],
                "additionalProperties": false
            }
        }
    ])
}

/// Dispatch a tool call. `Ok` text is shown to the agent as the result; `Err`
/// text is shown as an error result. Never panics on bad input.
pub async fn call(name: &str, args: Value) -> Result<String, String> {
    match name {
        "list_linear_teams" => list_teams().await,
        "create_linear_issue" => create_issue(&args).await,
        "comment_on_linear_issue" => comment(&args).await,
        "set_linear_issue_status" => set_status(&args).await,
        "comment_on_github_issue" => github_comment(&args).await,
        "set_github_issue_status" => github_set_status(&args).await,
        other => Err(format!("unknown tool: {other}")),
    }
}

async fn list_teams() -> Result<String, String> {
    let key = linear_key()?;
    let teams = client::fetch_teams(&key).await.map_err(|e| e.to_string())?;
    let rows: Vec<Value> = teams
        .iter()
        .map(|t| json!({ "id": t.id, "key": t.key, "name": t.name }))
        .collect();
    Ok(json!(rows).to_string())
}

async fn create_issue(args: &Value) -> Result<String, String> {
    let key = linear_key()?;
    let team_id = str_arg(args, "teamId")?;
    let title = str_arg(args, "title")?;
    let description = opt_str_arg(args, "description");
    let issue = client::create_issue(&key, team_id, title, description)
        .await
        .map_err(|e| e.to_string())?;
    Ok(format!("Created {} — {}", issue.identifier, issue.url))
}

async fn comment(args: &Value) -> Result<String, String> {
    let key = linear_key()?;
    let issue_id = str_arg(args, "issueId")?;
    let body = str_arg(args, "body")?;
    client::create_comment(&key, issue_id, body)
        .await
        .map_err(|e| e.to_string())?;
    Ok("Comment posted.".to_string())
}

async fn set_status(args: &Value) -> Result<String, String> {
    let key = linear_key()?;
    let issue_id = str_arg(args, "issueId")?;
    let state_type = normalize_status(str_arg(args, "status")?)?;
    writeback::transition_issue(&key, issue_id, state_type)
        .await
        .map_err(|e| e.to_string())?;
    Ok(format!("Moved issue to a {state_type} state."))
}

/// Map a caller-supplied status onto a Linear workflow state type, accepting a
/// few friendly aliases.
fn normalize_status(status: &str) -> Result<&'static str, String> {
    match status.trim().to_ascii_lowercase().as_str() {
        "backlog" => Ok("backlog"),
        "unstarted" | "todo" | "to do" => Ok("unstarted"),
        "started" | "in_progress" | "in progress" | "doing" => Ok("started"),
        "completed" | "done" | "complete" => Ok("completed"),
        "canceled" | "cancelled" => Ok("canceled"),
        other => Err(format!(
            "unknown status '{other}' (use backlog, unstarted, started, completed, or canceled)"
        )),
    }
}

async fn github_comment(args: &Value) -> Result<String, String> {
    let number = int_arg(args, "number")?;
    let body = str_arg(args, "body")?;
    let url = run_gh(&["issue", "comment", &number.to_string(), "--body", body]).await?;
    Ok(if url.is_empty() {
        "Comment posted.".to_string()
    } else {
        format!("Comment posted: {url}")
    })
}

async fn github_set_status(args: &Value) -> Result<String, String> {
    let number = int_arg(args, "number")?;
    let sub = match str_arg(args, "state")?.to_ascii_lowercase().as_str() {
        "closed" | "close" | "done" => "close",
        "open" | "reopen" => "reopen",
        other => return Err(format!("unknown state '{other}' (use open or closed)")),
    };
    run_gh(&["issue", sub, &number.to_string()]).await?;
    let verb = if sub == "close" { "closed" } else { "reopened" };
    Ok(format!("Issue #{number} {verb}."))
}

/// Run `gh` in the inherited working directory (the session's repo) and return
/// trimmed stdout, or a message built from stderr on failure.
async fn run_gh(args: &[&str]) -> Result<String, String> {
    let output = tokio::process::Command::new("gh")
        .args(args)
        .output()
        .await
        .map_err(|e| format!("failed to run gh ({e}); is the GitHub CLI installed?"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(format!(
            "gh: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

fn linear_key() -> Result<String, String> {
    match key::load() {
        Ok(Some(k)) => Ok(k),
        Ok(None) => Err("Linear is not connected in Warden.".to_string()),
        Err(e) => Err(format!("failed to load Linear key: {e}")),
    }
}

fn str_arg<'a>(args: &'a Value, name: &str) -> Result<&'a str, String> {
    args.get(name)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("missing required argument: {name}"))
}

fn opt_str_arg<'a>(args: &'a Value, name: &str) -> Option<&'a str> {
    args.get(name)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

/// Accept an integer arg, or a string that parses as one (agents sometimes
/// quote numbers).
fn int_arg(args: &Value, name: &str) -> Result<i64, String> {
    args.get(name)
        .and_then(|v| v.as_i64().or_else(|| v.as_str()?.trim().parse().ok()))
        .ok_or_else(|| format!("missing or invalid integer argument: {name}"))
}
