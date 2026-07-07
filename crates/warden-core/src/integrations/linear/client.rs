//! Linear's GraphQL surface: the queries warden issues and the typed shapes it
//! parses. Transport, pagination, and error-unwrapping all live in
//! [`crate::net::graphql`]; this module only owns the documents and types.
//!
//! Personal API keys authenticate via the raw `Authorization: <key>` header — no
//! `Bearer` prefix (that's OAuth). For bulk reads we hand-write the query to
//! fetch every field in one request, avoiding the N+1 round-trips the lazy
//! connection SDKs incur.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::Result;
use crate::net::graphql::{self, Page};

const API_URL: &str = "https://api.linear.app/graphql";

/// POST a Linear GraphQL document. Linear keys are bare-header auth, so the key
/// is the `Authorization` value verbatim.
async fn request<T: DeserializeOwned>(
    key: &str,
    query: &str,
    variables: serde_json::Value,
) -> Result<T> {
    graphql::request(API_URL, key, query, variables).await
}

/// Validate `key` by fetching the authenticated user. A bad/revoked key fails
/// here with an `auth`-tagged error (see [`graphql::GqlFailure`]).
pub async fn fetch_viewer(key: &str) -> Result<Viewer> {
    let data: ViewerData = request(key, VIEWER_QUERY, serde_json::Value::Null).await?;
    Ok(data.viewer)
}

/// Every issue assigned to the authenticated user, newest-updated first.
pub async fn fetch_assigned_issues(key: &str) -> Result<Vec<LinearIssue>> {
    let filter = serde_json::json!({ "assignee": { "isMe": { "eq": true } } });
    graphql::paginate(50, |after| {
        let filter = filter.clone();
        async move {
            let vars = serde_json::json!({ "first": 100, "after": after, "filter": filter });
            let data: IssuesData = request(key, ISSUES_QUERY, vars).await?;
            Ok(Page {
                items: data
                    .issues
                    .nodes
                    .into_iter()
                    .map(LinearIssue::from)
                    .collect(),
                next: data.issues.page_info.next(),
            })
        }
    })
    .await
}

/// All comments on an issue, oldest first. Fetched live per issue (never part
/// of the poll loop) so the peek panel is always current; capped at 5 pages.
pub async fn fetch_issue_comments(key: &str, issue_id: &str) -> Result<Vec<LinearComment>> {
    let mut all: Vec<LinearComment> = graphql::paginate(5, |after| async move {
        let vars = serde_json::json!({ "id": issue_id, "first": 50, "after": after });
        let data: CommentsData = request(key, COMMENTS_QUERY, vars).await?;
        let conn = data.issue.comments;
        Ok(Page {
            next: conn.page_info.next(),
            items: conn.nodes,
        })
    })
    .await?;

    all.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    Ok(all)
}

/// Every team visible to the user, with its projects — for the repo-binding
/// picker. One page of projects per team is plenty there.
pub async fn fetch_teams(key: &str) -> Result<Vec<LinearTeam>> {
    graphql::paginate(10, |after| async move {
        let vars = serde_json::json!({ "first": 50, "after": after });
        let data: TeamsData = request(key, TEAMS_QUERY, vars).await?;
        Ok(Page {
            items: data.teams.nodes.into_iter().map(LinearTeam::from).collect(),
            next: data.teams.page_info.next(),
        })
    })
    .await
}

/// A team's workflow states (Backlog, Todo, In Progress, Done…), for resolving
/// writeback targets by state category.
pub async fn fetch_team_states(key: &str, team_id: &str) -> Result<Vec<LinearWorkflowState>> {
    let vars = serde_json::json!({ "id": team_id });
    let data: TeamStatesData = request(key, TEAM_STATES_QUERY, vars).await?;
    Ok(data.team.states.nodes)
}

/// The team an issue currently belongs to (live, not from cache — the cached
/// row may be gone by the time writeback fires).
pub async fn fetch_issue_team_id(key: &str, issue_id: &str) -> Result<String> {
    let vars = serde_json::json!({ "id": issue_id });
    let data: IssueTeamData = request(key, ISSUE_TEAM_QUERY, vars).await?;
    Ok(data.issue.team.id)
}

/// Move an issue to a workflow state.
pub async fn update_issue_state(key: &str, issue_id: &str, state_id: &str) -> Result<()> {
    let vars = serde_json::json!({ "id": issue_id, "stateId": state_id });
    let data: IssueUpdateData = request(key, ISSUE_SET_STATE_MUTATION, vars).await?;
    if !data.issue_update.success {
        return Err(crate::error::AppError::Integration(
            "linear: issueUpdate failed".into(),
        ));
    }
    Ok(())
}

