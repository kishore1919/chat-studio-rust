use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    pub id: i64,
    pub title: String,
    pub provider: String,
    pub model: String,
    pub system_prompt: Option<String>,
    pub agent_id: Option<String>,
    pub pinned: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: i64,
    pub conversation_id: i64,
    pub role: String,
    pub content: String,
    pub reasoning: Option<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub duration_ms: Option<i64>,
    pub tokens_in: Option<i64>,
    pub tokens_out: Option<i64>,
    pub created_at: i64,
}

const SCHEMA_VERSION: i64 = 4;

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    // FULL fsyncs on every commit; NORMAL is the documented safe pairing with
    // WAL (a crash can lose the last commit, never corrupt the file) and is a
    // real write-latency win on every message sent.
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "busy_timeout", 5000)?;
    init_schema(&conn)?;
    Ok(conn)
}

/// Startup fallback when the on-disk database can't be opened. Chats won't
/// persist, but the app stays usable and - importantly - the file we failed to
/// read is left untouched rather than being recreated over.
pub fn open_in_memory() -> rusqlite::Result<Connection> {
    let conn = Connection::open_in_memory()?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    init_schema(&conn)?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version >= SCHEMA_VERSION {
        return Ok(());
    }

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS conversations (
            id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            system_prompt TEXT,
            agent_id TEXT DEFAULT 'general-assistant',
            pinned INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY,
            conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            reasoning TEXT,
            provider TEXT,
            model TEXT,
            duration_ms INTEGER,
            tokens_in INTEGER,
            tokens_out INTEGER,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);
        ",
    )?;

    if version == 1 {
        conn.execute(
            "ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
        conn.execute("ALTER TABLE messages ADD COLUMN reasoning TEXT", [])?;
    }

    if version < 4 {
        // Safe upgrade: add agent_id if upgrading from version <= 3
        let has_agent_col: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('conversations') WHERE name = 'agent_id'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .map(|c| c > 0)
            .unwrap_or(false);
        if !has_agent_col {
            conn.execute(
                "ALTER TABLE conversations ADD COLUMN agent_id TEXT DEFAULT 'general-assistant'",
                [],
            )?;
        }
    }

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_conversations_sort ON conversations(pinned DESC, updated_at DESC)",
        [],
    )?;

    conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    Ok(())
}

fn now() -> i64 {
    // A system clock set before 1970 is not worth threading a Result through
    // every insert signature; 0 sorts such rows oldest, which is harmless.
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

const CONVERSATION_COLUMNS: &str =
    "id, title, provider, model, system_prompt, agent_id, pinned, created_at, updated_at";

fn row_to_conversation(r: &rusqlite::Row) -> rusqlite::Result<Conversation> {
    Ok(Conversation {
        id: r.get(0)?,
        title: r.get(1)?,
        provider: r.get(2)?,
        model: r.get(3)?,
        system_prompt: r.get(4)?,
        agent_id: r.get(5)?,
        pinned: r.get::<_, i64>(6)? != 0,
        created_at: r.get(7)?,
        updated_at: r.get(8)?,
    })
}

pub fn list_conversations(conn: &Connection) -> rusqlite::Result<Vec<Conversation>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {CONVERSATION_COLUMNS} FROM conversations ORDER BY pinned DESC, updated_at DESC"
    ))?;
    let rows = stmt.query_map([], row_to_conversation)?;
    rows.collect()
}

pub fn create_conversation(
    conn: &Connection,
    provider: &str,
    model: &str,
    system_prompt: Option<&str>,
    agent_id: Option<&str>,
) -> rusqlite::Result<Conversation> {
    let ts = now();
    conn.execute(
        "INSERT INTO conversations (title, provider, model, system_prompt, agent_id, pinned, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?6)",
        params!["New chat", provider, model, system_prompt, agent_id.unwrap_or("general-assistant"), ts],
    )?;
    let id = conn.last_insert_rowid();
    Ok(Conversation {
        id,
        title: "New chat".into(),
        provider: provider.into(),
        model: model.into(),
        system_prompt: system_prompt.map(Into::into),
        agent_id: Some(agent_id.unwrap_or("general-assistant").into()),
        pinned: false,
        created_at: ts,
        updated_at: ts,
    })
}

pub fn rename_conversation(conn: &Connection, id: i64, title: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE conversations SET title = ?1, updated_at = ?2 WHERE id = ?3",
        params![title, now(), id],
    )?;
    Ok(())
}

pub fn set_conversation_system_prompt(
    conn: &Connection,
    id: i64,
    system_prompt: Option<&str>,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE conversations SET system_prompt = ?1, updated_at = ?2 WHERE id = ?3",
        params![system_prompt, now(), id],
    )?;
    Ok(())
}

