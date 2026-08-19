# Chat memory first, then Cherry Studio parity

## Context

Chat Studio is a working Tauri v2 chat client with a Rust backend: 5 provider dialects
behind one `Provider` trait, coalesced streaming, SQLite history with version-gated
migrations (`SCHEMA_VERSION = 5`), and an MCP client with stdio + streamable-HTTP.

The immediate complaint is that the model **forgets earlier turns** — chats feel like
they replay from scratch. Everything else (Cherry Studio parity) waits behind that.

### What the investigation actually found

Traced end to end against the live database and logs, the backend **does** send full
history:

- `send_message` (`commands.rs:591`) persists the user turn, then `prepare_chat`
  (`commands.rs:458`) re-reads the conversation via `db::get_context_messages` and
  budgets it in `context::plan_context`.
- Live data: conversation 9 in `%APPDATA%\chat-studio\chats.db` holds all 14 turns,
  correctly alternating user/assistant, every row `context_flag='normal'`, no
  conversation system prompt.
- That conversation totals ~11k chars against a ~86k-char budget
  (`context_tokens = 32768`, minus `RESPONSE_RESERVE_TOKENS = 4096`, × 3 chars/token),
  so `plan_context` drops **nothing**.
- `openai_compat.rs:164` sends `req.messages` verbatim; `ollama.rs:128`,
  `openai.rs:154`, `anthropic.rs:170`, `gemini.rs:181` all pass the full array too.
- Today's log shows 4 clean streams, no errors, all replies persisted.

**No code defect is provable from the current data.** The live suspects are the model
itself (`thinkingmachines/inkling` on NVIDIA NIM — a reasoning model), or a request
shape only visible on the wire. There is also a real, separate gap: **nothing in the
app shows what was actually sent**, so this class of bug is currently undebuggable.

Phase 1 therefore diagnoses before it fixes, then closes the memory gaps that exist
regardless of the diagnosis.

---

## Phase 1 — Chat memory

### 1.1 Make the outgoing request observable *(do this first)*

Without this, any "fix" is a guess.

- `src-tauri/src/commands.rs`, in `prepare_chat` after `plan_context` returns: a
  `tracing::debug!` recording `conversation_id`, message count, `dropped_count`,
  `used_tokens`/`budget_tokens`, and the per-message `role` + `content.len()` sequence.
  Roles and lengths only — never message bodies at `debug`.
- A `trace`-level line carrying the serialized body, so full-fidelity capture is opt-in
  via `RUST_LOG=chat_studio=trace` and never on by default.
- Settings → Diagnostics already renders backend state (`get_diagnostics`); add a
  **"Last request"** panel fed by a new `get_last_request` command reading a
  `Mutex<Option<RequestSnapshot>>` on `AppState` (`state.rs` — follow the existing
  `model_cache` field pattern, including the poison-recovering accessor).

**Verify:** send 3 turns in one conversation, then confirm the log shows the message
count growing 1 → 3 → 5 and that Diagnostics → Last request lists every prior turn.
This alone settles whether the backend or the model is at fault.

### 1.2 Act on what 1.1 shows

Two outcomes, both pre-designed:

**(a) The request is correct → the model is ignoring history.**
Then the fix is provider-side, not memory-side: reasoning models on NIM often need the
assistant's prior `reasoning` omitted (already done, `commands.rs:467`) *and* strict
user/assistant alternation. Add an alternation check to `context::normalize_turns` —
today it only strips a leading non-user turn; extend it to merge consecutive same-role
turns, which is what conversation 9's duplicated 3675-char user rows would produce
after a retry. Cover with a unit test beside the existing `normalize_turns` tests.

**(b) The request is short/truncated → a real backend bug.**
Fix at the identified site with a regression test in `context.rs` or `db.rs`.

### 1.3 Never drop history silently

`plan_context` computes `dropped_count` and `get_context_usage` returns it, but nothing
makes it visible when it matters — a long agent/skill system prompt can eat the whole
budget and collapse history to the newest turn with no signal. Note that
`settings.toml` already carries skills with system prompts up to **68k chars**
(`global-graphify`), which alone would consume 80% of the char budget if applied to a
conversation.

- `ui/src/components/Composer.tsx` already polls `get_context_usage`; render an
  explicit warning when `dropped_count > 0` ("N earlier messages won't be sent"),
  not just a meter.
- Return `system_tokens` from `get_context_usage` so an oversized system prompt is
  attributable rather than looking like history bloat.

**Verify:** apply the `global-graphify` skill to a conversation, confirm the warning
appears and names the system prompt as the cause.

### 1.4 Rolling summary memory

Today, exceeding the budget means old turns simply vanish. Cherry Studio-grade memory
means they get compressed instead.

