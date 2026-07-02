//! HTTP + archive primitives the managed-tool distributions build on. Tauri-free
//! and credential-free: GitHub tokens are always passed in, never resolved here.

pub mod archive;
pub mod graphql;
pub mod http;
pub mod version;

pub use archive::{extract, extract_tar_gz, extract_zip, host_binary_name};
pub use http::{
    download_bytes, github_get, github_releases, http_client, GitHubAsset, GitHubRelease,
};
pub use version::{extract_version, version_from_tag};