pub fn set_conversation_pinned(conn: &Connection, id: i64, pinned: bool) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE conversations SET pinned = ?1 WHERE id = ?2",
        params![pinned as i64, id],
    )?;
    Ok(())
}

pub fn update_conversation_model(
    conn: &Connection,
    id: i64,
    provider: &str,
    model: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE conversations SET provider = ?1, model = ?2, updated_at = ?3 WHERE id = ?4",
        params![provider, model, now(), id],
    )?;
    Ok(())
}

pub fn touch_conversation(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
        params![now(), id],
    )?;
    Ok(())
}

/// Same as `touch_conversation`, but for callers that only have a message id
/// (`edit_message`/`delete_message`'s IPC signatures never carry a
/// conversation id). Resolves the owner in the same statement rather than a
/// separate lookup, and must run before the message row is gone - a delete
/// first would leave nothing for the subquery to resolve against.
fn touch_conversation_by_message(conn: &Connection, message_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE conversations SET updated_at = ?1
         WHERE id = (SELECT conversation_id FROM messages WHERE id = ?2)",
        params![now(), message_id],
    )?;
    Ok(())
}

pub fn delete_conversation(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM conversations WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn clear_messages(conn: &Connection, conversation_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM messages WHERE conversation_id = ?1",
        params![conversation_id],
    )?;
    touch_conversation(conn, conversation_id)?;
    Ok(())
}

const MESSAGE_COLUMNS: &str = "id, conversation_id, role, content, reasoning, provider, model, duration_ms, tokens_in, tokens_out, created_at";

fn row_to_message(r: &rusqlite::Row) -> rusqlite::Result<Message> {
    Ok(Message {
        id: r.get(0)?,
        conversation_id: r.get(1)?,
        role: r.get(2)?,
        content: r.get(3)?,
        reasoning: r.get(4)?,
        provider: r.get(5)?,
        model: r.get(6)?,
        duration_ms: r.get(7)?,
        tokens_in: r.get(8)?,
        tokens_out: r.get(9)?,
        created_at: r.get(10)?,
    })
}

/// Paginates newest-first from `before_id` (exclusive), returned oldest-first
/// so the frontend can prepend directly onto its in-memory list.
pub fn get_messages(
    conn: &Connection,
    conversation_id: i64,
    limit: i64,
    before_id: Option<i64>,
) -> rusqlite::Result<Vec<Message>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {MESSAGE_COLUMNS}
         FROM messages
         WHERE conversation_id = ?1 AND (?2 IS NULL OR id < ?2)
         ORDER BY id DESC
         LIMIT ?3"
    ))?;
    let rows = stmt.query_map(params![conversation_id, before_id, limit], row_to_message)?;
    let mut messages: Vec<Message> = rows.collect::<rusqlite::Result<_>>()?;
    messages.reverse();
    Ok(messages)
}

/// A row of history stripped to what a provider request actually needs.
/// `reasoning` and the token/timing columns don't belong on the wire - on a
/// thinking model the reasoning bodies dwarf the answers, and most endpoints
/// reject or ignore fields they don't recognize.
pub struct ContextRow {
    pub role: String,
    pub content: String,
}

/// Newest-first, capped at `limit` rows - the caller (`budget_history`) walks
/// backwards from the most recent turn under a token budget, so it needs the
/// most recent rows first, not the oldest. Uses the same
/// `(conversation_id, id)` index as `get_messages`; SQLite can walk it in
/// reverse for `ORDER BY id DESC`.
pub fn get_context_messages(
    conn: &Connection,
    conversation_id: i64,
    limit: i64,
) -> rusqlite::Result<Vec<ContextRow>> {
    let mut stmt = conn.prepare(
        "SELECT role, content FROM messages WHERE conversation_id = ?1 ORDER BY id DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![conversation_id, limit], |r| {
        Ok(ContextRow {
            role: r.get(0)?,
            content: r.get(1)?,
        })
    })?;
    rows.collect()
}

#[allow(clippy::too_many_arguments)]
pub fn insert_message(
    conn: &Connection,
    conversation_id: i64,
    role: &str,
    content: &str,
    reasoning: Option<&str>,
    provider: Option<&str>,
    model: Option<&str>,
    duration_ms: Option<i64>,
    tokens_in: Option<i64>,
    tokens_out: Option<i64>,
) -> rusqlite::Result<(i64, i64)> {
    let created_at = now();
    conn.execute(
        "INSERT INTO messages (conversation_id, role, content, reasoning, provider, model, duration_ms, tokens_in, tokens_out, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![conversation_id, role, content, reasoning, provider, model, duration_ms, tokens_in, tokens_out, created_at],
    )?;
    let id = conn.last_insert_rowid();
    touch_conversation(conn, conversation_id)?;
    Ok((id, created_at))
}

