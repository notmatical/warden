mod agent;
mod commands;
mod domain;
mod error;
mod events;
mod git;
mod provision;
mod recipes;
mod state;
mod store;
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
            commands::list_workspaces,
            commands::open_workspace,
            commands::list_sessions,
            commands::get_events,
            commands::create_session,
            commands::update_session,
            commands::rename_session,
            commands::delete_session,
            commands::send_message,
            commands::cancel_session,
            commands::run_plan_to_code,
            commands::list_files,
            commands::list_commands,
            commands::list_repo_refs,
            commands::fetch_repo_ref,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
