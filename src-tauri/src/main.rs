// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `warden mcp` runs the stdio MCP server for agent CLIs instead of the GUI.
    if std::env::args().nth(1).as_deref() == Some("mcp") {
        warden_lib::mcp::run_stdio();
        return;
    }
    warden_lib::run();
}
