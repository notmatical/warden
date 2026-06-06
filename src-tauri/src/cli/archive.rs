//! Shared download + extraction primitives for managed-tool installs: an HTTP
//! client, GitHub-release helpers (token-authenticated), and archive extraction.
//! Each tool's own distribution logic (URLs, manifests, asset names) lives in
//! its provider module and builds on these.

use std::io::{Cursor, Read};
use std::path::Path;

use serde::Deserialize;

const USER_AGENT: &str = "warden-app";

pub fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))
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

/// A GitHub API request carrying the JSON headers and the user's token if known.
pub fn github_get(url: String) -> Result<reqwest::RequestBuilder, String> {
    let mut req = http_client()?
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
    if let Some(token) = crate::github::resolve_token() {
        req = req.bearer_auth(token);
    }
    Ok(req)
}

pub async fn github_releases(api: &str, per_page: u32) -> Result<Vec<GitHubRelease>, String> {
    github_get(format!("{api}?per_page={per_page}"))?
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("failed to fetch releases: {e}"))?
        .json()
        .await
        .map_err(|e| format!("failed to parse releases: {e}"))
}

/// Strip a release tag down to its semver (`rust-v0.1.2` / `v0.1.2` → `0.1.2`).
pub fn version_from_tag(tag: &str) -> String {
    for part in tag.split('v') {
        let trimmed = part.trim_end_matches('-');
        if trimmed.contains('.') && trimmed.chars().next().is_some_and(|c| c.is_ascii_digit()) {
            return trimmed.to_string();
        }
    }
    tag.to_string()
}

pub async fn download_bytes(url: &str) -> Result<Vec<u8>, String> {
    let bytes = http_client()?
        .get(url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("download failed: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("failed to read download: {e}"))?;
    Ok(bytes.to_vec())
}

/// Extract the first archive entry matching `matches`, returning its bytes.
pub fn extract_tar_gz(archive: &[u8], matches: impl Fn(&Path) -> bool) -> Result<Vec<u8>, String> {
    use flate2::read::GzDecoder;
    use tar::Archive;

    let mut tar = Archive::new(GzDecoder::new(Cursor::new(archive)));
    for entry in tar
        .entries()
        .map_err(|e| format!("failed to read tar: {e}"))?
    {
        let mut entry = entry.map_err(|e| format!("failed to read tar entry: {e}"))?;
        let path = entry
            .path()
            .map_err(|e| format!("failed to read tar path: {e}"))?
            .into_owned();
        if matches(&path) {
            let mut content = Vec::new();
            entry
                .read_to_end(&mut content)
                .map_err(|e| format!("failed to read binary from archive: {e}"))?;
            return Ok(content);
        }
    }
    Err("binary not found in tar.gz archive".to_string())
}

pub fn extract_zip(archive: &[u8], matches: impl Fn(&Path) -> bool) -> Result<Vec<u8>, String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(archive))
        .map_err(|e| format!("failed to open zip: {e}"))?;
    for i in 0..zip.len() {
        let mut file = zip
            .by_index(i)
            .map_err(|e| format!("failed to read zip entry: {e}"))?;
        let matched = file.enclosed_name().map(|p| matches(&p)).unwrap_or(false);
        if matched {
            let mut content = Vec::new();
            file.read_to_end(&mut content)
                .map_err(|e| format!("failed to read binary from archive: {e}"))?;
            return Ok(content);
        }
    }
    Err("binary not found in zip archive".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_release_tags_to_semver() {
        assert_eq!(version_from_tag("v2.62.0"), "2.62.0");
        assert_eq!(
            version_from_tag("rust-v0.116.0-alpha.12"),
            "0.116.0-alpha.12"
        );
    }
}
