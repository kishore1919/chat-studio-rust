use crate::config::{self, ProviderConfig, Settings};
use crate::db;
use crate::providers::{
    build_provider, ChatMessage, ChatRequest, ModelInfo, ProviderError, ProviderEvent, StreamEvent,
    Usage,
};
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

/// Message ids arrive straight from the webview, which synthesizes placeholder
/// ids for rows it has optimistically rendered but not yet persisted. Those
/// placeholders are negative, and `delete_message_and_after`'s `id >= ?`
/// predicate matches *every* real autoincrement rowid against one - so a
/// placeholder reaching it wipes the whole conversation. Reject at the boundary
/// rather than trusting the caller to only ever send persisted ids.
fn valid_message_id(id: i64) -> Result<i64, String> {
    if id > 0 {
        Ok(id)
    } else {
        Err(format!("invalid message id: {id}"))
    }
}

/// `emit` only fails when the webview is gone, but dropping the error silently
/// meant a lost terminal event left the UI spinning forever with nothing to
/// explain it. Logging turns that into a diagnosable bug report.
fn emit_event(app: &AppHandle, channel: &str, event: StreamEvent) {
    if let Err(e) = app.emit(channel, event) {
        tracing::warn!(channel, error = %e, "stream event emit failed");
    }
}

/// Delta and Reasoning go to different places in the UI but must preserve
/// their relative order on the wire - buffering them as two independent
/// strings and flushing both every tick would let a `Reasoning` run that
/// arrived after some `Delta` text race ahead of it on the receiving end, so
/// they share one ordered buffer of same-kind runs instead.
enum Pending {
    Text(String),
    Reasoning(String),
}

impl Pending {
    fn push(buf: &mut Vec<Pending>, event: ProviderEvent) {
        match event {
            ProviderEvent::Delta { text } => match buf.last_mut() {
                Some(Pending::Text(t)) => t.push_str(&text),
                _ => buf.push(Pending::Text(text)),
            },
            ProviderEvent::Reasoning { text } => match buf.last_mut() {
                Some(Pending::Reasoning(t)) => t.push_str(&text),
                _ => buf.push(Pending::Reasoning(text)),
            },
        }
    }
}

fn flush_pending(app: &AppHandle, channel: &str, buf: &mut Vec<Pending>) {
    for item in buf.drain(..) {
        match item {
            Pending::Text(text) => emit_event(app, channel, StreamEvent::Delta { text }),
            Pending::Reasoning(text) => emit_event(app, channel, StreamEvent::Reasoning { text }),
        }
    }
}

/// RAII removal of an `active_streams` entry inserted by the caller. Only
/// wraps removal, not insertion - the insert must stay synchronous in
/// `start_stream`, before the coalescing task is even spawned, so a
/// `cancel_stream` call racing the task's startup still finds the entry.
struct StreamRegistration<'a> {
    state: &'a AppState,
    stream_id: String,
}

impl<'a> StreamRegistration<'a> {
    fn new(state: &'a AppState, stream_id: String) -> Self {
        Self { state, stream_id }
    }
}

impl Drop for StreamRegistration<'_> {
    fn drop(&mut self) {
        self.state.active_streams().remove(&self.stream_id);
    }
}

#[tauri::command]
pub fn list_conversations(state: State<AppState>) -> Result<Vec<db::Conversation>, String> {
    let conn = state.db();
    db::list_conversations(&conn).map_err(db_err)
}

#[tauri::command]
pub fn get_messages(
    state: State<AppState>,
    conversation_id: i64,
    limit: i64,
    before_id: Option<i64>,
) -> Result<Vec<db::Message>, String> {
    let conn = state.db();
    db::get_messages(&conn, conversation_id, limit, before_id).map_err(db_err)
}

#[tauri::command]
pub fn create_conversation(
    state: State<AppState>,
    provider: String,
    model: String,
) -> Result<db::Conversation, String> {
    let conn = state.db();
    db::create_conversation(&conn, &provider, &model).map_err(db_err)
}

#[tauri::command]
pub fn rename_conversation(
    state: State<AppState>,
    conversation_id: i64,
    title: String,
) -> Result<(), String> {
    let conn = state.db();
    db::rename_conversation(&conn, conversation_id, &title).map_err(db_err)
}

#[tauri::command]
pub fn delete_conversation(state: State<AppState>, conversation_id: i64) -> Result<(), String> {
    let conn = state.db();
    db::delete_conversation(&conn, conversation_id).map_err(db_err)
}

