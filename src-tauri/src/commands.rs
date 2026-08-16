use crate::config::{self, ProviderConfig, Settings};
use crate::db;
use crate::providers::{build_provider, ChatMessage, ChatRequest, ModelInfo, ProviderError, StreamEvent, Usage};
use crate::state::{AppState, ModelCacheEntry};
use serde::Serialize;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

const COALESCE_INTERVAL_MS: u64 = 40;

fn db_err<E: std::fmt::Display>(e: E) -> String {
    format!("database error: {e}")
}

#[tauri::command]
pub fn list_conversations(state: State<AppState>) -> Result<Vec<db::Conversation>, String> {
    let conn = state.db.lock().unwrap();
    db::list_conversations(&conn).map_err(db_err)
}

#[tauri::command]
pub fn get_messages(
    state: State<AppState>,
    conversation_id: i64,
    limit: i64,
    before_id: Option<i64>,
) -> Result<Vec<db::Message>, String> {
    let conn = state.db.lock().unwrap();
    db::get_messages(&conn, conversation_id, limit, before_id).map_err(db_err)
}

#[tauri::command]
pub fn create_conversation(
    state: State<AppState>,
    provider: String,
    model: String,
) -> Result<db::Conversation, String> {
    let conn = state.db.lock().unwrap();
    db::create_conversation(&conn, &provider, &model).map_err(db_err)
}

#[tauri::command]
pub fn rename_conversation(
    state: State<AppState>,
    conversation_id: i64,
    title: String,
) -> Result<(), String> {
    let conn = state.db.lock().unwrap();
    db::rename_conversation(&conn, conversation_id, &title).map_err(db_err)
}

#[tauri::command]
pub fn delete_conversation(state: State<AppState>, conversation_id: i64) -> Result<(), String> {
    let conn = state.db.lock().unwrap();
    db::delete_conversation(&conn, conversation_id).map_err(db_err)
}

#[tauri::command]
pub fn pin_conversation(
    state: State<AppState>,
    conversation_id: i64,
    pinned: bool,
) -> Result<(), String> {
    let conn = state.db.lock().unwrap();
    db::set_conversation_pinned(&conn, conversation_id, pinned).map_err(db_err)
}

#[tauri::command]
pub fn clear_conversation(state: State<AppState>, conversation_id: i64) -> Result<(), String> {
    let conn = state.db.lock().unwrap();
    db::clear_messages(&conn, conversation_id).map_err(db_err)
}

#[tauri::command]
pub fn set_conversation_model(
    state: State<AppState>,
    conversation_id: i64,
    provider: String,
    model: String,
) -> Result<(), String> {
    let conn = state.db.lock().unwrap();
    db::update_conversation_model(&conn, conversation_id, &provider, &model).map_err(db_err)
}

#[tauri::command]
pub fn edit_message(state: State<AppState>, message_id: i64, content: String) -> Result<(), String> {
    let conn = state.db.lock().unwrap();
    db::edit_message(&conn, message_id, &content).map_err(db_err)
}

#[tauri::command]
pub fn delete_message(state: State<AppState>, message_id: i64) -> Result<(), String> {
    let conn = state.db.lock().unwrap();
    db::delete_message(&conn, message_id).map_err(db_err)
}

