//! Workflow graph runtime: persist and execute user-authored cross-provider
//! agent DAGs. Generalizes the hardcoded `agent::recipes::run_plan_to_code`.

pub mod commands;
mod events;
mod executor;
