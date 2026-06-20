//! A minimal GraphQL-over-HTTP transport: one authed POST that unwraps the
//! `data`/`errors` envelope, plus a cursor `paginate` helper that collapses the
//! hand-rolled "loop until `hasNextPage`" sites. Parameterized by `(url,
//! auth_header)` so each integration supplies its own endpoint and credential
//! scheme — Linear uses a bare `Authorization: <key>` header (no `Bearer`).

use serde::de::DeserializeOwned;
use serde::Deserialize;

use crate::error::{AppError, Result};
use crate::net::http::http_client;

/// The GraphQL response envelope: at most one of `data`/`errors` is meaningful.
#[derive(Deserialize)]
pub struct GqlResponse<T> {
    pub data: Option<T>,
    pub errors: Option<Vec<GqlError>>,
}

/// One GraphQL-level error. Only `message` is surfaced; the rest is server detail.
#[derive(Deserialize)]
pub struct GqlError {
    pub message: String,
}

/// Whether a failing GraphQL POST is an auth problem (key bad/revoked) or a
/// transport/server problem. The shell branches on this to prompt re-connect
/// instead of showing a generic error. Carried inside [`AppError::Integration`]
/// as a message prefix so the existing error taxonomy is untouched.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GqlFailure {
    /// 401/403 (or 400 from a malformed/revoked key) — the credential is no good.
    Auth,
    /// Transport, 5xx, or any other non-success — retryable, not a credential issue.
    Transport,
}

impl GqlFailure {
    /// Classify an HTTP status. 401/403/400 read as auth (Linear answers a bad
    /// key with 400); everything else is transport.
    fn from_status(status: reqwest::StatusCode) -> Self {
        match status.as_u16() {
            400 | 401 | 403 => GqlFailure::Auth,
            _ => GqlFailure::Transport,
        }
    }

    /// The message tag the shell substring-matches to decide whether to prompt
    /// re-connect. Kept stable and machine-greppable.
    pub fn tag(self) -> &'static str {
        match self {
            GqlFailure::Auth => "auth",
            GqlFailure::Transport => "transport",
        }
    }
}

/// POST a GraphQL document to `url`, authed with `auth_header` as the raw
/// `Authorization` value, and return its `data`. Surfaces transport, HTTP, and
/// GraphQL-level errors as [`AppError::Integration`]; HTTP failures are tagged
/// `auth`/`transport` (see [`GqlFailure`]) so the frontend can prompt re-connect.
pub async fn request<T: DeserializeOwned>(
    url: &str,
    auth_header: &str,
    query: &str,
    variables: serde_json::Value,
) -> Result<T> {
    let resp = http_client()?
        .post(url)
        .header("Authorization", auth_header)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "query": query, "variables": variables }))
        .send()
        .await
        .map_err(|e| AppError::Integration(format!("graphql [transport]: request failed: {e}")))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| AppError::Integration(format!("graphql [transport]: read failed: {e}")))?;

    if !status.is_success() {
        let failure = GqlFailure::from_status(status);
        return Err(AppError::Integration(format!(
            "graphql [{}]: HTTP {status}: {text}",
            failure.tag()
        )));
    }

    let body: GqlResponse<T> = serde_json::from_str(&text)
        .map_err(|e| AppError::Integration(format!("graphql [transport]: decode failed: {e}")))?;

    if let Some(errors) = body.errors {
        let msg = errors
            .into_iter()
            .map(|e| e.message)
            .collect::<Vec<_>>()
            .join("; ");
        return Err(AppError::Integration(format!("graphql [transport]: {msg}")));
    }

    body.data
        .ok_or_else(|| AppError::Integration("graphql [transport]: empty response".into()))
}

/// One page of a cursor-paginated connection: the items plus the cursor to fetch
/// the next page (`None` when exhausted).
pub struct Page<T> {
    pub items: Vec<T>,
    pub next: Option<String>,
}

/// Walk a cursor-paginated connection, accumulating every page's items. `cap`
/// bounds the page count so a pathological cursor can never loop forever.
/// `fetch_page` is given the current `after` cursor (`None` on the first call)
/// and returns that page's items plus the next cursor.
pub async fn paginate<T, F, Fut>(cap: usize, mut fetch_page: F) -> Result<Vec<T>>
where
    F: FnMut(Option<String>) -> Fut,
    Fut: std::future::Future<Output = Result<Page<T>>>,
{
    let mut all = Vec::new();
    let mut after: Option<String> = None;

    for _ in 0..cap {
        let page = fetch_page(after).await?;
        all.extend(page.items);
        match page.next {
            Some(cursor) => after = Some(cursor),
            None => break,
        }
    }

    Ok(all)
}
