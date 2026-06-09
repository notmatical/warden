//! Minimal Linear GraphQL client over reqwest. Personal API keys authenticate
//! via the raw `Authorization: <key>` header — no `Bearer` prefix (that's OAuth).
//! For bulk reads we hand-write the GraphQL query to fetch every field in one
//! request, avoiding the N+1 round-trips the lazy-connection SDKs incur.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::{AppError, Result};

const API_URL: &str = "https://api.linear.app/graphql";

fn http() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent("warden-app")
        .build()
        .map_err(|e| AppError::Integration(format!("http client: {e}")))
}

/// Post a GraphQL document and return its `data`, surfacing transport, HTTP, and
/// GraphQL-level errors as `AppError::Integration`.
async fn request<T: DeserializeOwned>(
    key: &str,
    query: &str,
    variables: serde_json::Value,
) -> Result<T> {
    let resp = http()?
        .post(API_URL)
        .header("Authorization", key)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "query": query, "variables": variables }))
        .send()
        .await
        .map_err(|e| AppError::Integration(format!("request failed: {e}")))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| AppError::Integration(format!("read response failed: {e}")))?;

    if !status.is_success() {
        // 400/401 here usually means a bad or revoked API key.
        return Err(AppError::Integration(format!(
            "linear HTTP {status}: {text}"
        )));
    }

    let body: GqlResponse<T> = serde_json::from_str(&text)
        .map_err(|e| AppError::Integration(format!("decode failed: {e}")))?;

    if let Some(errors) = body.errors {
        let msg = errors
            .into_iter()
            .map(|e| e.message)
            .collect::<Vec<_>>()
            .join("; ");
        return Err(AppError::Integration(format!("linear: {msg}")));
    }

    body.data
        .ok_or_else(|| AppError::Integration("linear: empty response".into()))
}

/// Validate `key` by fetching the authenticated user.
pub async fn fetch_viewer(key: &str) -> Result<Viewer> {
    let data: ViewerData = request(key, VIEWER_QUERY, serde_json::Value::Null).await?;
    Ok(data.viewer)
}

/// Every issue assigned to the authenticated user, newest-updated first.
pub async fn fetch_assigned_issues(key: &str) -> Result<Vec<LinearIssue>> {
    let filter = serde_json::json!({ "assignee": { "isMe": { "eq": true } } });
    let mut all = Vec::new();
    let mut after: Option<String> = None;

    // Cap pages so a pathological cursor can never loop forever.
    for _ in 0..50 {
        let vars = serde_json::json!({ "first": 100, "after": after, "filter": filter });
        let data: IssuesData = request(key, ISSUES_QUERY, vars).await?;
        all.extend(data.issues.nodes.into_iter().map(LinearIssue::from));

        if data.issues.page_info.has_next_page {
            match data.issues.page_info.end_cursor {
                Some(cursor) => after = Some(cursor),
                None => break,
            }
        } else {
            break;
        }
    }

    Ok(all)
}

/// All comments on an issue, oldest first. Fetched live per issue (never part
/// of the poll loop) so the peek panel is always current; capped at 5 pages.
pub async fn fetch_issue_comments(key: &str, issue_id: &str) -> Result<Vec<LinearComment>> {
    let mut all: Vec<LinearComment> = Vec::new();
    let mut after: Option<String> = None;

    for _ in 0..5 {
        let vars = serde_json::json!({ "id": issue_id, "first": 50, "after": after });
        let data: CommentsData = request(key, COMMENTS_QUERY, vars).await?;
        let conn = data.issue.comments;
        all.extend(conn.nodes);

        if conn.page_info.has_next_page {
            match conn.page_info.end_cursor {
                Some(cursor) => after = Some(cursor),
                None => break,
            }
        } else {
            break;
        }
    }

    all.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(all)
}

/// Every team visible to the user, with its projects — for the repo-binding
/// picker. One page of projects per team is plenty there.
pub async fn fetch_teams(key: &str) -> Result<Vec<LinearTeam>> {
    let mut all = Vec::new();
    let mut after: Option<String> = None;

    for _ in 0..10 {
        let vars = serde_json::json!({ "first": 50, "after": after });
        let data: TeamsData = request(key, TEAMS_QUERY, vars).await?;
        all.extend(data.teams.nodes.into_iter().map(LinearTeam::from));

        if data.teams.page_info.has_next_page {
            match data.teams.page_info.end_cursor {
                Some(cursor) => after = Some(cursor),
                None => break,
            }
        } else {
            break;
        }
    }

    Ok(all)
}

// ---------------------------------------------------------------------------
// GraphQL documents
// ---------------------------------------------------------------------------

const VIEWER_QUERY: &str = "query { viewer { id name email } }";

const TEAMS_QUERY: &str = r#"
query Teams($first: Int!, $after: String) {
  teams(first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { id key name projects(first: 100) { nodes { id name } } }
  }
}
"#;

const COMMENTS_QUERY: &str = r#"
query IssueComments($id: String!, $first: Int!, $after: String) {
  issue(id: $id) {
    comments(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id body createdAt user { id name email avatarUrl } }
    }
  }
}
"#;

const ISSUES_QUERY: &str = r#"
query Issues($first: Int!, $after: String, $filter: IssueFilter) {
  issues(first: $first, after: $after, filter: $filter, orderBy: updatedAt) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      identifier
      title
      description
      priority
      url
      updatedAt
      state { id name color type }
      assignee { id name email avatarUrl }
      team { id key name }
      project { id name }
      labels { nodes { name } }
    }
  }
}
"#;

