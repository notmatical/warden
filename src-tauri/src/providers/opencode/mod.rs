//! Everything OpenCode: the HTTP-server agent adapter, CLI distribution, and
//! auth. OpenCode is a multi-provider agent CLI; warden drives it through its
//! local HTTP server (`opencode serve`) rather than per-turn CLI invocations.

pub mod agent;
pub mod auth;
pub mod download;
pub mod history;
mod server;
