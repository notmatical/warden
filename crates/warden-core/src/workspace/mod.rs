//! Workspace domain types: groups (the top-level workspace), projects (opened
//! roots), and labels. Workspace logic (config parsing, CRUD) lands here later.

pub mod config;
pub mod types;

pub use types::{Group, Label, Project, ProjectLabels};