pub fn edit_message(conn: &Connection, id: i64, content: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE messages SET content = ?1 WHERE id = ?2",
        params![content, id],
    )?;
    touch_conversation_by_message(conn, id)
}

pub fn delete_message(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    touch_conversation_by_message(conn, id)?;
    conn.execute("DELETE FROM messages WHERE id = ?1", params![id])?;
    Ok(())
}

/// Used by "retry": drops the target message and anything after it (id-order
/// doubles as chronological order here, since ids are assigned by autoincrement),
/// so regenerating a reply also discards any messages that were sent after it.
pub fn delete_message_and_after(
    conn: &Connection,
    conversation_id: i64,
    message_id: i64,
) -> rusqlite::Result<()> {
    // `id >= ?` matches every real rowid when handed a non-positive id, which
    // turns a retry into a full conversation wipe. `commands::valid_message_id`
    // rejects those at the IPC boundary; this catches any future caller that
    // bypasses it.
    debug_assert!(
        message_id > 0,
        "delete_message_and_after: id must be positive"
    );
    conn.execute(
        "DELETE FROM messages WHERE conversation_id = ?1 AND id >= ?2",
        params![conversation_id, message_id],
    )?;
    // Without this, retrying a message doesn't re-sort it to the top of the
    // sidebar even though the conversation is now the most recently active one.
    touch_conversation(conn, conversation_id)?;
    Ok(())
}

pub fn delete_messages_after(
    conn: &Connection,
    conversation_id: i64,
    message_id: i64,
) -> rusqlite::Result<()> {
    // Same hazard as `delete_message_and_after`, one row narrower.
    debug_assert!(message_id > 0, "delete_messages_after: id must be positive");
    conn.execute(
        "DELETE FROM messages WHERE conversation_id = ?1 AND id > ?2",
        params![conversation_id, message_id],
    )?;
    touch_conversation(conn, conversation_id)?;
    Ok(())
}