#[tauri::command]
pub async fn retry_message(
    app: AppHandle,
    state: State<'_, AppState>,
    conversation_id: i64,
    message_id: i64,
    reasoning_effort: Option<String>,
) -> Result<String, String> {
    {
        let conn = state.db.lock().unwrap();
        db::delete_message_and_after(&conn, conversation_id, message_id).map_err(db_err)?;
    }
    start_stream(app, &state, conversation_id, reasoning_effort).await
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
pub fn save_settings(state: State<AppState>, settings: Settings) -> Result<(), String> {
    config::save_settings(&settings).map_err(|e| e.to_string())?;
    *state.settings.lock().unwrap() = settings;
    Ok(())
}

#[tauri::command]
pub fn add_provider(state: State<AppState>, provider: ProviderConfig) -> Result<(), String> {
    let mut settings = state.settings.lock().unwrap();
    settings.providers.retain(|p| p.id != provider.id);
    settings.providers.push(provider);
    config::save_settings(&settings).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_provider(state: State<AppState>, provider_id: String) -> Result<(), String> {
    let mut settings = state.settings.lock().unwrap();
    settings.providers.retain(|p| p.id != provider_id);
    config::save_settings(&settings).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_config_dir() -> Result<(), String> {
    open::that(config::config_dir()).map_err(|e| e.to_string())
}

fn find_provider(settings: &Settings, provider_id: &str) -> Result<ProviderConfig, String> {
    settings
        .providers
        .iter()
        .find(|p| p.id == provider_id)
        .cloned()
        .ok_or_else(|| format!("unknown provider: {provider_id}"))
}

#[tauri::command]
pub async fn list_models(
    state: State<'_, AppState>,
    provider_id: String,
    force_refresh: bool,
) -> Result<Vec<ModelInfo>, String> {
    if !force_refresh {
        let cache = state.model_cache.lock().unwrap();
        if let Some(entry) = cache.get(&provider_id) {
            if entry.fetched_at.elapsed() < AppState::model_cache_ttl() {
                return Ok(entry.models.clone());
            }
        }
    }

    let cfg = {
        let settings = state.settings.lock().unwrap();
        find_provider(&settings, &provider_id)?
    };
    let provider = build_provider(&cfg);
    let models = provider.list_models().await.map_err(|e| e.to_string())?;

    state.model_cache.lock().unwrap().insert(
        provider_id,
        ModelCacheEntry {
            fetched_at: Instant::now(),
            models: models.clone(),
        },
    );
    Ok(models)
}

#[derive(Serialize)]
pub struct ProviderTestResult {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    models_found: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

#[tauri::command]
pub async fn test_provider(
    state: State<'_, AppState>,
    provider_id: String,
) -> Result<ProviderTestResult, String> {
    let cfg = {
        let settings = state.settings.lock().unwrap();
        find_provider(&settings, &provider_id)?
    };
    let provider = build_provider(&cfg);
    match provider.list_models().await {
        Ok(models) => {
            state.model_cache.lock().unwrap().insert(
                provider_id,
                ModelCacheEntry {
                    fetched_at: Instant::now(),
                    models: models.clone(),
                },
            );
            Ok(ProviderTestResult {
                ok: true,
                models_found: Some(models.len() as i64),
                message: None,
            })
        }
        Err(e) => Ok(ProviderTestResult {
            ok: false,
            models_found: None,
            message: Some(e.to_string()),
        }),
    }
}

#[tauri::command]
pub async fn cancel_stream(state: State<'_, AppState>, stream_id: String) -> Result<(), String> {
    if let Some(token) = state.active_streams.lock().unwrap().get(&stream_id) {
        token.cancel();
    }
    Ok(())
}

/// Loads history + resolves the provider config for a conversation. Kept
/// synchronous and short-lived so the db/settings locks never cross an
/// await point.
fn prepare_chat(
    state: &AppState,
    conversation_id: i64,
    reasoning_effort: Option<String>,
) -> Result<(ProviderConfig, ChatRequest), String> {
    let conn = state.db.lock().unwrap();
    let conversation = db::get_conversation(&conn, conversation_id)
        .map_err(db_err)?
        .ok_or_else(|| "conversation not found".to_string())?;
    let history = db::get_messages(&conn, conversation_id, 500, None).map_err(db_err)?;
    drop(conn);

    let settings = state.settings.lock().unwrap();
    let provider_cfg = find_provider(&settings, &conversation.provider)?;
    drop(settings);

    let mut messages: Vec<ChatMessage> = Vec::new();
    if let Some(system_prompt) = &conversation.system_prompt {
        messages.push(ChatMessage {
            role: "system".into(),
            content: system_prompt.clone(),
            reasoning: None,
        });
    }
    messages.extend(history.into_iter().map(|m| ChatMessage {
        role: m.role,
        content: m.content,
        reasoning: m.reasoning,
    }));

    Ok((
        provider_cfg,
        ChatRequest {
            model: conversation.model,
            messages,
            reasoning_effort,
        },
    ))
}

enum Outcome {
    Finished(Usage),
    Cancelled,
    Errored(String),
}

#[tauri::command]
pub async fn send_message(
    app: AppHandle,
    state: State<'_, AppState>,
    conversation_id: i64,
    text: String,
    reasoning_effort: Option<String>,
) -> Result<String, String> {
    {
        let conn = state.db.lock().unwrap();
        db::insert_message(
            &conn,
            conversation_id,
            "user",
            &text,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .map_err(db_err)?;

        // If conversation is still named "New chat", auto-set its title from the first word
        if let Ok(Some(conv)) = db::get_conversation(&conn, conversation_id) {
            if conv.title == "New chat" {
                let first_word = text
                    .trim()
                    .split_whitespace()
                    .next()
                    .unwrap_or("")
                    .trim_matches(|c: char| !c.is_alphanumeric());
                let title = if !first_word.is_empty() {
                    first_word.to_string()
                } else {
                    text.trim().chars().take(20).collect()
                };
                if !title.is_empty() {
                    let _ = db::rename_conversation(&conn, conversation_id, &title);
                }
            }
        }
    }

    start_stream(app, &state, conversation_id, reasoning_effort).await
}

/// Shared by `send_message` (history already has the new user turn appended)
/// and `retry_message` (the failed/unwanted assistant turn has already been
/// deleted) - both just need to run the provider against whatever history
/// currently exists and stream the result back.
async fn start_stream(
    app: AppHandle,
    state: &AppState,
    conversation_id: i64,
    reasoning_effort: Option<String>,
) -> Result<String, String> {
    let (provider_cfg, chat_request) = prepare_chat(state, conversation_id, reasoning_effort)?;
    let model = chat_request.model.clone();
    let provider_id = provider_cfg.id.clone();

    let stream_id = uuid::Uuid::new_v4().to_string();
    let cancel = CancellationToken::new();
    state
        .active_streams
        .lock()
        .unwrap()
        .insert(stream_id.clone(), cancel.clone());

    let (tx, mut rx) = mpsc::channel::<StreamEvent>(256);
    let provider = build_provider(&provider_cfg);
    let stream_task = tokio::spawn(async move { provider.stream_chat(chat_request, tx, cancel).await });

    let app_for_task = app.clone();
    let stream_id_for_task = stream_id.clone();

    tokio::spawn(async move {
        let channel = format!("stream://{stream_id_for_task}");
        let started = Instant::now();
        let mut full_text = String::new();
        let mut full_reasoning = String::new();
        let mut pending = String::new();
        let mut interval =
            tokio::time::interval(std::time::Duration::from_millis(COALESCE_INTERVAL_MS));

        loop {
            tokio::select! {
                event = rx.recv() => {
                    match event {
                        Some(StreamEvent::Delta { text }) => {
                            full_text.push_str(&text);
                            pending.push_str(&text);
                        }
                        Some(StreamEvent::Reasoning { text }) => {
                            full_reasoning.push_str(&text);
                            let _ = app_for_task.emit(&channel, StreamEvent::Reasoning { text });
                        }
                        Some(_) => {}
                        None => break,
                    }
                }
                _ = interval.tick() => {
                    if !pending.is_empty() {
                        let _ = app_for_task.emit(
                            &channel,
                            StreamEvent::Delta { text: std::mem::take(&mut pending) },
                        );
                    }
                }
            }
        }
        if !pending.is_empty() {
            let _ = app_for_task.emit(&channel, StreamEvent::Delta { text: pending });
        }

        let duration_ms = started.elapsed().as_millis() as i64;
        let outcome = match stream_task.await {
            Ok(Ok(usage)) => Outcome::Finished(usage),
            Ok(Err(ProviderError::Cancelled)) => Outcome::Cancelled,
            Ok(Err(e)) => Outcome::Errored(e.to_string()),
            Err(join_err) => Outcome::Errored(join_err.to_string()),
        };

        let app_state = app_for_task.state::<AppState>();
        app_state.active_streams.lock().unwrap().remove(&stream_id_for_task);

        // Partial or complete text is always persisted - including on
        // cancellation or a mid-stream network error - so the user never
        // loses output that already arrived.
        let usage = match &outcome {
            Outcome::Finished(u) => u.clone(),
            _ => Usage::default(),
        };
        if !full_text.is_empty() {
            let conn = app_state.db.lock().unwrap();
            let reasoning = (!full_reasoning.is_empty()).then_some(full_reasoning.as_str());
            let _ = db::insert_message(
                &conn,
                conversation_id,
                "assistant",
                &full_text,
                reasoning,
                Some(&provider_id),
                Some(&model),
                Some(duration_ms),
                usage.tokens_in,
                usage.tokens_out,
            );
        }

        match outcome {
            Outcome::Finished(usage) => {
                let _ = app_for_task.emit(
                    &channel,
                    StreamEvent::Done {
                        tokens_in: usage.tokens_in,
                        tokens_out: usage.tokens_out,
                        duration_ms,
                    },
                );
            }
            Outcome::Cancelled => {
                let _ = app_for_task.emit(
                    &channel,
                    StreamEvent::Done {
                        tokens_in: None,
                        tokens_out: None,
                        duration_ms,
                    },
                );
            }
            Outcome::Errored(message) => {
                let _ = app_for_task.emit(&channel, StreamEvent::Error { message });
            }
        }
    });

    Ok(stream_id)
}

#[tauri::command]
pub async fn test_mcp_server(
    command: String,
    args: Vec<String>,
    env: std::collections::BTreeMap<String, String>,
) -> Result<Vec<crate::mcp::McpTool>, String> {
    crate::mcp::query_tools("test", "test", &command, &args, &env).await
}

#[tauri::command]
pub async fn list_mcp_tools(state: State<'_, AppState>) -> Result<Vec<crate::mcp::McpTool>, String> {
    let servers = {
        let settings = state.settings.lock().unwrap();
        settings.mcp_servers.clone()
    };

    let mut all_tools = Vec::new();
    for s in servers {
        if !s.enabled {
            continue;
        }
        if let Ok(tools) = crate::mcp::query_tools(&s.id, &s.name, &s.command, &s.args, &s.env).await {
            all_tools.extend(tools);
        }
    }
    Ok(all_tools)
}

#[tauri::command]
pub async fn call_mcp_tool(
    state: State<'_, AppState>,
    server_id: String,
    tool_name: String,
    arguments: serde_json::Value,
) -> Result<String, String> {
    let server = {
        let settings = state.settings.lock().unwrap();
        settings.mcp_servers.iter().find(|s| s.id == server_id).cloned()
    };

    let server = server.ok_or_else(|| format!("MCP Server '{}' not found", server_id))?;
    crate::mcp::execute_tool(&server.command, &server.args, &server.env, &tool_name, &arguments).await
}
