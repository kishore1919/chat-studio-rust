// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod config;
mod db;
mod mcp;
mod providers;
mod skills;
mod state;

use state::AppState;
use std::collections::HashMap;
use std::sync::Mutex;

fn main() {
    let settings = config::load_settings().expect("failed to load settings");

    let db_path = config::config_dir().join("chats.db");
    let conn = db::open(&db_path).expect("failed to open database");

    let app_state = AppState {
        db: Mutex::new(conn),
        settings: Mutex::new(settings),
        active_streams: Mutex::new(HashMap::new()),
        model_cache: Mutex::new(HashMap::new()),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::list_conversations,
            commands::get_messages,
            commands::create_conversation,
            commands::rename_conversation,
            commands::delete_conversation,
            commands::pin_conversation,
            commands::clear_conversation,
            commands::set_conversation_model,
            commands::edit_message,
            commands::delete_message,
            commands::send_message,
            commands::retry_message,
            commands::cancel_stream,
            commands::list_models,
            commands::get_settings,
            commands::save_settings,
            commands::add_provider,
            commands::remove_provider,
            commands::test_provider,
            commands::test_mcp_server,
            commands::list_mcp_tools,
            commands::call_mcp_tool,
            commands::list_global_skills,
            commands::open_config_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