// ---------------------------------------------------------------------------
// Public types (serialized to the frontend in camelCase)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Viewer {
    pub id: String,
    pub name: String,
    pub email: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LinearUserRef {
    pub id: String,
    pub name: String,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LinearState {
    pub id: String,
    pub name: String,
    pub color: String,
    /// Linear state category: backlog | unstarted | started | completed | canceled.
    #[serde(rename = "type")]
    pub state_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LinearTeamRef {
    pub id: String,
    pub key: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LinearProjectRef {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LinearIssue {
    pub id: String,
    pub identifier: String,
    pub title: String,
    pub description: Option<String>,
    pub priority: f64,
    pub url: String,
    pub updated_at: String,
    pub state: LinearState,
    pub assignee: Option<LinearUserRef>,
    pub team: LinearTeamRef,
    pub project: Option<LinearProjectRef>,
    pub labels: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LinearTeam {
    pub id: String,
    pub key: String,
    pub name: String,
    pub projects: Vec<LinearProjectRef>,
}

impl From<RawTeam> for LinearTeam {
    fn from(r: RawTeam) -> Self {
        LinearTeam {
            id: r.id,
            key: r.key,
            name: r.name,
            projects: r.projects.nodes,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LinearComment {
    pub id: String,
    pub body: String,
    pub created_at: String,
    pub user: Option<LinearUserRef>,
}

impl From<RawIssue> for LinearIssue {
    fn from(r: RawIssue) -> Self {
        LinearIssue {
            id: r.id,
            identifier: r.identifier,
            title: r.title,
            description: r.description,
            priority: r.priority,
            url: r.url,
            updated_at: r.updated_at,
            state: r.state,
            assignee: r.assignee,
            team: r.team,
            project: r.project,
            labels: r.labels.nodes.into_iter().map(|l| l.name).collect(),
        }
    }
}

// ---------------------------------------------------------------------------
// Raw GraphQL response shapes (deserialize-only)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct GqlResponse<T> {
    data: Option<T>,
    errors: Option<Vec<GqlError>>,
}

#[derive(Deserialize)]
struct GqlError {
    message: String,
}

#[derive(Deserialize)]
struct ViewerData {
    viewer: Viewer,
}

#[derive(Deserialize)]
struct IssuesData {
    issues: IssueConnection,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssueConnection {
    nodes: Vec<RawIssue>,
    page_info: PageInfo,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PageInfo {
    has_next_page: bool,
    end_cursor: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawIssue {
    id: String,
    identifier: String,
    title: String,
    description: Option<String>,
    priority: f64,
    url: String,
    updated_at: String,
    state: LinearState,
    assignee: Option<LinearUserRef>,
    team: LinearTeamRef,
    project: Option<LinearProjectRef>,
    labels: LabelConnection,
}

#[derive(Deserialize)]
struct LabelConnection {
    nodes: Vec<LabelNode>,
}

#[derive(Deserialize)]
struct TeamsData {
    teams: TeamConnection,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TeamConnection {
    nodes: Vec<RawTeam>,
    page_info: PageInfo,
}

#[derive(Deserialize)]
struct RawTeam {
    id: String,
    key: String,
    name: String,
    projects: ProjectConnection,
}

#[derive(Deserialize)]
struct ProjectConnection {
    nodes: Vec<LinearProjectRef>,
}

#[derive(Deserialize)]
struct CommentsData {
    issue: CommentIssue,
}

#[derive(Deserialize)]
struct CommentIssue {
    comments: CommentConnection,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommentConnection {
    nodes: Vec<LinearComment>,
    page_info: PageInfo,
}

#[derive(Deserialize)]
struct LabelNode {
    name: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Live smoke test against the real Linear API. Skipped unless
    /// `LINEAR_API_KEY` is set, so it is a no-op in CI. Run it with:
    ///   cargo test --manifest-path src-tauri/Cargo.toml linear_smoke -- --nocapture
    /// (with LINEAR_API_KEY set to a personal API key in the environment).
    #[tokio::test]
    async fn linear_smoke() {
        let Ok(key) = std::env::var("LINEAR_API_KEY") else {
            eprintln!("LINEAR_API_KEY not set — skipping live Linear smoke test");
            return;
        };

        let viewer = fetch_viewer(&key).await.expect("fetch_viewer failed");
        eprintln!("connected as: {} <{:?}>", viewer.name, viewer.email);

        let issues = fetch_assigned_issues(&key)
            .await
            .expect("fetch_assigned_issues failed");
        eprintln!("assigned issues: {}", issues.len());
        for issue in issues.iter().take(5) {
            eprintln!(
                "  {} [{}] {}",
                issue.identifier, issue.state.name, issue.title
            );
        }

        if let Some(issue) = issues.first() {
            let comments = fetch_issue_comments(&key, &issue.id)
                .await
                .expect("fetch_issue_comments failed");
            eprintln!("comments on {}: {}", issue.identifier, comments.len());
            for c in &comments {
                let who = c.user.as_ref().map(|u| u.name.as_str()).unwrap_or("?");
                eprintln!("  {} at {}: {} chars", who, c.created_at, c.body.len());
            }
        }
    }
}
