//! Linear integration: connect with a personal API key (stored in the OS
//! keychain) and read issues over Linear's GraphQL API. Unlike GitHub, Linear
//! brokers no managed CLI — all access is HTTPS from this module.

pub mod binding;
pub mod client;
pub mod commands;
pub(crate) mod key;
pub mod poll;
pub mod sync;
pub mod writeback;
