//! Linear integration: connect with a personal API key (stored in the OS
//! keychain) and read issues over Linear's GraphQL API. Unlike GitHub, Linear
//! brokers no managed CLI — all access is HTTPS from this module.

pub mod client;
pub mod commands;
mod key;
pub mod poll;
pub mod sync;
