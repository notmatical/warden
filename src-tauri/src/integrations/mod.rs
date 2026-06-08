//! External-service integrations: features that bring in outside information or
//! perform outside actions (GitHub PRs/issues, Linear tasks). Distinct from
//! [`crate::providers`] (AI-model sources that execute agent turns) and from the
//! managed-binary substrate in [`crate::cli`] — an integration may broker a
//! managed CLI (GitHub uses `gh`) or talk to a remote API directly (Linear).

pub mod github;
