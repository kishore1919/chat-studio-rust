use crate::config::{self, ProviderConfig, Settings};
use crate::context;
use crate::db;
use crate::providers::{
    build_provider, ChatMessage, ChatRequest, ModelInfo, ProviderError, ProviderEvent, StreamEvent,
    Usage,
};
use crate::state::{AppState, ModelCacheEntry, RequestSnapshot};
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
    system_prompt: Option<String>,
    agent_id: Option<String>,
) -> Result<db::Conversation, String> {
    let conn = state.db();
    db::create_conversation(
        &conn,
        &provider,
        &model,
        system_prompt.as_deref(),
        agent_id.as_deref(),
    )
    .map_err(db_err)
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
    let provider_id = provider.id.clone();
    {
        let mut settings = state.settings();
        settings.providers.retain(|p| p.id != provider_id);
        settings.providers.push(provider);
        config::save_settings(&settings).map_err(|e| e.to_string())?;
    }
    state.model_cache().remove(&provider_id);
    Ok(())
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

#[derive(Serialize)]
pub struct LastRequestInfo {
    pub conversation_id: i64,
    pub provider_id: String,
    pub model: String,
    pub message_roles: Vec<String>,
    pub used_tokens: u32,
    pub budget_tokens: u32,
    pub dropped_count: usize,
}

/// Snapshot of the most recent request assembled by `prepare_chat`, so
/// "the model forgot everything" can be checked against what was actually
/// sent instead of guessed at. `None` until the first message of the session.
#[tauri::command]
pub fn get_last_request(state: State<AppState>) -> Option<LastRequestInfo> {
    state.last_request().as_ref().map(|r| LastRequestInfo {
        conversation_id: r.conversation_id,
        provider_id: r.provider_id.clone(),
        model: r.model.clone(),
        message_roles: r.message_roles.clone(),
        used_tokens: r.used_tokens,
        budget_tokens: r.budget_tokens,
        dropped_count: r.dropped_count,
    })
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

/// Upper bound on how many rows even leave the database, regardless of
/// `context_tokens` - a very short-message conversation shouldn't force a
/// several-hundred-row scan just because it's cheap in characters.
const HISTORY_ROW_CAP: i64 = 400;

/// Resolves the system prompt for a conversation: its own prompt (set via a
/// skill, or by hand) wins; the global default in Settings only applies when
/// the conversation has none.
fn resolve_system_prompt(
    conversation: &db::Conversation,
    global_system_prompt: Option<&str>,
) -> Option<String> {
    conversation
        .system_prompt
        .clone()
        .or_else(|| global_system_prompt.map(String::from))
}

/// What `prepare_chat` hands off to `start_stream`: the resolved provider
/// plus the assembled request, with enough of the plan left in for post-stream
/// decisions (rolling memory only fires when history was actually dropped).
struct PreparedChat {
    provider_cfg: ProviderConfig,
    request: ChatRequest,
    newest_dropped_id: Option<i64>,
}

/// Loads history + resolves the provider config for a conversation. Kept
/// synchronous and short-lived so the db/settings locks never cross an
/// await point.
fn prepare_chat(
    state: &AppState,
    conversation_id: i64,
    reasoning_effort: Option<String>,
) -> Result<PreparedChat, String> {
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
    let memory_enabled = settings.memory_enabled;
    let system_prompt = resolve_system_prompt(&conversation, settings.system_prompt.as_deref());
    drop(settings);

    // The stored summary only feeds the request while memory is on - flipping
    // the toggle off must revert to today's drop-history behavior even if
    // older summaries still exist on disk.
    let summary = memory_enabled
        .then(|| conversation.summary.clone())
        .flatten();
    let plan = context::plan_context(
        &history,
        system_prompt.as_deref(),
        summary.as_deref(),
        context_tokens,
    );

    let message_roles: Vec<String> = plan.messages.iter().map(|m| m.role.clone()).collect();
    tracing::debug!(
        conversation_id,
        message_count = plan.messages.len(),
        dropped_count = plan.dropped_count,
        used_tokens = plan.used_tokens,
        budget_tokens = plan.budget_tokens,
        roles = ?message_roles,
        lengths = ?plan.messages.iter().map(|m| m.content.len()).collect::<Vec<_>>(),
        "request assembled"
    );
    tracing::trace!(conversation_id, body = ?plan.messages, "request body");
    *state.last_request() = Some(RequestSnapshot {
        conversation_id,
        provider_id: provider_cfg.id.clone(),
        model: conversation.model.clone(),
        message_roles,
        used_tokens: plan.used_tokens,
        budget_tokens: plan.budget_tokens,
        dropped_count: plan.dropped_count,
    });

    Ok(PreparedChat {
        provider_cfg,
        request: ChatRequest {
            model: conversation.model,
            messages: plan.messages,
            reasoning_effort,
        },
        newest_dropped_id: plan.newest_dropped_id,
    })
}

/// Snapshot of how full the context window is for a conversation, optionally
/// including an unsent draft as a trailing user turn - lets the composer show
/// a live meter before the message is actually persisted and sent.
#[derive(Serialize)]
pub struct ContextUsage {
    pub used_tokens: u32,
    pub budget_tokens: u32,
    pub dropped_count: usize,
    /// Tokens spent on system-role content - surfaced so a long skill prompt
    /// is attributable as the cause of drops instead of looking like bloat in
    /// the history itself.
    pub system_tokens: u32,
}

#[tauri::command]
pub async fn get_context_usage(
    state: State<'_, AppState>,
    conversation_id: i64,
    draft: Option<String>,
) -> Result<ContextUsage, String> {
    let conn = state.db();
    let conversation = db::get_conversation(&conn, conversation_id)
        .map_err(db_err)?
        .ok_or_else(|| "conversation not found".to_string())?;
    let mut history =
        db::get_context_messages(&conn, conversation_id, HISTORY_ROW_CAP).map_err(db_err)?;
    drop(conn);

    if let Some(text) = draft.filter(|t| !t.trim().is_empty()) {
        history.insert(
            0,
            db::ContextRow {
                id: 0,
                role: "user".into(),
                content: text,
                pinned: false,
            },
        );
    }

    let settings = state.settings();
    let context_tokens = settings.context_tokens;
    let memory_enabled = settings.memory_enabled;
    let system_prompt = resolve_system_prompt(&conversation, settings.system_prompt.as_deref());
    drop(settings);

    let summary = memory_enabled
        .then(|| conversation.summary.clone())
        .flatten();
    let plan = context::plan_context(
        &history,
        system_prompt.as_deref(),
        summary.as_deref(),
        context_tokens,
    );
    Ok(ContextUsage {
        used_tokens: plan.used_tokens,
        budget_tokens: plan.budget_tokens,
        dropped_count: plan.dropped_count,
        system_tokens: plan.system_tokens,
    })
}

/// `flag` must be one of `"normal" | "pinned" | "excluded"`.
#[tauri::command]
pub async fn set_message_context_flag(
    state: State<'_, AppState>,
    message_id: i64,
    flag: String,
) -> Result<(), String> {
    let message_id = valid_message_id(message_id)?;
    if !matches!(flag.as_str(), "normal" | "pinned" | "excluded") {
        return Err(format!("invalid context flag: {flag}"));
    }
    let conn = state.db();
    db::set_message_context_flag(&conn, message_id, &flag).map_err(db_err)
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
    let prepared = prepare_chat(state, conversation_id, reasoning_effort)?;
    let provider_cfg = prepared.provider_cfg;
    let chat_request = prepared.request;
    let newest_dropped_id = prepared.newest_dropped_id;
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
    let provider_cfg_for_summary = provider_cfg.clone();

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
        const MAX_REPLY_CHARS: usize = 500_000;
        let mut full_text = String::new();
        let mut full_reasoning = String::new();
        let mut pending: Vec<Pending> = Vec::new();
        let mut truncated = false;
        let mut interval =
            tokio::time::interval(std::time::Duration::from_millis(COALESCE_INTERVAL_MS));

        loop {
            tokio::select! {
                event = rx.recv() => {
                    match event {
                        Some(ProviderEvent::Delta { text }) => {
                            if full_text.len() + text.len() > MAX_REPLY_CHARS {
                                truncated = true;
                                break;
                            }
                            full_text.push_str(&text);
                            Pending::push(&mut pending, ProviderEvent::Delta { text });
                        }
                        Some(ProviderEvent::Reasoning { text }) => {
                            if full_reasoning.len() + text.len() > MAX_REPLY_CHARS {
                                truncated = true;
                                break;
                            }
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
        let outcome = if truncated {
            Outcome::Errored("reply truncated: exceeded maximum length".into())
        } else {
            match stream_task.await {
            Ok(Ok(usage)) => Outcome::Finished(usage),
            Ok(Err(ProviderError::Cancelled)) => Outcome::Cancelled,
            Ok(Err(e)) => Outcome::Errored(e.to_string()),
            Err(join_err) => Outcome::Errored(join_err.to_string()),
            }
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

        // Rolling memory: this request dropped the oldest turns, so have the
        // conversation's own provider compress them into a stored summary the
        // next request injects in their place. Background, best-effort - a
        // failure just degrades to today's drop-it-and-move-on behavior.
        if let Some(through_id) = newest_dropped_id {
            if app_state.settings().memory_enabled {
                let app_for_summary = app_for_task.clone();
                let provider_cfg_for_summary = provider_cfg_for_summary.clone();
                let model_for_summary = model.clone();
                tokio::spawn(async move {
                    summarize_old_turns(
                        &app_for_summary,
                        conversation_id,
                        provider_cfg_for_summary,
                        model_for_summary,
                        through_id,
                    )
                    .await;
                });
            }
        }

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

/// Instruction for the rolling summary call. The summary stands in for the
/// dropped oldest turns, so it has to carry enough that a later question can
/// still be answered from it - it's sent as system content, not shown to the
/// user.
const SUMMARY_PROMPT: &str = "Write a concise but complete summary of the conversation below. Preserve key facts, decisions, open questions, and anything a later question might refer back to. The summary will be sent to the model in place of these messages, so it must stand on its own.";

/// Compresses the oldest turns of a conversation (those `plan_context` just
/// dropped) via the conversation's own provider and stores the result as the
/// rolling summary. Runs detached from the stream that triggered it; every
/// failure path is logged and non-fatal.
async fn summarize_old_turns(
    app: &AppHandle,
    conversation_id: i64,
    provider_cfg: ProviderConfig,
    model: String,
    through_id: i64,
) {
    let app_state = app.state::<AppState>();
    let messages = {
        let conn = app_state.db();
        match db::get_messages_up_to(&conn, conversation_id, through_id) {
            Ok(m) => m,
            Err(e) => {
                tracing::warn!(conversation_id, error = %e, "rolling summary: history load failed");
                return;
            }
        }
    };
    if messages.is_empty() {
        return;
    }

    let mut req_messages = vec![ChatMessage {
        role: "system".into(),
        content: SUMMARY_PROMPT.into(),
    }];
    req_messages.extend(messages.iter().map(|m| ChatMessage {
        role: m.role.clone(),
        content: m.content.clone(),
    }));

    let provider = build_provider(&app_state.http, &provider_cfg);
    let (tx, mut rx) = mpsc::channel::<ProviderEvent>(32);
    let cancel = CancellationToken::new();
    let task = tokio::spawn(async move {
        provider
            .stream_chat(
                ChatRequest {
                    model,
                    messages: req_messages,
                    reasoning_effort: None,
                },
                tx,
                cancel,
            )
            .await
    });

    let mut summary = String::new();
    while let Some(event) = rx.recv().await {
        if let ProviderEvent::Delta { text } = event {
            summary.push_str(&text);
        }
    }
    // Drain first, then check the result - the provider blocks on the bounded
    // channel, so not draining would deadlock the summary generation itself.
    match task.await {
        Ok(Ok(_)) => {}
        Ok(Err(e)) => {
            tracing::warn!(conversation_id, error = %e, "rolling summary stream failed");
            return;
        }
        Err(join_err) => {
            tracing::warn!(conversation_id, error = %join_err, "rolling summary task panicked");
            return;
        }
    }
    let summary = summary.trim().to_string();
    if summary.is_empty() {
        tracing::warn!(conversation_id, "rolling summary produced no text");
        return;
    }

    let conn = app_state.db();
    match db::set_conversation_summary(&conn, conversation_id, &summary, through_id) {
        Ok(()) => {
            tracing::debug!(
                conversation_id,
                chars = summary.len(),
                "rolling summary persisted"
            )
        }
        Err(e) => tracing::warn!(conversation_id, error = %e, "rolling summary not persisted"),
    }
}

#[tauri::command]
pub async fn test_mcp_server(
    state: State<'_, AppState>,
    transport: crate::config::McpTransport,
    command: String,
    args: Vec<String>,
    env: std::collections::BTreeMap<String, String>,
    url: String,
    headers: std::collections::BTreeMap<String, String>,
) -> Result<Vec<crate::mcp::McpTool>, String> {
    crate::mcp::test_connection(
        Some(state.http.clone()),
        transport,
        &command,
        &args,
        &env,
        &url,
        &headers,
    )
    .await
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
    let http = Some(state.http.clone());
    let results =
        futures_util::future::join_all(servers.iter().filter(|s| s.enabled).map(|s| async {
            let result = state
                .mcp
                .list_tools(
                    http.clone(),
                    &s.id,
                    &s.name,
                    s.transport,
                    &s.command,
                    &s.args,
                    &s.env,
                    &s.url,
                    &s.headers,
                )
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
            Some(state.http.clone()),
            &server.id,
            server.transport,
            &server.command,
            &server.args,
            &server.env,
            &server.url,
            &server.headers,
            &tool_name,
            &arguments,
        )
        .await
}

#[tauri::command]
pub async fn list_global_skills() -> Result<Vec<crate::config::Skill>, String> {
    Ok(crate::skills::discover_global_skills())
}

#[tauri::command]
pub fn set_window_theme(app: AppHandle, theme_type: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let theme = match theme_type.to_lowercase().as_str() {
            "light" => tauri::Theme::Light,
            _ => tauri::Theme::Dark,
        };
        window.set_theme(Some(theme)).map_err(|e| e.to_string())?;
    }
    Ok(())
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
