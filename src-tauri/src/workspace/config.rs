//! `.warden/config.json`: per-repo configuration committed alongside the code,
//! so it is shared with the whole team. Each feature owns one top-level section
//! (`worktrees`, `linear`, …) and writes it through [`write_section`], which
//! preserves every other key — independent writers can never clobber each other.

use std::fs;
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::{AppError, Result};

/// The `worktrees` section: lifecycle commands for isolated worktrees.
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct WorktreeConfig {
    /// Commands run in a fresh worktree right after it is created (e.g.
    /// `pnpm install`, copying `.env`). Joined with `&&`, so the first
    /// failure stops the chain.
    pub setup: Vec<String>,
    /// Commands run in a worktree just before it is removed.
    pub teardown: Vec<String>,
}

fn config_path(repo: &Path) -> PathBuf {
    repo.join(".warden").join("config.json")
}

/// The whole config file as JSON. A missing file reads as an empty object; a
/// malformed one is an error so writers can't silently clobber it.
fn read_root(repo: &Path) -> Result<serde_json::Value> {
    let path = config_path(repo);
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(serde_json::Value::Object(Default::default()));
        }
        Err(e) => return Err(e.into()),
    };
    serde_json::from_str(&text).map_err(|e| {
        AppError::Invalid(format!(
            "{} is not valid JSON — fix or delete it first: {e}",
            path.display()
        ))
    })
}

/// One typed top-level section; `None` when the file or key is missing.
pub fn read_section<T: DeserializeOwned>(repo: &Path, key: &str) -> Result<Option<T>> {
    let root = read_root(repo)?;
    let Some(value) = root.get(key) else {
        return Ok(None);
    };
    serde_json::from_value(value.clone())
        .map(Some)
        .map_err(|e| {
            AppError::Invalid(format!(
                "invalid `{key}` in {}: {e}",
                config_path(repo).display()
            ))
        })
}

/// Parse-modify-preserve: mutate only the given top-level keys, keep the rest.
fn update_root(
    repo: &Path,
    mutate: impl FnOnce(&mut serde_json::Map<String, serde_json::Value>),
) -> Result<()> {
    let path = config_path(repo);
    let mut root = read_root(repo)?;
    let obj = root
        .as_object_mut()
        .ok_or_else(|| AppError::Invalid(format!("{} is not a JSON object", path.display())))?;
    mutate(obj);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&path, format!("{}\n", serde_json::to_string_pretty(&root)?))?;
    Ok(())
}

/// Merge-write one top-level section (`None` removes it), preserving every
/// other key. Refuses to overwrite a malformed existing file.
pub fn write_section<T: Serialize>(repo: &Path, key: &str, value: Option<&T>) -> Result<()> {
    let value = value.map(serde_json::to_value).transpose()?;
    update_root(repo, |obj| match value {
        Some(v) => {
            obj.insert(key.to_string(), v);
        }
        None => {
            obj.remove(key);
        }
    })
}

/// Load a repo's worktree config. A missing file or section reads as empty.
/// Falls back to the legacy flat shape (top-level `setup`/`teardown`).
pub fn load(repo: &Path) -> Result<WorktreeConfig> {
    let root = read_root(repo)?;
    let value = match root.get("worktrees") {
        Some(v) => v.clone(),
        // Legacy flat shape: parse the root itself; unknown keys are ignored
        // and absent fields default.
        None => root,
    };
    serde_json::from_value(value).map_err(|e| {
        AppError::Invalid(format!(
            "invalid worktree config in {}: {e}",
            config_path(repo).display()
        ))
    })
}

/// Load for execution paths: a malformed file logs a warning and reads empty,
/// so provisioning never fails on bad config.
pub fn load_lenient(repo: &Path) -> WorktreeConfig {
    load(repo).unwrap_or_else(|e| {
        log::warn!("ignoring repo config at {:?}: {e}", config_path(repo));
        WorktreeConfig::default()
    })
}

/// Merge-write the `worktrees` section, migrating any legacy flat keys away.
pub fn save(repo: &Path, config: &WorktreeConfig) -> Result<()> {
    let value = serde_json::to_value(config)?;
    update_root(repo, |obj| {
        obj.remove("setup");
        obj.remove("teardown");
        obj.insert("worktrees".to_string(), value);
    })
}

/// Drop empty/whitespace-only command lines.
pub(super) fn clean(commands: Vec<String>) -> Vec<String> {
    commands
        .into_iter()
        .map(|c| c.trim().to_string())
        .filter(|c| !c.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_repo(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("warden-config-{tag}-{}", std::process::id()));
        fs::create_dir_all(dir.join(".warden")).unwrap();
        dir
    }

    #[test]
    fn missing_file_loads_empty() {
        let dir = temp_repo("missing");
        fs::remove_file(config_path(&dir)).ok();
        let config = load(&dir).unwrap();
        assert!(config.setup.is_empty());
        assert!(config.teardown.is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn legacy_flat_shape_loads_and_migrates_on_save() {
        let dir = temp_repo("legacy");
        fs::write(
            config_path(&dir),
            r#"{ "setup": ["pnpm install"], "teardown": ["docker compose down"], "linear": { "teamId": "t" } }"#,
        )
        .unwrap();

        let config = load(&dir).unwrap();
        assert_eq!(config.setup, vec!["pnpm install"]);
        assert_eq!(config.teardown, vec!["docker compose down"]);

        save(&dir, &config).unwrap();
        let root: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(config_path(&dir)).unwrap()).unwrap();
        assert_eq!(root["worktrees"]["setup"][0], "pnpm install");
        assert!(root.get("setup").is_none());
        assert!(root.get("teardown").is_none());
        assert_eq!(root["linear"]["teamId"], "t");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_preserves_other_sections() {
        let dir = temp_repo("preserve");
        fs::write(
            config_path(&dir),
            r#"{ "linear": { "teamId": "t" }, "future": { "keep": true } }"#,
        )
        .unwrap();

        let config = WorktreeConfig {
            setup: vec!["bun install".into()],
            teardown: vec![],
        };
        save(&dir, &config).unwrap();

        let read_back = load(&dir).unwrap();
        assert_eq!(read_back.setup, vec!["bun install"]);

        let root: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(config_path(&dir)).unwrap()).unwrap();
        assert_eq!(root["linear"]["teamId"], "t");
        assert_eq!(root["future"]["keep"], true);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn malformed_file_errors_on_load_and_save() {
        let dir = temp_repo("malformed");
        fs::write(config_path(&dir), "{ not json").unwrap();
        assert!(load(&dir).is_err());
        assert!(save(&dir, &WorktreeConfig::default()).is_err());
        fs::remove_dir_all(&dir).ok();
    }
}
