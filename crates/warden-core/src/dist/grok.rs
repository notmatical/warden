//! Grok CLI distribution: the Grok Build CLI ships on npm (`@xai-official/grok`,
//! installing a `grok` bin) rather than as a host-specific release asset. warden
//! installs it into the tool's managed CLI dir via `npm install --prefix`, so the
//! binary lands at `<cli-dir>/node_modules/.bin/grok` (a `.cmd` shim on Windows).
//! Versions come from the npm registry.

use serde::Deserialize;

use crate::cli::{self, Tool};
use crate::dist::{emit_progress, Installed, ToolDistribution};
use crate::error::{AppError, Result};
use crate::net::http_client;

const PACKAGE: &str = "@xai-official/grok";
/// The registry packument URL (the scope's `/` is percent-encoded).
const REGISTRY_URL: &str = "https://registry.npmjs.org/@xai-official%2Fgrok";

pub struct GrokDist;

#[derive(Deserialize)]
struct Packument {
    #[serde(rename = "dist-tags")]
    dist_tags: DistTags,
}

#[derive(Deserialize)]
struct DistTags {
    latest: String,
}

/// The npm executable for the host (`npm.cmd` on Windows).
fn npm_program() -> &'static str {
    if cfg!(windows) {
        "npm.cmd"
    } else {
        "npm"
    }
}

/// Whether a string is a plausible npm version — guards against smuggling shell
/// or argv metacharacters into the install spec.
fn is_valid_version(version: &str) -> bool {
    !version.is_empty()
        && version.len() <= 64
        && version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+'))
}

#[async_trait::async_trait]
impl ToolDistribution for GrokDist {
    async fn latest_version(&self) -> Result<String> {
        let packument: Packument = http_client()?
            .get(REGISTRY_URL)
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(|e| {
                log::warn!("failed to fetch Grok versions from npm: {e}");
                AppError::Integration("Couldn't reach the npm registry to check Grok.".to_string())
            })?
            .json()
            .await
            .map_err(|e| {
                log::warn!("failed to parse Grok packument: {e}");
                AppError::Integration("Couldn't read Grok's versions from npm.".to_string())
            })?;
        Ok(packument.dist_tags.latest)
    }

    async fn install(&self, tool: Tool, version: Option<&str>) -> Result<Installed> {
        let dir = cli::cli_dir(tool)
            .ok_or_else(|| AppError::Invalid("app data dir is not initialized".to_string()))?;

        let version = match version {
            Some(v) => v.to_string(),
            None => self.latest_version().await?,
        };
        if !is_valid_version(&version) {
            return Err(AppError::Integration(format!(
                "refusing to install Grok: implausible version {version:?}"
            )));
        }
        let spec = format!("{PACKAGE}@{version}");

        emit_progress(tool, "installing", "Installing Grok CLI…", 40);

        // Spawn npm directly (no shell) so the prefix path and package spec are
        // discrete argv elements — no interpolation, no injection. `output()`
        // blocks, so run it off the async runtime.
        let output = tokio::task::spawn_blocking(move || {
            let mut cmd = std::process::Command::new(npm_program());
            crate::platform::silent_command(&mut cmd)
                .arg("install")
                .arg("--prefix")
                .arg(&dir)
                .arg(&spec)
                .output()
        })
        .await
        .map_err(|e| {
            log::error!("Grok install task panicked: {e}");
            AppError::Integration("Couldn't install the Grok CLI.".to_string())
        })?
        .map_err(|e| {
            log::warn!("failed to run npm for Grok: {e}");
            AppError::Integration(
                "Couldn't run npm — make sure Node.js is installed, then try again.".to_string(),
            )
        })?;

        if !output.status.success() {
            log::warn!(
                "npm install failed for Grok: {} / {}",
                String::from_utf8_lossy(&output.stdout).trim(),
                String::from_utf8_lossy(&output.stderr).trim()
            );
            return Err(AppError::Integration(
                "Couldn't install the Grok CLI. Make sure Node.js and npm are available, then try \
                 again."
                    .to_string(),
            ));
        }
        Ok(Installed::Managed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_validation_rejects_metacharacters() {
        assert!(is_valid_version("0.1.23"));
        assert!(is_valid_version("1.0.0-beta.4"));
        assert!(!is_valid_version(""));
        assert!(!is_valid_version("1.0 && rm -rf /"));
        assert!(!is_valid_version("latest; echo hi"));
        assert!(!is_valid_version(&"9".repeat(65)));
    }
}
