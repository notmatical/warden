//! The thin Tauri shell over `warden-core`. This crate owns only the desktop
//! surface: plugin registration, the window/titlebar setup, the `tauri_specta`
//! command registry, and the global event-sink wiring. Every command body is a
//! 1–5 line wrapper in `commands/<domain>` that calls a `warden-core` service.

mod commands;
mod state;

use tauri::Manager;
#[cfg(target_os = "macos")]
use tauri_plugin_decorum::WebviewWindowExt;
use tauri_specta::{collect_commands, Builder};

use warden_core::cli::{self, Source, Tool};
use warden_core::{platform, AgentManager, Store};

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Must run before any webview is created.
    platform::init_linux_webview_workarounds();

    let specta_builder = Builder::<tauri::Wry>::new().commands(collect_commands![
        // workspace: projects + groups
        commands::workspace::list_projects,
        commands::workspace::open_project,
        commands::workspace::list_sessions,
        commands::workspace::list_groups,
        commands::workspace::create_group,
        commands::workspace::rename_group,
        commands::workspace::delete_group,
        commands::workspace::set_group_layout,
        commands::workspace::list_group_roots,
        commands::workspace::list_group_sessions,
        commands::workspace::add_group_root,
        commands::workspace::remove_group_root,
        commands::workspace::list_session_roots,
        commands::workspace::set_session_roots,
        commands::workspace::get_worktree_config,
        commands::workspace::update_worktree_config,
        // sessions
        commands::session::get_events,
        commands::session::create_session,
        commands::session::update_session,
        commands::session::set_session_isolation,
        commands::session::retry_worktree_setup,
        commands::session::dismiss_setup_error,
        commands::session::rename_session,
        commands::session::set_session_pinned,
        commands::session::load_project_labels,
        commands::session::create_label,
        commands::session::update_label,
        commands::session::delete_label,
        commands::session::set_session_labels,
        commands::session::session_delete_check,
        commands::session::delete_session,
        commands::session::send_message,
        commands::session::attach_to_session,
        commands::session::cancel_session,
        commands::session::approve_tools,
        commands::session::reject_tools,
        commands::session::approve_plan,
        commands::session::list_context_sources,
        commands::session::add_context_source,
        commands::session::remove_context_source,
        commands::session::set_context_source_enabled,
        // git
        commands::git::session_git_status,
        commands::git::repo_browse_url,
        commands::git::push_session,
        commands::git::pull_session,
        commands::git::get_session_diff,
        commands::git::get_session_file_versions,
        commands::git::get_session_commits,
        commands::git::sync_worktree,
        // agent recipes
        commands::agent::run_plan_to_code,
        // workflows
        commands::workflow::create_workflow,
        commands::workflow::get_workflow,
        commands::workflow::list_workflows,
        commands::workflow::update_workflow,
        commands::workflow::delete_workflow,
        commands::workflow::run_workflow,
        commands::workflow::resume_workflow,
        commands::workflow::retry_workflow_run,
        commands::workflow::cancel_workflow,
        commands::workflow::get_workflow_run,
        commands::workflow::get_latest_workflow_run,
        commands::workflow::list_workflow_runs,
        commands::workflow::list_workflow_sessions,
        // mentions
        commands::mentions::list_files,
        commands::mentions::list_commands,
        commands::mentions::list_repo_refs,
        commands::mentions::fetch_repo_ref,
        // external
        commands::external::open_in,
        commands::external::list_open_apps,
        // providers
        commands::providers::list_provider_status,
        commands::providers::list_opencode_models,
        commands::providers::install_provider,
        commands::providers::update_provider,
        commands::providers::set_provider_source,
        // github cli
        commands::github::github_status,
        commands::github::install_github_cli,
        commands::github::update_github_cli,
        commands::github::set_github_source,
        commands::github::open_pull_request,
        commands::github::refresh_pr_status,
        commands::github::pr_details,
        commands::github::generate_pr_content,
        commands::github::list_open_prs,
        commands::github::checkout_pr,
        commands::github::list_my_issues,
        commands::github::github_issue_comments,
        // linear
        commands::linear::linear_connect,
        commands::linear::linear_disconnect,
        commands::linear::linear_status,
        commands::linear::linear_cached_issues,
        commands::linear::linear_sync_now,
        commands::linear::linear_issue_comments,
        commands::linear::linear_start_issue,
        commands::linear::linear_teams,
        commands::linear::linear_binding,
        commands::linear::linear_bindings,
        commands::linear::linear_set_binding,
        // core
        commands::core::set_app_focus_state,
        // terminal
        commands::terminal::start_terminal,
        commands::terminal::terminal_write,
        commands::terminal::terminal_resize,
        commands::terminal::stop_terminal,
    ]);

    #[cfg(debug_assertions)]
    specta_builder
        .export(
            specta_typescript::Typescript::default()
                .bigint(specta_typescript::BigIntExportBehavior::Number)
                .header("// @ts-nocheck\n// This file is auto-generated by tauri-specta. Do not edit manually.\n// Run `bun run dev` (debug build) to regenerate.\n"),
            "../src/bindings.ts",
        )
        .expect("Failed to export Tauri specta bindings");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_denylist(&["notifications"])
                .build(),
        )
        .plugin(tauri_plugin_decorum::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Custom titlebar: the React titlebar (components/titlebar) renders the
            // window controls + drag region itself. We just drop native
            // decorations on Windows/Linux; macOS keeps its overlaid native
            // traffic-lights. The decorum plugin stays registered only for its
            // Snap Layout overlay command (invoked from the maximize button).
            let main = app
                .get_webview_window("main")
                .expect("main window must exist at setup");
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            {
                let _ = main.set_decorations(false);
            }
            #[cfg(target_os = "macos")]
            {
                let _ = main.set_traffic_lights_inset(12.0, 18.0);
            }

            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let store = Store::open(&data_dir.join("warden.db"))?;

            // Install the global event sink (so core can emit without an
            // AppHandle) and seed both app-data slots before anything reads them.
            warden_core::event::init(app.handle().clone());
            warden_core::paths::set_app_data(data_dir.clone());
            cli::set_app_data(data_dir.clone());

            // Seed each tool's source preference, defaulting to Managed. Legacy
            // "auto"/unset entries are migrated once to a concrete choice: keep a
            // working system-only install, otherwise managed — and persisted so
            // it sticks.
            let sources = Tool::ALL
                .iter()
                .map(|&tool| {
                    let stored = store
                        .get_setting(&Source::setting_key(tool))
                        .ok()
                        .flatten()
                        .and_then(|v| Source::parse(&v));
                    let source = stored.unwrap_or_else(|| {
                        let derived = if cli::managed_installed(tool).is_some()
                            || cli::system_binary(tool).is_none()
                        {
                            Source::Managed
                        } else {
                            Source::System
                        };
                        let _ = store.set_setting(&Source::setting_key(tool), derived.as_str());
                        derived
                    });
                    (tool, source)
                })
                .collect();
            cli::set_sources(sources);

            app.manage(AppState {
                store: store.clone(),
                manager: AgentManager::new(),
                workflow_cancels: warden_core::workflow::service::new_cancels(),
                focus: Default::default(),
            });

            // Workflow executors don't survive a restart; settle their runs so
            // the editor doesn't show a phantom active run.
            if let Err(e) = store.fail_interrupted_workflow_runs() {
                log::warn!("failed to settle interrupted workflow runs: {e}");
            }

            // Reattach to agent processes that survived the previous app run
            // (or drain what they wrote before dying), and settle any session
            // left lying `Running` with nothing behind it. Emits via the global
            // sink installed above, so it needs no AppHandle.
            warden_core::agent::recover(store);

            // Keep open PRs' state + CI checks and the Linear inbox fresh in the
            // background.
            commands::github::poll::spawn(app.handle().clone());
            commands::linear::poll::spawn(app.handle().clone());
            Ok(())
        })
        .invoke_handler(specta_builder.invoke_handler())
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::Destroyed,
                ..
            } = &event
            {
                if label == "main" {
                    app.exit(0);
                }
            }
            // Tear down PTYs and the Codex app-server on exit. Claude session
            // processes survive on purpose: stdin EOF lets each finish its
            // in-flight turn into its output file, and the next launch
            // reattaches (see warden_core::agent::recover).
            if matches!(event, tauri::RunEvent::Exit) {
                warden_core::terminal::kill_all();
                warden_core::agent::shutdown();
            }
        });
}