- `db.rs`: `SCHEMA_VERSION` → 6, add `summary TEXT` and `summarized_through_id INTEGER`
  to `conversations`. Guard the `ALTER TABLE`s with the `pragma_table_info` check
  already used at `db.rs:117` / `:134`, and add a seeded-old-DB migration test mirroring
  the existing v4 test.
- `context.rs`: when `plan_context` would drop rows, inject the stored `summary` as a
  system-role turn immediately after the system prompt instead of losing them outright.
- `commands.rs`: after a stream finishes, if `dropped_count > 0`, spawn a background
  summarization call against the conversation's own provider covering messages up to
  the newest dropped id, then persist `summary` + `summarized_through_id`. Failure is
  non-fatal and logged — it degrades to today's behavior.
- Off by default behind a `memory_enabled` field in `Settings` (`config.rs`, with
  `#[serde(default)]` like the other added fields) so it cannot regress existing chats.

**Verify:** set `context_tokens` low (e.g. 6000), run a 20-turn chat, confirm a summary
row is written, that it appears in the next request (visible via 1.1), and that the
model can answer a question about turn 2 after turn 20.

---

## Later phases

Sequenced by dependency; detail them when reached.

### Phase 2 — Native tool-calling loop *(the keystone)*
`ChatRequest` carries only `model`/`messages`/`reasoning_effort`, and MCP tools are
exposed to the UI (`list_mcp_tools`, `call_mcp_tool`) but never handed to a model. Add
`tools` to `ChatRequest`, `ProviderEvent::ToolCall`, per-dialect serialization
(OpenAI `tool_calls`, Anthropic `tool_use`, Gemini `functionCall`), and a bounded
agentic loop in `commands.rs` that executes MCP tools and persists each step. A
`tool_calls` column on `messages` lets loops replay from history. `ToolCallCard.tsx`
already exists as the render target. Agents, skills, web search, and RAG retrieval all
depend on this — build it before Phases 4 and 5.

### Phase 3 — Attachments & multimodal
Turn `ChatMessage.content` from `String` into a content-part list; keep the DB `content`
column as text for search and add an `attachments` JSON column. Blobs on disk under the
existing `config_dir()` resolution — never base64 in SQLite. Per-dialect encoding plus a
vision capability flag on `ProviderConfig` so non-vision models fail clearly instead of
returning a provider 400. Needs `tauri-plugin-fs`.

### Phase 4 — Knowledge base / RAG (`sqlite-vec`)
Vectors in the existing rusqlite DB — one file, one backup story. **Resolve first:**
confirm `sqlite-vec` registers against the *bundled* SQLite on Windows; fallback is a
brute-force cosine scan over a `BLOB` column, fine for a few thousand chunks. New
`documents` / `chunks` / `vec_chunks` tables; ingest off the UI thread with progress on
the existing event channel. Expose retrieval as a **tool** through Phase 2 rather than
silently prepending context, so citations are visible. Embedding source deferred.

### Phase 5 — Web search
Nearly free once Phase 2 exists: a `web_search` tool (Tavily/Exa/Brave, key in
`settings.toml` beside provider keys) plus a fetch-and-extract tool.

### Phase 6 — Breadth & platform
- **Global search** — FTS5 external-content table over `messages` with sync triggers
  (bundled rusqlite compiles with `SQLITE_ENABLE_FTS5`; verify before relying on it).
- **Export** — `to_markdown` / `to_json`, save dialog via `tauri-plugin-dialog`.
- **Fork conversation** — copy messages up to an id into a new conversation; keeps the
  linear model and every existing query intact, no message-tree schema.
- **Multi-model replies** — a `reply_group` column plus per-`stream_id` keying in
  `ui/src/store/chat.ts` (currently a single in-flight slot; the `useSyncExternalStore`
  loop noted in the README is the hazard).
- **Platform** — i18n (retrofits badly, do it early if wanted), tray + global shortcut +
  quick-assistant window, WebDAV/S3 backup, translate/paint routes, mini-apps.

---

## Conventions

- Migrations: bump `SCHEMA_VERSION`, add a `version < N` block, guard every
  `ALTER TABLE` with `pragma_table_info`, add a seeded-old-DB migration test.
- New commands live in `commands.rs` and get a matching `ipc.ts` wrapper plus a
  `types.ts` mirror — the 1:1 mapping is load-bearing.
- New Tauri plugins need both a `main.rs` registration and a
  `capabilities/default.json` permission entry.
- `make check` (fmt-check + clippy -D warnings + tsc + oxlint + cargo test) before every
  commit; `git commit -S --signoff` with a specific kebab-case scope, e.g.
  `fix(context):`, `feat(memory):`, `feat(tool-loop):`.

## Phase 1 verification

1. `make check` clean.
2. `make dev` against the existing `chats.db` — migrates 5 → 6 in place, all 9
   conversations intact, no new startup warning in Settings → Diagnostics.
3. The reported symptom is reproduced *with evidence* from 1.1 before any fix lands,
   and demonstrably gone after.