pub fn get_conversation(conn: &Connection, id: i64) -> rusqlite::Result<Option<Conversation>> {
    conn.query_row(
        &format!("SELECT {CONVERSATION_COLUMNS} FROM conversations WHERE id = ?1"),
        params![id],
        row_to_conversation,
    )
    .optional()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        init_schema(&conn).unwrap();
        conn
    }

    fn insert_simple(conn: &Connection, conv_id: i64, role: &str, content: &str) -> i64 {
        insert_message(
            conn, conv_id, role, content, None, None, None, None, None, None,
        )
        .unwrap()
        .0
    }

    #[test]
    fn create_and_list_conversations() {
        let conn = memory_db();
        let conv = create_conversation(&conn, "openrouter", "gpt-test", None, None).unwrap();
        assert_eq!(conv.title, "New chat");
        assert!(!conv.pinned);

        let list = list_conversations(&conn).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, conv.id);
    }

    #[test]
    fn rename_and_delete_conversation() {
        let conn = memory_db();
        let conv = create_conversation(&conn, "openrouter", "gpt-test", None, None).unwrap();
        rename_conversation(&conn, conv.id, "Renamed").unwrap();
        let fetched = get_conversation(&conn, conv.id).unwrap().unwrap();
        assert_eq!(fetched.title, "Renamed");

        delete_conversation(&conn, conv.id).unwrap();
        assert!(get_conversation(&conn, conv.id).unwrap().is_none());
    }

    #[test]
    fn pinned_conversations_sort_first() {
        let conn = memory_db();
        let a = create_conversation(&conn, "openrouter", "m", None, None).unwrap();
        let b = create_conversation(&conn, "openrouter", "m", None, None).unwrap();
        set_conversation_pinned(&conn, b.id, true).unwrap();

        let list = list_conversations(&conn).unwrap();
        assert_eq!(list[0].id, b.id);
        assert_eq!(list[1].id, a.id);
    }

    #[test]
    fn insert_and_paginate_messages() {
        let conn = memory_db();
        let conv = create_conversation(&conn, "openrouter", "gpt-test", None, None).unwrap();
        for i in 0..5 {
            insert_simple(&conn, conv.id, "user", &format!("message {i}"));
        }

        let page1 = get_messages(&conn, conv.id, 2, None).unwrap();
        assert_eq!(page1.len(), 2);
        assert_eq!(page1[0].content, "message 3");
        assert_eq!(page1[1].content, "message 4");

        let page2 = get_messages(&conn, conv.id, 2, Some(page1[0].id)).unwrap();
        assert_eq!(page2.len(), 2);
        assert_eq!(page2[0].content, "message 1");
        assert_eq!(page2[1].content, "message 2");
    }

    #[test]
    fn deleting_conversation_cascades_messages() {
        let conn = memory_db();
        let conv = create_conversation(&conn, "openrouter", "gpt-test", None, None).unwrap();
        insert_simple(&conn, conv.id, "user", "hi");
        delete_conversation(&conn, conv.id).unwrap();

        let remaining: i64 = conn
            .query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0))
            .unwrap();
        assert_eq!(remaining, 0);
    }

    #[test]
    fn edit_and_delete_message() {
        let conn = memory_db();
        let conv = create_conversation(&conn, "openrouter", "gpt-test", None, None).unwrap();
        let id = insert_simple(&conn, conv.id, "user", "hi");
        edit_message(&conn, id, "edited").unwrap();
        let messages = get_messages(&conn, conv.id, 10, None).unwrap();
        assert_eq!(messages[0].content, "edited");

        delete_message(&conn, id).unwrap();
        let messages = get_messages(&conn, conv.id, 10, None).unwrap();
        assert!(messages.is_empty());
    }

    #[test]
    fn delete_message_and_after_drops_trailing_messages() {
        let conn = memory_db();
        let conv = create_conversation(&conn, "openrouter", "gpt-test", None, None).unwrap();
        let first = insert_simple(&conn, conv.id, "user", "hi");
        let retry_target = insert_simple(&conn, conv.id, "assistant", "wrong answer");
        insert_simple(&conn, conv.id, "user", "follow up");

        delete_message_and_after(&conn, conv.id, retry_target).unwrap();

        let messages = get_messages(&conn, conv.id, 10, None).unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].id, first);
    }

    #[test]
    fn clear_messages_empties_conversation_but_keeps_it() {
        let conn = memory_db();
        let conv = create_conversation(&conn, "openrouter", "gpt-test", None, None).unwrap();
        insert_simple(&conn, conv.id, "user", "hi");
        insert_simple(&conn, conv.id, "assistant", "hello");

        clear_messages(&conn, conv.id).unwrap();

        assert!(get_messages(&conn, conv.id, 10, None).unwrap().is_empty());
        assert!(get_conversation(&conn, conv.id).unwrap().is_some());
    }

    #[test]
    fn insert_message_persists_reasoning() {
        let conn = memory_db();
        let conv = create_conversation(&conn, "openrouter", "gpt-test", None, None).unwrap();
        insert_message(
            &conn,
            conv.id,
            "assistant",
            "final answer",
            Some("step by step reasoning"),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();

        let messages = get_messages(&conn, conv.id, 10, None).unwrap();
        assert_eq!(
            messages[0].reasoning.as_deref(),
            Some("step by step reasoning")
        );
    }

    /// Documents why the `debug_assert` exists: the `id >= ?` predicate is
    /// unbounded below, so a placeholder id from the webview would match every
    /// real row. The assert is the tripwire; `commands::valid_message_id` is the
    /// actual guard.
    #[test]
    #[should_panic(expected = "id must be positive")]
    fn delete_message_and_after_rejects_placeholder_id() {
        let conn = memory_db();
        let conv = create_conversation(&conn, "openrouter", "m", None, None).unwrap();
        insert_simple(&conn, conv.id, "user", "hi");
        insert_simple(&conn, conv.id, "assistant", "hello");

        delete_message_and_after(&conn, conv.id, -1_755_000_000_000).unwrap();
    }

    #[test]
    #[should_panic(expected = "id must be positive")]
    fn delete_messages_after_rejects_placeholder_id() {
        let conn = memory_db();
        let conv = create_conversation(&conn, "openrouter", "m", None, None).unwrap();
        insert_simple(&conn, conv.id, "user", "hi");

        delete_messages_after(&conn, conv.id, -1).unwrap();
    }

    #[test]
    fn fresh_install_lands_on_current_schema_version_with_sort_index() {
        let conn = memory_db();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);

        let index_exists: bool = conn
            .query_row(
                "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_conversations_sort'",
                [],
                |_| Ok(true),
            )
            .optional()
            .unwrap()
            .unwrap_or(false);
        assert!(index_exists, "idx_conversations_sort should exist");
    }

    #[test]
    fn migrates_v1_schema_preserving_existing_rows() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE conversations (
                id INTEGER PRIMARY KEY,
                title TEXT NOT NULL,
                provider TEXT NOT NULL,
                model TEXT NOT NULL,
                system_prompt TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE messages (
                id INTEGER PRIMARY KEY,
                conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                provider TEXT,
                model TEXT,
                duration_ms INTEGER,
                tokens_in INTEGER,
                tokens_out INTEGER,
                created_at INTEGER NOT NULL
            );
            ",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO conversations (id, title, provider, model, created_at, updated_at)
             VALUES (1, 'Legacy chat', 'openrouter', 'gpt', 100, 100)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at)
             VALUES (1, 1, 'user', 'hello', 100)",
            [],
        )
        .unwrap();
        conn.pragma_update(None, "user_version", 1i64).unwrap();

        init_schema(&conn).unwrap();

        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);

        let conv = get_conversation(&conn, 1).unwrap().unwrap();
        assert_eq!(conv.title, "Legacy chat");
        assert!(!conv.pinned, "new column should default to false");

        let messages = get_messages(&conn, 1, 10, None).unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].content, "hello");
        assert_eq!(
            messages[0].reasoning, None,
            "new column should default to NULL"
        );
    }

    #[test]
    fn fresh_install_version_zero_does_not_trigger_v1_alter() {
        // Guards the `if version == 1` branch: a fresh install's
        // `CREATE TABLE IF NOT EXISTS` already includes `pinned`/`reasoning`
        // at version 0, so a looser guard like `version < 2` would re-run
        // this ALTER against columns that already exist and fail.
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE conversations (
                id INTEGER PRIMARY KEY,
                title TEXT NOT NULL,
                provider TEXT NOT NULL,
                model TEXT NOT NULL,
                system_prompt TEXT,
                pinned INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE messages (
                id INTEGER PRIMARY KEY,
                conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                reasoning TEXT,
                provider TEXT,
                model TEXT,
                duration_ms INTEGER,
                tokens_in INTEGER,
                tokens_out INTEGER,
                created_at INTEGER NOT NULL
            );
            ",
        )
        .unwrap();
        // user_version is left at its default of 0.
        init_schema(&conn).unwrap();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
    }

    #[test]
    fn init_schema_is_idempotent() {
        let conn = memory_db();
        init_schema(&conn).unwrap();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
    }

    #[test]
    fn v2_to_v3_upgrade_adds_sort_index() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE conversations (
                id INTEGER PRIMARY KEY,
                title TEXT NOT NULL,
                provider TEXT NOT NULL,
                model TEXT NOT NULL,
                system_prompt TEXT,
                pinned INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE messages (
                id INTEGER PRIMARY KEY,
                conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                reasoning TEXT,
                provider TEXT,
                model TEXT,
                duration_ms INTEGER,
                tokens_in INTEGER,
                tokens_out INTEGER,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX idx_messages_conv ON messages(conversation_id, id);
            ",
        )
        .unwrap();
        conn.pragma_update(None, "user_version", 2i64).unwrap();

        init_schema(&conn).unwrap();

        let index_exists: bool = conn
            .query_row(
                "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_conversations_sort'",
                [],
                |_| Ok(true),
            )
            .optional()
            .unwrap()
            .unwrap_or(false);
        assert!(index_exists);
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
    }

    #[test]
    fn get_context_messages_returns_newest_first_without_reasoning_columns() {
        let conn = memory_db();
        let conv = create_conversation(&conn, "openrouter", "gpt-test", None, None).unwrap();
        insert_simple(&conn, conv.id, "user", "first");
        insert_simple(&conn, conv.id, "assistant", "second");
        insert_simple(&conn, conv.id, "user", "third");

        let rows = get_context_messages(&conn, conv.id, 10).unwrap();
        assert_eq!(
            rows.iter().map(|r| r.content.as_str()).collect::<Vec<_>>(),
            vec!["third", "second", "first"]
        );
    }

    #[test]
    fn edit_and_delete_message_touch_the_owning_conversation() {
        let conn = memory_db();
        let conv = create_conversation(&conn, "openrouter", "m", None, None).unwrap();
        let id = insert_simple(&conn, conv.id, "user", "hi");

        conn.execute(
            "UPDATE conversations SET updated_at = 0 WHERE id = ?1",
            params![conv.id],
        )
        .unwrap();
        edit_message(&conn, id, "edited").unwrap();
        let after_edit = get_conversation(&conn, conv.id).unwrap().unwrap();
        assert!(after_edit.updated_at > 0);

        conn.execute(
            "UPDATE conversations SET updated_at = 0 WHERE id = ?1",
            params![conv.id],
        )
        .unwrap();
        delete_message(&conn, id).unwrap();
        let after_delete = get_conversation(&conn, conv.id).unwrap().unwrap();
        assert!(after_delete.updated_at > 0);
    }
}
