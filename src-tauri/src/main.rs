// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod config;
mod db;
mod mcp;
mod providers;
mod skills;
mod state;
mod themes;

use state::AppState;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

/// One client shared by every provider for the app's lifetime. Deliberately
/// no whole-request `.timeout()` here - that would guillotine a long stream
/// mid-answer. `read_timeout` is per-read instead, which is the idle-stream
/// watchdog we actually want; `list_models`/`test_provider` add their own
/// short per-request timeout on top since those calls are never a stream.
fn build_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(concat!("chat-studio/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(Duration::from_secs(60))
        .pool_idle_timeout(Duration::from_secs(90))
        .tcp_keepalive(Duration::from_secs(60))
        .build()
        .expect("static reqwest client config should never fail to build")
}

/// Returns a guard that must stay alive for the whole of `main` - dropping it
/// flushes the non-blocking writer. With `windows_subsystem = "windows"` there
/// is no console in release builds, so this file is the only place a crash can
/// leave any trace at all.
fn init_logging() -> Option<tracing_appender::non_blocking::WorkerGuard> {
    let dir = config::log_dir();
    std::fs::create_dir_all(&dir).ok()?;

    let appender = tracing_appender::rolling::Builder::new()
        .rotation(tracing_appender::rolling::Rotation::DAILY)
        .filename_prefix("chat-studio")
        .filename_suffix("log")
        .max_log_files(5)
        .build(&dir)
        .ok()?;

    let (writer, guard) = tracing_appender::non_blocking(appender);
    let filter = tracing_subscriber::EnvFilter::try_from_env("CHAT_STUDIO_LOG")
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,chat_studio=debug"));

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(writer)
        .with_ansi(false) // a file, not a terminal
        .with_target(true)
        .init();

    Some(guard)
}

fn install_panic_hook() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        tracing::error!(
            panic = %info,
            backtrace = %std::backtrace::Backtrace::force_capture(),
            "fatal panic"
        );
        default(info);
    }));
}

fn main() {
    // Held for the lifetime of main so buffered log lines are flushed on exit.
    let _log_guard = init_logging();
    install_panic_hook();
    tracing::info!(version = env!("CARGO_PKG_VERSION"), "starting");

    let mut startup_warnings = Vec::new();

    let settings = match config::load_settings() {
        Ok(s) => s,
        Err(e) => {
            // A hand-edited or truncated settings.toml must not stop the app
            // from launching - that was previously a silent abort in release.
            tracing::error!(error = %e, "settings unreadable; quarantining and using defaults");
            let note = match config::quarantine_settings_file() {
                Some(backup) => format!(
                    "Settings could not be read ({e}). Defaults restored; your previous file was \
                     saved as {}.",
                    backup.display()
                ),
                None => format!("Settings could not be read ({e}). Defaults restored."),
            };
            startup_warnings.push(note);
            config::Settings::default()
        }
    };

    let db_path = config::config_dir().join("chats.db");
    let conn = match db::open(&db_path) {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(error = %e, path = %db_path.display(), "db open failed; memory-only");
            startup_warnings.push(format!(
                "Chat history could not be opened ({e}). Running without saving - the existing \
                 file at {} was left untouched.",
                db_path.display()
            ));
            match db::open_in_memory() {
                Ok(c) => c,
                Err(e) => {
                    // Nothing left to degrade to; at least it is now logged.
                    tracing::error!(error = %e, "in-memory sqlite also failed");
                    return;
                }
            }
        }
    };

    let app_state = AppState {
        db: Mutex::new(conn),
        settings: Mutex::new(settings),
        active_streams: Mutex::new(HashMap::new()),
        model_cache: Mutex::new(HashMap::new()),
        startup_warnings,
        http: build_http_client(),
        mcp: mcp::McpManager::new(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
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
            commands::set_conversation_system_prompt,
            commands::edit_message,
            commands::delete_message,
            commands::send_message,
            commands::retry_message,
            commands::edit_and_resend_message,
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
            commands::open_log_dir,
            commands::get_diagnostics,
            themes::list_themes,
            themes::get_theme_content,
            themes::import_theme_content,
            themes::delete_custom_theme,
            themes::open_themes_dir,
        ])
        .build(tauri::generate_context!())
        .map(|app| {
            app.run(|app_handle, event| {
                // MCP server child processes (often `npx`/`node`, sometimes
                // spawning their own children) would otherwise outlive the
                // window that started them.
                if matches!(
                    event,
                    tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
                ) {
                    let state = app_handle.state::<AppState>();
                    tauri::async_runtime::block_on(state.mcp.shutdown_all());
                }
            });
        })
        .unwrap_or_else(|e| tracing::error!(error = %e, "tauri runtime failed to build"));
}
