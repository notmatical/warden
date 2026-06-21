//! Indexes `/`-invocable items for mention completion: custom commands from
//! `.claude/commands` and skills from `.claude/skills`, project- and user-level.
//! Core takes the `.claude` directories as parameters — it never resolves the
//! user's home (the shell does that).

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::Serialize;
use specta::Type;
use strum::IntoStaticStr;

/// Where a slash command came from. Project entries win over user entries when
/// names collide; skills are their own bucket.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type, IntoStaticStr)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum CommandScope {
    Project,
    User,
    Skill,
}

impl CommandScope {
    pub fn as_str(self) -> &'static str {
        self.into()
    }
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SlashCommand {
    pub name: String,
    pub description: Option<String>,
    pub scope: CommandScope,
}

/// List `/`-invocable items from a project `.claude` dir and an optional user-level
/// `.claude` dir. Names are deduped, with project entries winning over user
/// entries. Pass `user_claude = None` to index project-only.
pub fn list_commands(project_claude: &Path, user_claude: Option<&Path>) -> Vec<SlashCommand> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();

    collect_commands(
        project_claude.join("commands"),
        CommandScope::Project,
        &mut out,
        &mut seen,
    );
    if let Some(user) = user_claude {
        collect_commands(
            user.join("commands"),
            CommandScope::User,
            &mut out,
            &mut seen,
        );
    }
    collect_skills(project_claude.join("skills"), &mut out, &mut seen);
    if let Some(user) = user_claude {
        collect_skills(user.join("skills"), &mut out, &mut seen);
    }

    out
}

fn collect_commands(
    dir: PathBuf,
    scope: CommandScope,
    out: &mut Vec<SlashCommand>,
    seen: &mut HashSet<String>,
) {
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let Some(name) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if !seen.insert(name.to_string()) {
            continue;
        }
        out.push(SlashCommand {
            name: name.to_string(),
            description: command_description(&path),
            scope,
        });
    }
}

/// Skills are subdirectories containing a `SKILL.md`.
fn collect_skills(dir: PathBuf, out: &mut Vec<SlashCommand>, seen: &mut HashSet<String>) {
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let skill_md = path.join("SKILL.md");
        if !path.is_dir() || !skill_md.exists() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if !seen.insert(name.to_string()) {
            continue;
        }
        out.push(SlashCommand {
            name: name.to_string(),
            description: skill_description(&skill_md),
            scope: CommandScope::Skill,
        });
    }
}

/// First meaningful line of a command file (skipping frontmatter and headings).
fn command_description(path: &Path) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    content
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && *line != "---" && !line.starts_with('#'))
        .map(|line| line.to_string())
}

/// The `description:` field from a SKILL.md YAML frontmatter, clipped for display.
fn skill_description(skill_md: &Path) -> Option<String> {
    let content = std::fs::read_to_string(skill_md).ok()?;
    let mut in_frontmatter = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == "---" {
            if in_frontmatter {
                break;
            }
            in_frontmatter = true;
            continue;
        }
        if in_frontmatter {
            if let Some(rest) = trimmed.strip_prefix("description:") {
                let value = rest.trim().trim_matches(['"', '\'']).trim();
                if !value.is_empty() {
                    return Some(value.chars().take(120).collect());
                }
            }
        }
    }
    None
}