/// Attach a GitHub PR link to an issue (renders natively in Linear).
pub async fn attach_github_url(key: &str, issue_id: &str, url: &str) -> Result<()> {
    let vars = serde_json::json!({ "issueId": issue_id, "url": url });
    let data: AttachGithubData = request(key, ATTACH_GITHUB_MUTATION, vars).await?;
    if !data.attachment_link_git_hub.success {
        return Err(crate::error::AppError::Integration(
            "linear: attachmentLinkGitHub failed".into(),
        ));
    }
    Ok(())
}

/// Create an issue on a team. Returns the new issue's identifier and URL so the
/// caller (an agent) can link back to it.
pub async fn create_issue(
    key: &str,
    team_id: &str,
    title: &str,
    description: Option<&str>,
) -> Result<CreatedIssue> {
    let vars = serde_json::json!({
        "input": { "teamId": team_id, "title": title, "description": description }
    });
    let data: IssueCreateData = request(key, ISSUE_CREATE_MUTATION, vars).await?;
    if !data.issue_create.success {
        return Err(crate::error::AppError::Integration(
            "linear: issueCreate failed".into(),
        ));
    }
    data.issue_create.issue.ok_or_else(|| {
        crate::error::AppError::Integration("linear: issueCreate returned no issue".into())
    })
}

/// Post a comment on an issue.
pub async fn create_comment(key: &str, issue_id: &str, body: &str) -> Result<()> {
    let vars = serde_json::json!({ "input": { "issueId": issue_id, "body": body } });
    let data: CommentCreateData = request(key, COMMENT_CREATE_MUTATION, vars).await?;
    if !data.comment_create.success {
        return Err(crate::error::AppError::Integration(
            "linear: commentCreate failed".into(),
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// GraphQL documents
// ---------------------------------------------------------------------------

const VIEWER_QUERY: &str = "query { viewer { id name email } }";

const TEAM_STATES_QUERY: &str = r#"
query TeamStates($id: String!) {
  team(id: $id) { states(first: 50) { nodes { id type position } } }
}
"#;

const ISSUE_TEAM_QUERY: &str = r#"
query IssueTeam($id: String!) { issue(id: $id) { team { id } } }
"#;

const ISSUE_SET_STATE_MUTATION: &str = r#"
mutation IssueSetState($id: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId }) { success }
}
"#;

const ATTACH_GITHUB_MUTATION: &str = r#"
mutation AttachPr($issueId: String!, $url: String!) {
  attachmentLinkGitHub(issueId: $issueId, url: $url) { success }
}
"#;

const ISSUE_CREATE_MUTATION: &str = r#"
mutation IssueCreate($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { id identifier url } }
}
"#;

const COMMENT_CREATE_MUTATION: &str = r#"
mutation CommentCreate($input: CommentCreateInput!) {
  commentCreate(input: $input) { success }
}
"#;

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
      branchName
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
    /// Linear's workspace-configured git branch name for the issue.
    /// Defaulted so payloads cached before this field existed still parse.
    #[serde(default)]
    pub branch_name: String,
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

/// One of a team's workflow states. `state_type` is the Linear category
/// (backlog | unstarted | started | completed | canceled); `position` orders
/// states within a category (lowest = the team's primary state of that kind).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinearWorkflowState {
    pub id: String,
    #[serde(rename = "type")]
    pub state_type: String,
    pub position: f64,
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
            branch_name: r.branch_name,
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

impl PageInfo {
    /// The cursor to fetch the next page, or `None` when the connection is
    /// exhausted (no next page, or a next page with no cursor to follow).
    fn next(self) -> Option<String> {
        if self.has_next_page {
            self.end_cursor
        } else {
            None
        }
    }
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
    branch_name: String,
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
struct TeamStatesData {
    team: TeamStates,
}

#[derive(Deserialize)]
struct TeamStates {
    states: StateConnection,
}

#[derive(Deserialize)]
struct StateConnection {
    nodes: Vec<LinearWorkflowState>,
}

#[derive(Deserialize)]
struct IssueTeamData {
    issue: IssueTeam,
}

#[derive(Deserialize)]
struct IssueTeam {
    team: TeamIdRef,
}

#[derive(Deserialize)]
struct TeamIdRef {
    id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssueUpdateData {
    issue_update: MutationSuccess,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttachGithubData {
    attachment_link_git_hub: MutationSuccess,
}

#[derive(Deserialize)]
struct MutationSuccess {
    success: bool,
}

/// A newly created issue, surfaced to the agent that requested it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedIssue {
    pub id: String,
    pub identifier: String,
    pub url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssueCreateData {
    issue_create: IssueCreatePayload,
}

#[derive(Deserialize)]
struct IssueCreatePayload {
    success: bool,
    issue: Option<CreatedIssue>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommentCreateData {
    comment_create: MutationSuccess,
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
    ///   cargo test -p warden-core linear_smoke -- --nocapture
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
