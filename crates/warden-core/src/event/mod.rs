//! The cross-backend event contract — the normalized events the whole UI renders
//! against. The emit machinery (a feature-gated global `EventState`) lands here
//! alongside `types` in a later step.

pub mod emit;
pub mod payloads;
pub mod state;
pub mod text;
pub mod types;

pub use emit::{
    emit_delta, emit_event, emit_install_progress, emit_linear_changed, emit_notification,
    emit_session,
};
pub use payloads::{InstallProgress, Notification, NotifyEvent, NotifyTarget, NotifyTone};
pub use state::init;
pub use types::{AgentEvent, EventRecord, TokenUsage, TokenUsageKeys, ToolDenial};
