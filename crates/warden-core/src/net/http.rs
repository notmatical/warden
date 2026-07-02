//! Shared HTTP primitives for managed-tool installs: a reqwest client, the
//! GitHub-release shapes, and authenticated GitHub API helpers. The token is
//! always a parameter — this layer never resolves credentials, so it carries no
//! dependency on the GitHub integration.

use serde::Deserialize;

use crate::error::{AppError, Result};

const USER_AGENT: &str = "warden-app";

/// A reqwest client with warden's user agent and a bounded redirect policy.
pub fn http_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| AppError::Integration(format!("failed to build HTTP client: {e}")))
}

#[derive(Debug, Deserialize)]
pub struct GitHubRelease {
    pub tag_name: String,
    #[serde(default)]
    pub prerelease: bool,
    #[serde(default)]
    pub assets: Vec<GitHubAsset>,
}

#[derive(Debug, Deserialize)]
pub struct GitHubAsset {
    pub name: String,
    pub browser_download_url: String,
}

/// A GitHub API GET carrying the JSON headers, bearer-authed when a token is
/// passed. Pass `None` for the unauthenticated path (60/hr rate limit).
pub fn github_get(url: String, token: Option<&str>) -> Result<reqwest::RequestBuilder> {
    let mut req = http_client()?
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
    if let Some(token) = token {
        req = req.bearer_auth(token);
    }
    Ok(req)
}

/// The newest `per_page` releases for `owner/repo`, authed when a token is given.
pub async fn github_releases(
    owner: &str,
    repo: &str,
    per_page: u32,
    token: Option<&str>,
) -> Result<Vec<GitHubRelease>> {
    let url = format!("https://api.github.com/repos/{owner}/{repo}/releases?per_page={per_page}");
    github_get(url, token)?
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| AppError::Integration(format!("failed to fetch releases: {e}")))?
        .json()
        .await
        .map_err(|e| AppError::Integration(format!("failed to parse releases: {e}")))
}

/// Download a URL's full body as bytes.
pub async fn download_bytes(url: &str) -> Result<Vec<u8>> {
    let bytes = http_client()?
        .get(url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| AppError::Integration(format!("download failed: {e}")))?
        .bytes()
        .await
        .map_err(|e| AppError::Integration(format!("failed to read download: {e}")))?;
    Ok(bytes.to_vec())
}
