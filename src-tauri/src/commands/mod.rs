//! Tauri command surface. Each submodule groups commands by domain; this module
//! re-exports them all for the invoke handler.

mod external;
mod git;
mod github;
mod group;
mod mentions;
mod project;
mod provider;
mod recipe;
mod session;
mod terminal;

pub use external::*;
pub use git::*;
pub use github::*;
pub use group::*;
pub use mentions::*;
pub use project::*;
pub use provider::*;
pub use recipe::*;
pub use session::*;
pub use terminal::*;
