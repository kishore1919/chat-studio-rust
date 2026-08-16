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
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: i64,
    pub conversation_id: i64,
    pub role: String,
    pub content: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub duration_ms: Option<i64>,
    pub tokens_in: Option<i64>,
    pub tokens_out: Option<i64>,
    pub created_at: i64,
}

const SCHEMA_VERSION: i64 = 1;

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
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
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
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
        CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);
        ",
    )?;
    conn.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    Ok(())
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

pub fn list_conversations(conn: &Connection) -> rusqlite::Result<Vec<Conversation>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, provider, model, system_prompt, created_at, updated_at
         FROM conversations ORDER BY updated_at DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Conversation {
            id: r.get(0)?,
            title: r.get(1)?,
            provider: r.get(2)?,
            model: r.get(3)?,
            system_prompt: r.get(4)?,
            created_at: r.get(5)?,
            updated_at: r.get(6)?,
        })
    })?;
    rows.collect()
}

pub fn create_conversation(
    conn: &Connection,
    provider: &str,
    model: &str,
) -> rusqlite::Result<Conversation> {
    let ts = now();
    conn.execute(
        "INSERT INTO conversations (title, provider, model, system_prompt, created_at, updated_at)
         VALUES (?1, ?2, ?3, NULL, ?4, ?4)",
        params!["New chat", provider, model, ts],
    )?;
    let id = conn.last_insert_rowid();
    Ok(Conversation {
        id,
        title: "New chat".into(),
        provider: provider.into(),
        model: model.into(),
        system_prompt: None,
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

pub fn delete_conversation(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM conversations WHERE id = ?1", params![id])?;
    Ok(())
}

/// Paginates newest-first from `before_id` (exclusive), returned oldest-first
/// so the frontend can prepend directly onto its in-memory list.
pub fn get_messages(
    conn: &Connection,
    conversation_id: i64,
    limit: i64,
    before_id: Option<i64>,
) -> rusqlite::Result<Vec<Message>> {
    let mut stmt = conn.prepare(
        "SELECT id, conversation_id, role, content, provider, model, duration_ms, tokens_in, tokens_out, created_at
         FROM messages
         WHERE conversation_id = ?1 AND (?2 IS NULL OR id < ?2)
         ORDER BY id DESC
         LIMIT ?3",
    )?;
    let rows = stmt.query_map(params![conversation_id, before_id, limit], |r| {
        Ok(Message {
            id: r.get(0)?,
            conversation_id: r.get(1)?,
            role: r.get(2)?,
            content: r.get(3)?,
            provider: r.get(4)?,
            model: r.get(5)?,
            duration_ms: r.get(6)?,
            tokens_in: r.get(7)?,
            tokens_out: r.get(8)?,
            created_at: r.get(9)?,
        })
    })?;
    let mut messages: Vec<Message> = rows.collect::<rusqlite::Result<_>>()?;
    messages.reverse();
    Ok(messages)
}

#[allow(clippy::too_many_arguments)]
pub fn insert_message(
    conn: &Connection,
    conversation_id: i64,
    role: &str,
    content: &str,
    provider: Option<&str>,
    model: Option<&str>,
    duration_ms: Option<i64>,
    tokens_in: Option<i64>,
    tokens_out: Option<i64>,
) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO messages (conversation_id, role, content, provider, model, duration_ms, tokens_in, tokens_out, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![conversation_id, role, content, provider, model, duration_ms, tokens_in, tokens_out, now()],
    )?;
    let id = conn.last_insert_rowid();
    touch_conversation(conn, conversation_id)?;
    Ok(id)
}

pub fn edit_message(conn: &Connection, id: i64, content: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE messages SET content = ?1 WHERE id = ?2",
        params![content, id],
    )?;
    Ok(())
}

pub fn delete_message(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM messages WHERE id = ?1", params![id])?;
    Ok(())
}

#[allow(dead_code)]
pub fn get_conversation(conn: &Connection, id: i64) -> rusqlite::Result<Option<Conversation>> {
    conn.query_row(
        "SELECT id, title, provider, model, system_prompt, created_at, updated_at
         FROM conversations WHERE id = ?1",
        params![id],
        |r| {
            Ok(Conversation {
                id: r.get(0)?,
                title: r.get(1)?,
                provider: r.get(2)?,
                model: r.get(3)?,
                system_prompt: r.get(4)?,
                created_at: r.get(5)?,
                updated_at: r.get(6)?,
            })
        },
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

    #[test]
    fn create_and_list_conversations() {
        let conn = memory_db();
        let conv = create_conversation(&conn, "openrouter", "gpt-test").unwrap();
        assert_eq!(conv.title, "New chat");

        let list = list_conversations(&conn).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, conv.id);
    }

    #[test]
    fn rename_and_delete_conversation() {
        let conn = memory_db();
        let conv = create_conversation(&conn, "openrouter", "gpt-test").unwrap();
        rename_conversation(&conn, conv.id, "Renamed").unwrap();
        let fetched = get_conversation(&conn, conv.id).unwrap().unwrap();
        assert_eq!(fetched.title, "Renamed");

        delete_conversation(&conn, conv.id).unwrap();
        assert!(get_conversation(&conn, conv.id).unwrap().is_none());
    }

    #[test]
    fn insert_and_paginate_messages() {
        let conn = memory_db();
        let conv = create_conversation(&conn, "openrouter", "gpt-test").unwrap();
        for i in 0..5 {
            insert_message(
                &conn,
                conv.id,
                "user",
                &format!("message {i}"),
                None,
                None,
                None,
                None,
                None,
            )
            .unwrap();
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
        let conv = create_conversation(&conn, "openrouter", "gpt-test").unwrap();
        insert_message(&conn, conv.id, "user", "hi", None, None, None, None, None).unwrap();
        delete_conversation(&conn, conv.id).unwrap();

        let remaining: i64 = conn
            .query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0))
            .unwrap();
        assert_eq!(remaining, 0);
    }

    #[test]
    fn edit_and_delete_message() {
        let conn = memory_db();
        let conv = create_conversation(&conn, "openrouter", "gpt-test").unwrap();
        let id = insert_message(&conn, conv.id, "user", "hi", None, None, None, None, None).unwrap();
        edit_message(&conn, id, "edited").unwrap();
        let messages = get_messages(&conn, conv.id, 10, None).unwrap();
        assert_eq!(messages[0].content, "edited");

        delete_message(&conn, id).unwrap();
        let messages = get_messages(&conn, conv.id, 10, None).unwrap();
        assert!(messages.is_empty());
    }
}
