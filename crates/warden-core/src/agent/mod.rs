//! The agent tier: the invocation *vocabulary* (the floor types `Backend` /
//! `PermissionMode` / `EffortLevel` that define how an agent is run) plus the
//! orchestration *engine* that drives turns through the provider registry.
//!
//! The vocabulary stays the floor every other module depends down on. The engine
//! sits above [`crate::provider`] and dispatches each turn through it; the
//! `settle`/`registry` leaves it shares with the adapters depend only on
//! `store`/`event`, so the engine→provider→leaf chain stays acyclic by design.

// Invocation vocabulary (the floor).
pub mod backend;
pub mod turn;

// The orchestration engine.
pub mod attachments;
pub mod manager;
pub mod model;
mod naming;
pub mod oneshot;
pub mod registry;
pub mod session_proc;
pub mod settle;
mod stream;
pub mod transcript;

pub use backend::Backend;
pub use turn::{EffortLevel, PermissionMode};

pub use manager::{AgentManager, TurnOutput};
pub use naming::generate_session_title;
pub use session_proc::recover;

/// App-exit teardown. The shared Codex app-server and OpenCode server die with
/// the app; Claude session processes are deliberately left running — each sees
/// stdin EOF, finishes any in-flight turn into its output file, and exits on its
/// own. The next launch reattaches or drains them (see [`session_proc::recover`]).
/// Iterates the provider registry so a new backend's teardown is automatic.
pub fn shutdown() {
    for &backend in <Backend as strum::VariantArray>::VARIANTS {
        crate::provider::provider(backend).kill_all();
    }
}

/// Drop a session's warm Claude process so the next turn respawns it with fresh
/// args — used after its context sources change. A no-op for the server-backed
/// providers (whose instructions are rebuilt each turn) and for idle sessions.
pub fn refresh_session(session_id: &str) {
    session_proc::kill(session_id);
}
