//! Repo ↔ Linear binding, the `linear` section of a committable
//! `.warden/config.json` at the repo root. Team/project ids are identifiers,
//! not secrets — they travel with the repo so a clone is bound out of the box.

use std::path::Path;

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::Result;
use crate::workspace::config;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LinearBinding {
    pub team_id: String,
    pub project_id: Option<String>,
}

/// The repo's `linear` binding, if any. A missing or malformed file reads as
/// unbound — never an error.
pub fn read(repo_path: &Path) -> Option<LinearBinding> {
    match config::read_section(repo_path, "linear") {
        Ok(binding) => binding,
        Err(e) => {
            log::warn!("ignoring linear binding: {e}");
            None
        }
    }
}

/// Merge-write the `linear` section (`None` removes it), preserving every
/// other top-level key. Refuses to overwrite a malformed existing file.
pub fn write(repo_path: &Path, binding: Option<&LinearBinding>) -> Result<()> {
    config::write_section(repo_path, "linear", binding)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn binding_round_trip_preserves_other_keys() {
        let dir = std::env::temp_dir().join(format!("warden-binding-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::create_dir_all(dir.join(".warden")).unwrap();
        fs::write(
            dir.join(".warden").join("config.json"),
            r#"{ "other": { "keep": true } }"#,
        )
        .unwrap();

        let binding = LinearBinding {
            team_id: "team-1".into(),
            project_id: Some("proj-1".into()),
        };
        write(&dir, Some(&binding)).unwrap();

        let read_back = read(&dir).expect("binding should read back");
        assert_eq!(read_back.team_id, "team-1");
        assert_eq!(read_back.project_id.as_deref(), Some("proj-1"));

        let text = fs::read_to_string(dir.join(".warden").join("config.json")).unwrap();
        let value: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(value["other"]["keep"], true);

        write(&dir, None).unwrap();
        assert!(read(&dir).is_none());
        let text = fs::read_to_string(dir.join(".warden").join("config.json")).unwrap();
        let value: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(value["other"]["keep"], true);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn malformed_file_reads_unbound_and_refuses_write() {
        let dir = std::env::temp_dir().join(format!("warden-binding-bad-{}", std::process::id()));
        fs::create_dir_all(dir.join(".warden")).unwrap();
        fs::write(dir.join(".warden").join("config.json"), "{ not json").unwrap();

        assert!(read(&dir).is_none());
        let binding = LinearBinding {
            team_id: "t".into(),
            project_id: None,
        };
        assert!(write(&dir, Some(&binding)).is_err());

        fs::remove_dir_all(&dir).ok();
    }
}
