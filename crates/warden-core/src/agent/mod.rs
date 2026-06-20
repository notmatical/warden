//! The agent-invocation vocabulary — the floor types that define how an agent is
//! run: which [`Backend`], under what [`PermissionMode`], at what [`EffortLevel`].
//! Kept below the feature modules (session, providers, the engine) so they can
//! all depend down on it without cycles. The orchestration engine ports into its
//! own module separately.

pub mod backend;
pub mod turn;

pub use backend::Backend;
pub use turn::{EffortLevel, PermissionMode};
