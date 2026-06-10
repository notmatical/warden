//! Repo ↔ Linear binding, stored in a committable `.warden/config.json` at the
//! repo root. Team/project ids are identifiers, not secrets — they travel with
//! the repo so a clone is bound out of the box.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::{AppError, Result};

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LinearBinding {
    pub team_id: String,
    pub project_id: Option<String>,
}

fn config_path(repo_path: &Path) -> std::path::PathBuf {
    repo_path.join(".warden").join("config.json")
}

/// The repo's `linear` binding, if any. A missing or malformed file reads as
/// unbound — never an error.
pub fn read(repo_path: &Path) -> Option<LinearBinding> {
    let path = config_path(repo_path);
    let text = fs::read_to_string(&path).ok()?;
    let value: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(e) => {
            log::warn!("malformed {}: {e}", path.display());
            return None;
        }
    };
    serde_json::from_value(value.get("linear")?.clone()).ok()
}

/// Merge-write the `linear` key (`None` removes it), preserving every other
/// top-level key. Refuses to overwrite a malformed existing file.
pub fn write(repo_path: &Path, binding: Option<&LinearBinding>) -> Result<()> {
    let path = config_path(repo_path);

    let mut root = match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str::<serde_json::Value>(&text).map_err(|_| {
            AppError::Invalid(format!(
                "{} is not valid JSON — fix or delete it first",
                path.display()
            ))
        })?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            serde_json::Value::Object(Default::default())
        }
        Err(e) => return Err(e.into()),
    };

    let obj = root
        .as_object_mut()
        .ok_or_else(|| AppError::Invalid(format!("{} is not a JSON object", path.display())))?;
    match binding {
        Some(b) => {
            obj.insert("linear".into(), serde_json::to_value(b)?);
        }
        None => {
            obj.remove("linear");
        }
    }

    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    fs::write(&path, format!("{}\n", serde_json::to_string_pretty(&root)?))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
