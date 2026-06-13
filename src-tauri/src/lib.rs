mod agent;
mod cli;
mod core;
mod domain;
mod git;
mod integrations;
pub mod mcp;
mod mentions;
mod providers;
mod session;
mod store;
mod terminal;
mod workflow;
mod workspace;

// Keep the foundation modules reachable at their familiar crate-root paths
// (`crate::error`, `crate::util`, …) while they live under `core/`.
pub use core::{error, events, model_config, platform, state, util};

use tauri::Manager;
#[cfg(target_os = "macos")]
use tauri_plugin_decorum::WebviewWindowExt;
use tauri_specta::{collect_commands, Builder};

use agent::AgentManager;
use state::AppState;
use store::Store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Must run before any webview is created.
    platform::init_linux_webview_workarounds();

    let specta_builder = Builder::<tauri::Wry>::new().commands(collect_commands![
        // workspace: projects + groups
        workspace::commands::list_projects,
        workspace::commands::open_project,
        workspace::commands::list_sessions,
        workspace::commands::list_groups,
        workspace::commands::create_group,
        workspace::commands::rename_group,
        workspace::commands::delete_group,
        workspace::commands::set_group_layout,
        workspace::commands::list_group_roots,
        workspace::commands::list_group_sessions,
        workspace::commands::add_group_root,
        workspace::commands::remove_group_root,
        workspace::commands::list_session_roots,
        workspace::commands::set_session_roots,
        workspace::commands::get_worktree_config,
        workspace::commands::update_worktree_config,
        // sessions
        session::commands::get_events,
        session::commands::create_session,
        session::commands::update_session,
        session::commands::set_session_isolation,
        session::commands::retry_worktree_setup,
        session::commands::dismiss_setup_error,
        session::commands::rename_session,
        session::commands::set_session_pinned,
        session::commands::load_project_labels,
        session::commands::create_label,
        session::commands::update_label,
        session::commands::delete_label,
        session::commands::set_session_labels,
        session::commands::session_delete_check,
        session::commands::delete_session,
        session::commands::send_message,
        session::commands::attach_to_session,
        session::commands::cancel_session,
        session::commands::approve_tools,
        session::commands::approve_plan,
        session::commands::list_context_sources,
        session::commands::add_context_source,
        session::commands::remove_context_source,
        session::commands::set_context_source_enabled,
        // git
        git::commands::session_git_status,
        git::commands::repo_browse_url,
        git::commands::push_session,
        git::commands::pull_session,
        git::commands::get_session_diff,
        git::commands::get_session_file_versions,
        git::commands::get_session_commits,
        git::commands::sync_worktree,
        // agent recipes
        agent::commands::run_plan_to_code,
        // workflows
        workflow::commands::create_workflow,
        workflow::commands::get_workflow,
        workflow::commands::list_workflows,
        workflow::commands::update_workflow,
        workflow::commands::delete_workflow,
        workflow::commands::run_workflow,
        workflow::commands::resume_workflow,
        workflow::commands::cancel_workflow,
        workflow::commands::get_workflow_run,
        workflow::commands::get_latest_workflow_run,
        workflow::commands::list_workflow_sessions,
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
        integrations::github::commands::github_status,
        integrations::github::commands::install_github_cli,
        integrations::github::commands::update_github_cli,
        integrations::github::commands::set_github_source,
        integrations::github::commands::open_pull_request,
        integrations::github::commands::refresh_pr_status,
        integrations::github::commands::pr_details,
        integrations::github::commands::generate_pr_content,
        integrations::github::commands::list_open_prs,
        integrations::github::commands::list_my_issues,
        integrations::github::commands::github_issue_comments,
        // linear
        integrations::linear::commands::linear_connect,
        integrations::linear::commands::linear_disconnect,
        integrations::linear::commands::linear_status,
        integrations::linear::commands::linear_cached_issues,
        integrations::linear::commands::linear_sync_now,
        integrations::linear::commands::linear_issue_comments,
        integrations::linear::commands::linear_start_issue,
        integrations::linear::commands::linear_teams,
        integrations::linear::commands::linear_binding,
        integrations::linear::commands::linear_bindings,
        integrations::linear::commands::linear_set_binding,
        // mcp
        mcp::commands::warden_mcp_enabled,
        mcp::commands::set_warden_mcp_enabled,
        // core
        core::poll_tier::set_app_focus_state,
        // terminal
        terminal::commands::start_terminal,
        terminal::commands::terminal_write,
        terminal::commands::terminal_resize,
        terminal::commands::stop_terminal,
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

            // The managed-path lookups below need the app data dir first.
            cli::set_app_data(data_dir.clone());

            // Seed each tool's source preference, defaulting to Managed. Legacy
            // "auto"/unset entries are migrated once to a concrete choice: keep a
            // working system-only install, otherwise managed — and persisted so
            // it sticks.
            let sources = cli::Tool::ALL
                .iter()
                .map(|&tool| {
                    let stored = store
                        .get_setting(&cli::Source::setting_key(tool))
                        .ok()
                        .flatten()
                        .and_then(|v| cli::Source::parse(&v));
                    let source = stored.unwrap_or_else(|| {
                        let derived = if cli::managed_installed(tool).is_some()
                            || cli::system_binary(tool).is_none()
                        {
                            cli::Source::Managed
                        } else {
                            cli::Source::System
                        };
                        let _ =
                            store.set_setting(&cli::Source::setting_key(tool), derived.as_str());
                        derived
                    });
                    (tool, source)
                })
                .collect();
            cli::set_sources(sources);

            app.manage(AppState {
                store: store.clone(),
                manager: AgentManager::new(),
                workflow_cancels: Default::default(),
                focus: Default::default(),
            });

            // Reattach to agent processes that survived the previous app run
            // (or drain what they wrote before dying), and settle any session
            // left lying `Running` with nothing behind it.
            agent::recover(app.handle().clone(), store);

            // Keep open PRs' state + CI checks fresh in the background.
            integrations::github::poll::spawn(app.handle().clone());
            integrations::linear::poll::spawn(app.handle().clone());
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
            // reattaches (see agent::recover).
            if matches!(event, tauri::RunEvent::Exit) {
                terminal::kill_all();
                agent::shutdown();
            }
        });
}
