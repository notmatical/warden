//! Per-tool source preference: run warden's managed copy of a CLI, the one on
//! the system PATH, or auto-pick. Persisted by the store; cached here so the hot
//! `resolve` path never touches the database.

use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

use super::Tool;

/// Where a tool's binary comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    /// Prefer the system PATH copy; fall back to the managed one. The default.
    Auto,
    /// Always warden's managed copy.
    Managed,
    /// Always the system PATH copy.
    System,
}

impl Source {
    pub fn as_str(self) -> &'static str {
        match self {
            Source::Auto => "auto",
            Source::Managed => "managed",
            Source::System => "system",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "auto" => Some(Source::Auto),
            "managed" => Some(Source::Managed),
            "system" => Some(Source::System),
            _ => None,
        }
    }

    /// The settings key persisting a tool's source preference.
    pub fn setting_key(tool: Tool) -> String {
        format!("{}_cli_source", tool.id())
    }
}

static SOURCES: OnceLock<RwLock<HashMap<Tool, Source>>> = OnceLock::new();

fn cell() -> &'static RwLock<HashMap<Tool, Source>> {
    SOURCES.get_or_init(|| RwLock::new(HashMap::new()))
}

/// Seed the cache from persisted preferences at startup.
pub fn set_all(map: HashMap<Tool, Source>) {
    *cell().write().unwrap_or_else(|p| p.into_inner()) = map;
}

/// The current source preference for a tool (defaults to [`Source::Auto`]).
pub fn source(tool: Tool) -> Source {
    cell()
        .read()
        .unwrap_or_else(|p| p.into_inner())
        .get(&tool)
        .copied()
        .unwrap_or(Source::Auto)
}

/// Update a tool's source preference in the cache. Callers persist separately.
pub fn set_source(tool: Tool, source: Source) {
    cell()
        .write()
        .unwrap_or_else(|p| p.into_inner())
        .insert(tool, source);
}
