//! The session domain: the `Session` entity and its lifecycle/state enums, plus
//! the context sources injected into a session's prompts. Session logic (CRUD,
//! the message/cancel controls) ports later; this is the type layer.

pub mod context;
pub mod types;

pub use context::{ContextSource, SessionContextSource};
pub use types::{
    CheckStatus, PrCheckCounts, Session, SessionKind, SessionRole, SessionStatus, SetupStatus,
};
