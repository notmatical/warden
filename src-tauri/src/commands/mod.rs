//! Tauri command surface. Each submodule groups commands by domain; this module
//! re-exports them all for the invoke handler.

mod mentions;
mod recipe;
mod session;
mod workspace;

pub use mentions::*;
pub use recipe::*;
pub use session::*;
pub use workspace::*;
