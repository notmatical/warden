//! Linear integration: connect with a personal API key (stored in the OS
//! keychain) and read issues over Linear's GraphQL API. Unlike GitHub, Linear
//! brokers no managed CLI — all access is HTTPS from this module.
//!
//! Transport is shared: every query goes through [`crate::net::graphql`]. The
//! shell owns the Tauri surface (commands + the poll spawn); the service API the
//! shell calls is `client` (reads/mutations), `key` (keychain), `binding`
//! (per-repo config), `sync` (cache reconcile), and `writeback` (best-effort
//! state transitions, incl. the consolidated [`writeback::on_pr_merged`]).

pub mod binding;
pub mod client;
pub mod key;
pub mod sync;
pub mod writeback;
