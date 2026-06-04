mod agent;
mod cli;
mod core;
mod domain;
mod git;
mod github;
mod mentions;
mod providers;
mod session;
mod store;
mod terminal;
mod workspace;

// Keep the foundation modules reachable at their familiar crate-root paths
// (`crate::error`, `crate::util`, …) while they live under `core/`.
pub use core::{error, events, platform, state, util};

use tauri::Manager;

use agent::AgentManager;
use state::AppState;
use store::Store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let store = Store::open(&data_dir.join("warden.db"))?;

            // Seed the managed-CLI resolver with the app data dir and each tool's
            // persisted source preference (defaulting to Auto).
            let sources = cli::Tool::ALL
                .iter()
                .map(|&tool| {
                    let source = store
                        .get_setting(&cli::Source::setting_key(tool))
                        .ok()
                        .flatten()
                        .and_then(|v| cli::Source::parse(&v))
                        .unwrap_or(cli::Source::Auto);
                    (tool, source)
                })
                .collect();
            cli::init(data_dir.clone(), sources);

            app.manage(AppState {
                store,
                manager: AgentManager::new(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // workspace: projects + groups
            workspace::project::list_projects,
            workspace::project::open_project,
            workspace::project::list_sessions,
            workspace::group::list_groups,
            workspace::group::create_group,
            workspace::group::rename_group,
            workspace::group::delete_group,
            workspace::group::set_group_layout,
            workspace::group::list_group_roots,
            workspace::group::list_group_sessions,
            workspace::group::add_group_root,
            workspace::group::remove_group_root,
            workspace::group::list_session_roots,
            workspace::group::set_session_roots,
            // sessions
            session::commands::get_events,
            session::commands::create_session,
            session::commands::update_session,
            session::commands::set_session_isolation,
            session::commands::rename_session,
            session::commands::delete_session,
            session::commands::send_message,
            session::commands::cancel_session,
            session::commands::approve_tools,
            // git
            git::commands::session_git_status,
            git::commands::integrate_session,
            // agent recipes
            agent::commands::run_plan_to_code,
            // mentions
            mentions::commands::list_files,
            mentions::commands::list_commands,
            mentions::commands::list_repo_refs,
            mentions::commands::fetch_repo_ref,
            // external
            core::external::open_in,
            // providers
            providers::commands::list_provider_status,
            providers::commands::install_provider,
            providers::commands::update_provider,
            providers::commands::set_provider_source,
            // github cli
            github::commands::github_status,
            github::commands::install_github_cli,
            github::commands::update_github_cli,
            github::commands::set_github_source,
            // terminal
            terminal::commands::start_terminal,
            terminal::commands::terminal_write,
            terminal::commands::terminal_resize,
            terminal::commands::stop_terminal,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            // Tear down any live PTYs and agent processes when the app exits.
            if matches!(event, tauri::RunEvent::Exit) {
                terminal::kill_all();
                agent::kill_all();
            }
        });
}
