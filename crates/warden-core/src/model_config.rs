//! The backend's view of the shared models config (`src/config/models.json`,
//! also the source of the app's picker list in `src/lib/models.ts`). The JSON is
//! copied into `OUT_DIR` by `build.rs` and embedded here, so both sides always
//! agree and the path survives the crate moving in the tree.

use std::sync::OnceLock;

use serde::Deserialize;

use crate::Backend;

const RAW: &str = include_str!(concat!(env!("OUT_DIR"), "/models.json"));

#[derive(Deserialize)]
struct ModelConfig {
    #[serde(rename = "fastWorkflows")]
    fast_workflows: FastWorkflows,
}

#[derive(Deserialize)]
struct FastWorkflows {
    claude: String,
    codex: String,
    opencode: String,
}

fn config() -> &'static ModelConfig {
    static CONFIG: OnceLock<ModelConfig> = OnceLock::new();
    CONFIG.get_or_init(|| serde_json::from_str(RAW).expect("invalid src/config/models.json"))
}

/// Each provider's cheapest model, for background one-shots ("fast workflows":
/// session naming, PR drafting).
pub fn fast_workflow_model(backend: Backend) -> &'static str {
    match backend {
        Backend::Claude => &config().fast_workflows.claude,
        Backend::Codex => &config().fast_workflows.codex,
        Backend::Opencode => &config().fast_workflows.opencode,
    }
}