#[tauri::command]
pub fn pin_conversation(
    state: State<AppState>,
    conversation_id: i64,
    pinned: bool,
) -> Result<(), String> {
    let conn = state.db();
    db::set_conversation_pinned(&conn, conversation_id, pinned).map_err(db_err)
}

#[tauri::command]
pub fn clear_conversation(state: State<AppState>, conversation_id: i64) -> Result<(), String> {
    let conn = state.db();
    db::clear_messages(&conn, conversation_id).map_err(db_err)
}

#[tauri::command]
pub fn set_conversation_model(
    state: State<AppState>,
    conversation_id: i64,
    provider: String,
    model: String,
) -> Result<(), String> {
    let conn = state.db();
    db::update_conversation_model(&conn, conversation_id, &provider, &model).map_err(db_err)
}

#[tauri::command]
pub fn set_conversation_system_prompt(
    state: State<AppState>,
    conversation_id: i64,
    system_prompt: Option<String>,
) -> Result<(), String> {
    let conn = state.db();
    db::set_conversation_system_prompt(&conn, conversation_id, system_prompt.as_deref())
        .map_err(db_err)
}

#[tauri::command]
pub fn edit_message(
    state: State<AppState>,
    message_id: i64,
    content: String,
) -> Result<(), String> {
    let message_id = valid_message_id(message_id)?;
    let conn = state.db();
    db::edit_message(&conn, message_id, &content).map_err(db_err)
}

#[tauri::command]
pub fn delete_message(state: State<AppState>, message_id: i64) -> Result<(), String> {
    let message_id = valid_message_id(message_id)?;
    let conn = state.db();
    db::delete_message(&conn, message_id).map_err(db_err)
}

#[tauri::command]
pub async fn retry_message(
    app: AppHandle,
    state: State<'_, AppState>,
    conversation_id: i64,
    message_id: i64,
    reasoning_effort: Option<String>,
    stream_id: String,
) -> Result<StreamHandle, String> {
    let message_id = valid_message_id(message_id)?;
    {
        let conn = state.db();
        db::delete_message_and_after(&conn, conversation_id, message_id).map_err(db_err)?;
    }
    start_stream(
        app,
        &state,
        conversation_id,
        reasoning_effort,
        stream_id.clone(),
    )
    .await?;
    Ok(StreamHandle {
        stream_id,
        user_message_id: None,
        title: None,
    })
}

