//! The cross-backend event contract — the normalized events the whole UI renders
//! against. The emit machinery (a feature-gated global `EventState`) lands here
//! alongside `types` in a later step.

pub mod text;
pub mod types;

pub use types::{AgentEvent, EventRecord, TokenUsage, ToolDenial};
