mod agent;
mod commands;
mod domain;
mod error;
mod events;
mod git;
mod providers;
mod provision;
mod recipes;
mod state;
mod store;
mod terminal;
mod util;

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
            app.manage(AppState {
                store,
                manager: AgentManager::new(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_projects,
            commands::open_project,
            commands::list_sessions,
            commands::list_groups,
            commands::create_group,
            commands::rename_group,
            commands::delete_group,
            commands::set_group_layout,
            commands::list_group_roots,
            commands::list_group_sessions,
            commands::add_group_root,
            commands::remove_group_root,
            commands::list_session_roots,
            commands::set_session_roots,
            commands::session_git_status,
            commands::get_events,
            commands::create_session,
            commands::update_session,
            commands::set_session_isolation,
            commands::rename_session,
            commands::delete_session,
            commands::send_message,
            commands::cancel_session,
            commands::approve_tools,
            commands::run_plan_to_code,
            commands::list_files,
            commands::list_commands,
            commands::list_repo_refs,
            commands::fetch_repo_ref,
            commands::open_in,
            commands::list_provider_status,
            commands::install_provider,
            commands::update_provider,
            commands::start_terminal,
            commands::terminal_write,
            commands::terminal_resize,
            commands::stop_terminal,
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