#[tauri::command]
pub async fn edit_and_resend_message(
    app: AppHandle,
    state: State<'_, AppState>,
    conversation_id: i64,
    message_id: i64,
    content: String,
    reasoning_effort: Option<String>,
    stream_id: String,
) -> Result<StreamHandle, String> {
    let message_id = valid_message_id(message_id)?;
    {
        let conn = state.db();
        db::edit_message(&conn, message_id, &content).map_err(db_err)?;
        db::delete_messages_after(&conn, conversation_id, message_id).map_err(db_err)?;
    }
    start_stream(
        app,
        &state,
        conversation_id,
        reasoning_effort,
        stream_id.clone(),
    )
    .await?;
    Ok(StreamHandle {
        stream_id,
        user_message_id: None,
        title: None,
    })
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Settings {
    state.settings().clone()
}

#[tauri::command]
pub fn save_settings(state: State<AppState>, settings: Settings) -> Result<(), String> {
    config::save_settings(&settings).map_err(|e| e.to_string())?;
    let ids: std::collections::HashSet<&str> =
        settings.providers.iter().map(|p| p.id.as_str()).collect();
    // A stale entry just wastes a little memory today, but it's exactly the
    // kind of leak that compounds - evict removed providers' cached model
    // lists here rather than letting them accumulate for the app's lifetime.
    state
        .model_cache()
        .retain(|id, _| ids.contains(id.as_str()));
    *state.settings() = settings;
    Ok(())
}

#[tauri::command]
pub fn add_provider(state: State<AppState>, provider: ProviderConfig) -> Result<(), String> {
    let mut settings = state.settings();
    settings.providers.retain(|p| p.id != provider.id);
    settings.providers.push(provider);
    config::save_settings(&settings).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_provider(state: State<AppState>, provider_id: String) -> Result<(), String> {
    let mut settings = state.settings();
    settings.providers.retain(|p| p.id != provider_id);
    config::save_settings(&settings).map_err(|e| e.to_string())?;
    drop(settings);
    state.model_cache().remove(&provider_id);
    Ok(())
}

#[tauri::command]
pub fn open_config_dir() -> Result<(), String> {
    open::that(config::config_dir()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_log_dir() -> Result<(), String> {
    let dir = config::log_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    open::that(dir).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct Diagnostics {
    pub app_version: String,
    pub log_dir: String,
    pub config_dir: String,
    pub db_path: String,
    pub schema_version: i64,
    pub provider_count: usize,
    pub startup_warnings: Vec<String>,
}

/// Everything needed to make a bug report actionable, in one call.
#[tauri::command]
pub fn get_diagnostics(state: State<AppState>) -> Diagnostics {
    let schema_version = state
        .db()
        .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
        .unwrap_or(-1);

    Diagnostics {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        log_dir: config::log_dir().display().to_string(),
        config_dir: config::config_dir().display().to_string(),
        db_path: config::config_dir().join("chats.db").display().to_string(),
        schema_version,
        provider_count: state.settings().providers.len(),
        startup_warnings: state.startup_warnings.clone(),
    }
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
        let cache = state.model_cache();
        if let Some(entry) = cache.get(&provider_id) {
            if entry.fetched_at.elapsed() < AppState::model_cache_ttl() {
                return Ok(entry.models.clone());
            }
        }
    }

    let cfg = {
        let settings = state.settings();
        find_provider(&settings, &provider_id)?
    };
    let provider = build_provider(&state.http, &cfg);
    let models = provider.list_models().await.map_err(|e| e.to_string())?;

    state.model_cache().insert(
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
        let settings = state.settings();
        find_provider(&settings, &provider_id)?
    };
    let provider = build_provider(&state.http, &cfg);
    match provider.list_models().await {
        Ok(models) => {
            state.model_cache().insert(
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
    if let Some(token) = state.active_streams().get(&stream_id) {
        token.cancel();
    }
    Ok(())
}

/// Deliberately pessimistic proxy for tokens - no tokenizer is bundled, and
/// shipping BPE tables per model family would cost more than a conservative
/// estimate. Undercounting drops one extra old turn rather than overshooting
/// a provider's real limit.
const CHARS_PER_TOKEN: usize = 3;
/// Reserved out of the budget for the model's own reply.
const RESPONSE_RESERVE_TOKENS: u32 = 4096;
/// Upper bound on how many rows even leave the database, regardless of
/// `context_tokens` - a very short-message conversation shouldn't force a
/// several-hundred-row scan just because it's cheap in characters.
const HISTORY_ROW_CAP: i64 = 400;

/// Walks history backwards (newest-first, as `get_context_messages` returns
/// it) under a character budget, then reverses back to chronological order.
/// Pure so it's independently testable. Always keeps the most recent turn
/// (index 0) even if it alone exceeds budget - a request with no question in
/// it is worse than one that's over budget.
fn budget_history(newest_first: &[db::ContextRow], context_tokens: u32) -> Vec<ChatMessage> {
    let budget_chars = context_tokens
        .saturating_sub(RESPONSE_RESERVE_TOKENS)
        .saturating_mul(CHARS_PER_TOKEN as u32) as usize;

    let mut kept = Vec::new();
    let mut used = 0usize;
    for (i, row) in newest_first.iter().enumerate() {
        let cost = row.content.len();
        if i == 0 || used.saturating_add(cost) <= budget_chars {
            kept.push(row);
            used += cost;
        } else {
            break;
        }
    }

    kept.into_iter()
        .rev()
        .map(|r| ChatMessage {
            role: r.role.clone(),
            content: r.content.clone(),
        })
        .collect()
}

/// Loads history + resolves the provider config for a conversation. Kept
/// synchronous and short-lived so the db/settings locks never cross an
/// await point.
fn prepare_chat(
    state: &AppState,
    conversation_id: i64,
    reasoning_effort: Option<String>,
) -> Result<(ProviderConfig, ChatRequest), String> {
    let conn = state.db();
    let conversation = db::get_conversation(&conn, conversation_id)
        .map_err(db_err)?
        .ok_or_else(|| "conversation not found".to_string())?;
    // Only role + content leave the database - no `reasoning`, no token/timing
    // columns. On a thinking model the reasoning bodies dwarf the answers, and
    // they're write-only-to-the-wire anyway: most endpoints ignore an unknown
    // `reasoning` input field, strict ones reject it, none consume it back.
    let history =
        db::get_context_messages(&conn, conversation_id, HISTORY_ROW_CAP).map_err(db_err)?;
    drop(conn);

    let settings = state.settings();
    let provider_cfg = find_provider(&settings, &conversation.provider)?;
    let context_tokens = settings.context_tokens;
    let global_system_prompt = settings.system_prompt.clone();
    drop(settings);

    let mut messages: Vec<ChatMessage> = Vec::new();
    // The conversation's own prompt (set via a skill, or by hand) wins; the
    // global default in Settings only applies when the conversation has none.
    if let Some(system_prompt) = conversation
        .system_prompt
        .as_ref()
        .or(global_system_prompt.as_ref())
    {
        messages.push(ChatMessage {
            role: "system".into(),
            content: system_prompt.clone(),
        });
    }
    messages.extend(budget_history(&history, context_tokens));

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

/// Returned by the three stream-starting commands. Per AGENTS.md, command
/// return values serialize verbatim (no camelCase), so the frontend sees
/// these field names exactly.
#[derive(Serialize)]
pub struct StreamHandle {
    pub stream_id: String,
    /// Rowid of the user turn just inserted. `None` for retry/edit-resend,
    /// which re-run against existing history without adding a new user
    /// message row.
    pub user_message_id: Option<i64>,
    /// Set when the auto-titler renamed a "New chat", so the sidebar updates
    /// without a `list_conversations` round-trip.
    pub title: Option<String>,
}

/// Character cap for an auto-generated conversation title - long enough to be
/// recognizable in the sidebar, short enough not to wrap onto a second line.
const TITLE_MAX_CHARS: usize = 40;

/// Derives a sidebar title from the first user message. Previously took only
/// the first whitespace-separated word, so "How do I configure ACI
/// multi-pod?" titled as just "How" - this takes a whole leading slice of the
/// trimmed message instead. Empty or whitespace-only input yields an empty
/// string, which the caller treats as "don't rename".
fn derive_title(text: &str) -> String {
    text.trim().chars().take(TITLE_MAX_CHARS).collect()
}

#[tauri::command]
pub async fn send_message(
    app: AppHandle,
    state: State<'_, AppState>,
    conversation_id: i64,
    text: String,
    reasoning_effort: Option<String>,
    stream_id: String,
) -> Result<StreamHandle, String> {
    let (user_message_id, title) = {
        let conn = state.db();
        let (user_message_id, _created_at) = db::insert_message(
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

        // If conversation is still named "New chat", auto-set its title from the message.
        let mut title = None;
        if let Ok(Some(conv)) = db::get_conversation(&conn, conversation_id) {
            if conv.title == "New chat" {
                let new_title = derive_title(&text);
                if !new_title.is_empty() {
                    match db::rename_conversation(&conn, conversation_id, &new_title) {
                        Ok(()) => title = Some(new_title),
                        Err(e) => {
                            // Cosmetic only - the chat still works under its old title.
                            tracing::warn!(conversation_id, error = %e, "auto-title rename failed");
                        }
                    }
                }
            }
        }
        (user_message_id, title)
    };

    start_stream(
        app,
        &state,
        conversation_id,
        reasoning_effort,
        stream_id.clone(),
    )
    .await?;
    Ok(StreamHandle {
        stream_id,
        user_message_id: Some(user_message_id),
        title,
    })
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
    stream_id: String,
) -> Result<(), String> {
    let (provider_cfg, chat_request) = prepare_chat(state, conversation_id, reasoning_effort)?;
    let model = chat_request.model.clone();
    let provider_id = provider_cfg.id.clone();

    let cancel = CancellationToken::new();
    state
        .active_streams()
        .insert(stream_id.clone(), cancel.clone());

    tracing::debug!(
        stream_id = %stream_id,
        provider_id = %provider_id,
        model = %model,
        "stream starting"
    );

    let (tx, mut rx) = mpsc::channel::<ProviderEvent>(256);
    let provider = build_provider(&state.http, &provider_cfg);
    let stream_task =
        tokio::spawn(async move { provider.stream_chat(chat_request, tx, cancel).await });

    let app_for_task = app.clone();
    let stream_id_for_task = stream_id.clone();

    tokio::spawn(async move {
        let app_state = app_for_task.state::<AppState>();
        // `active_streams` is already populated by the synchronous insert
        // above (so a `cancel_stream` racing this task's startup still finds
        // the entry); this guard only owns the removal, and it runs on every
        // exit path of this async block - including an unwinding panic
        // (`panic = "unwind"` in the release profile makes that reachable) -
        // which the old bare `.remove()` call near the bottom of this
        // function would never reach.
        let _registration = StreamRegistration::new(&app_state, stream_id_for_task.clone());

        let channel = format!("stream://{stream_id_for_task}");
        let started = Instant::now();
        let mut full_text = String::new();
        let mut full_reasoning = String::new();
        let mut pending: Vec<Pending> = Vec::new();
        let mut interval =
            tokio::time::interval(std::time::Duration::from_millis(COALESCE_INTERVAL_MS));

        loop {
            tokio::select! {
                event = rx.recv() => {
                    match event {
                        Some(ProviderEvent::Delta { text }) => {
                            full_text.push_str(&text);
                            Pending::push(&mut pending, ProviderEvent::Delta { text });
                        }
                        Some(ProviderEvent::Reasoning { text }) => {
                            full_reasoning.push_str(&text);
                            Pending::push(&mut pending, ProviderEvent::Reasoning { text });
                        }
                        None => break,
                    }
                }
                _ = interval.tick() => {
                    flush_pending(&app_for_task, &channel, &mut pending);
                }
            }
        }
        flush_pending(&app_for_task, &channel, &mut pending);

        let duration_ms = started.elapsed().as_millis() as i64;
        let outcome = match stream_task.await {
            Ok(Ok(usage)) => Outcome::Finished(usage),
            Ok(Err(ProviderError::Cancelled)) => Outcome::Cancelled,
            Ok(Err(e)) => Outcome::Errored(e.to_string()),
            Err(join_err) => Outcome::Errored(join_err.to_string()),
        };

        // Partial or complete text is always persisted - including on
        // cancellation or a mid-stream network error - so the user never
        // loses output that already arrived.
        let usage = match &outcome {
            Outcome::Finished(u) => u.clone(),
            _ => Usage::default(),
        };
        // If this insert fails the user watches the reply arrive and then finds
        // it gone on next load, so the failure has to reach them as an error
        // rather than being dropped.
        let mut persist_error = None;
        let mut message_id = None;
        let mut created_at = 0i64;
        if !full_text.is_empty() {
            let conn = app_state.db();
            let reasoning = (!full_reasoning.is_empty()).then_some(full_reasoning.as_str());
            match db::insert_message(
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
            ) {
                Ok((id, ts)) => {
                    message_id = Some(id);
                    created_at = ts;
                }
                Err(e) => {
                    tracing::error!(
                        conversation_id,
                        chars = full_text.len(),
                        error = %e,
                        "failed to persist assistant reply"
                    );
                    persist_error = Some(format!("reply was not saved: {e}"));
                }
            }
        }

        tracing::debug!(
            stream_id = %stream_id_for_task,
            duration_ms,
            chars = full_text.len(),
            reasoning_chars = full_reasoning.len(),
            "stream finished"
        );

        if let Some(message) = persist_error {
            // Takes precedence over the outcome: a successful generation that
            // wasn't saved is still a failure from the user's point of view.
            emit_event(
                &app_for_task,
                &channel,
                StreamEvent::Error {
                    message,
                    message_id,
                },
            );
            return;
        }

        match outcome {
            Outcome::Finished(usage) => emit_event(
                &app_for_task,
                &channel,
                StreamEvent::Done {
                    message_id,
                    provider: provider_id,
                    model,
                    created_at,
                    tokens_in: usage.tokens_in,
                    tokens_out: usage.tokens_out,
                    duration_ms,
                },
            ),
            Outcome::Cancelled => emit_event(
                &app_for_task,
                &channel,
                StreamEvent::Done {
                    message_id,
                    provider: provider_id,
                    model,
                    created_at,
                    tokens_in: None,
                    tokens_out: None,
                    duration_ms,
                },
            ),
            Outcome::Errored(message) => {
                tracing::warn!(stream_id = %stream_id_for_task, error = %message, "stream errored");
                emit_event(
                    &app_for_task,
                    &channel,
                    StreamEvent::Error {
                        message,
                        message_id,
                    },
                )
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn test_mcp_server(
    command: String,
    args: Vec<String>,
    env: std::collections::BTreeMap<String, String>,
) -> Result<Vec<crate::mcp::McpTool>, String> {
    crate::mcp::test_connection(&command, &args, &env).await
}

#[tauri::command]
pub async fn list_mcp_tools(
    state: State<'_, AppState>,
) -> Result<Vec<crate::mcp::McpTool>, String> {
    let servers = {
        let settings = state.settings();
        settings.mcp_servers.clone()
    };

    // Concurrent, not sequential: the old per-server spawn-then-kill paid a
    // process cold start serially per server on every refresh.
    let results =
        futures_util::future::join_all(servers.iter().filter(|s| s.enabled).map(|s| async {
            let result = state
                .mcp
                .list_tools(&s.id, &s.name, &s.command, &s.args, &s.env)
                .await;
            (s.id.clone(), result)
        }))
        .await;

    let mut all_tools = Vec::new();
    for (server_id, result) in results {
        match result {
            Ok(tools) => all_tools.extend(tools),
            // Previously silently omitted - a server that failed to start
            // just vanished from the list with no trace anywhere.
            Err(e) => tracing::warn!(server_id = %server_id, error = %e, "MCP list_tools failed"),
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
        let settings = state.settings();
        settings
            .mcp_servers
            .iter()
            .find(|s| s.id == server_id)
            .cloned()
    };

    let server = server.ok_or_else(|| format!("MCP Server '{}' not found", server_id))?;
    state
        .mcp
        .call_tool(
            &server.id,
            &server.command,
            &server.args,
            &server.env,
            &tool_name,
            &arguments,
        )
        .await
}

#[tauri::command]
pub async fn list_global_skills() -> Result<Vec<crate::config::Skill>, String> {
    Ok(crate::skills::discover_global_skills())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_message_id_accepts_real_rowids() {
        assert_eq!(valid_message_id(1).unwrap(), 1);
        assert_eq!(valid_message_id(i64::MAX).unwrap(), i64::MAX);
    }

    #[test]
    fn valid_message_id_rejects_placeholders_and_zero() {
        // `-Date.now()` is the shape the webview used to send for optimistically
        // rendered rows; each of these would have matched every real row against
        // `delete_message_and_after`'s `id >= ?`.
        for id in [0, -1, -1_755_000_000_000, i64::MIN] {
            assert!(valid_message_id(id).is_err(), "should reject {id}");
        }
    }

    fn row(role: &str, content: &str) -> db::ContextRow {
        db::ContextRow {
            role: role.into(),
            content: content.into(),
        }
    }

    #[test]
    fn budget_history_fits_entirely_under_a_generous_budget() {
        let newest_first = vec![
            row("user", "third"),
            row("assistant", "second"),
            row("user", "first"),
        ];
        let out = budget_history(&newest_first, 32768);
        let contents: Vec<_> = out.iter().map(|m| m.content.as_str()).collect();
        assert_eq!(contents, vec!["first", "second", "third"]);
    }

    #[test]
    fn budget_history_drops_oldest_rows_first() {
        // Budget of 4096 reserved tokens + a tiny remainder leaves ~0 budget
        // chars, so only the always-kept newest turn should survive.
        let newest_first = vec![
            row("user", &"y".repeat(100)),
            row("assistant", &"x".repeat(100)),
            row("user", &"w".repeat(100)),
        ];
        let out = budget_history(&newest_first, RESPONSE_RESERVE_TOKENS + 10);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].content, "y".repeat(100));
    }

    #[test]
    fn budget_history_always_keeps_the_newest_turn_even_if_oversized() {
        let huge = "z".repeat(1_000_000);
        let newest_first = vec![row("user", &huge)];
        let out = budget_history(&newest_first, 1);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].content, huge);
    }

    #[test]
    fn budget_history_handles_empty_input() {
        assert!(budget_history(&[], 32768).is_empty());
    }

    #[test]
    fn derive_title_uses_more_than_the_first_word() {
        // The bug this replaces: "How do I configure ACI multi-pod?" used to
        // title as just "How".
        assert_eq!(
            derive_title("How do I configure ACI multi-pod?"),
            "How do I configure ACI multi-pod?"
        );
    }

    #[test]
    fn derive_title_truncates_long_input() {
        let long = "a".repeat(100);
        let title = derive_title(&long);
        assert_eq!(title.chars().count(), TITLE_MAX_CHARS);
    }

    #[test]
    fn derive_title_handles_empty_and_whitespace_only() {
        assert_eq!(derive_title(""), "");
        assert_eq!(derive_title("   \n\t  "), "");
    }

    #[test]
    fn derive_title_handles_punctuation_only() {
        assert_eq!(derive_title("???"), "???");
    }

    #[test]
    fn derive_title_handles_unicode_without_panicking() {
        let title = derive_title("こんにちは、世界。今日はいい天気ですね、散歩に行きましょう。");
        assert!(title.chars().count() <= TITLE_MAX_CHARS);
        assert!(!title.is_empty());
    }
}
