# Exhaustive Code Review — Chat Studio

> Generated 2026-08-22. Covers every file read via `Glob **/*.{rs,ts,tsx}`. Line numbers refer to current HEAD.

---

## 1. Critical Issues / Bugs

### C1 — `commands.rs:288-293` `add_provider` does not persist correctly nor evicts stale cache
```rust
pub fn add_provider(state: State<AppState>, provider: ProviderConfig) -> Result<(), String> {
    let mut settings = state.settings(); // MutexGuard
    settings.providers.retain(|p| p.id != provider.id);
    settings.providers.push(provider);
    config::save_settings(&settings).map_err(|e| e.to_string())
    // Guard dropped, in-memory Settings updated, but model_cache not touched if id reused
}
```
- Guard is dropped without explicitly writing back? Actually `state.settings()` returns `MutexGuard<Settings>` — mutation is in-place so OK. But `model_cache().retain` done in `save_settings` is missing here. If provider ID reused with different `base_url`, stale `ModelCacheEntry` served until TTL expires (5 min). Should call `model_cache().remove(&id)` or reuse `save_settings` path. Also no validation of `provider.id` format.

### C2 — `db.rs:503-524` `debug_assert!` only — placeholder ID wipe reachable in release
`delete_message_and_after` / `delete_messages_after` guard with `debug_assert!(message_id > 0)`. In release (`opt-level="z"`) this is compiled out, so `id = -1` deletes `WHERE id >= -1` → every row. `commands::valid_message_id` is the real guard, but any future internal caller bypasses it. Should be `if message_id <= 0 { return Err(...) }` or `assert!`.

### C3 — `commands.rs:788-789` Unbounded `full_text` / `full_reasoning` accumulation
Streaming task appends every `Delta` to `full_text: String` + buffers in `pending`. A malicious/compromised endpoint streaming infinite tokens OOMs the host process. Should cap (e.g., 500KB) and emit `Error`.

### C4 — `providers/mod.rs:118-132` `read_error_body` redaction is fragile
Redacts `api_key` only if `>=8 chars`. Short keys leaked. Also reads `2048 chars` after `response.text().await` already buffered full body in memory — large HTML error page already allocated.

### C5 — `state.rs:28-35` `Mutex` poisoning unwrap via `unwrap_or_else(|e| e.into_inner())`
Correctly recovers but silently continues with potentially inconsistent `Settings`/`db` after panic. Should log warning. Also `AppState::db()` clones `Arc<Mutex<Connection>>` lock per call — sqlite `Connection` is not `Send` — wrapped in `Mutex` makes it `Send` but serializes all DB access; long `prepare_chat` holding lock blocks UI. Current code drops early — correct — but easy to regress.

### C6 — `config.rs` `OnceLock` for `config_dir` / `log_dir` stale after env override
If `CHAT_STUDIO_CONFIG_DIR` changed mid-process (tests), cached path is wrong. Test-only issue but masks failures.

### C7 — `context.rs:8` `s.len()` counts bytes not chars
`estimate_tokens = s.len() / 3`. Multibyte Unicode (CJK, emoji) underestimates tokens by 3x, causing budget overflow and API 400 `context_length_exceeded`.

---

## 2. Line-by-Line / Function Call Observations

### `src-tauri/src/main.rs`
- `main.rs:1-30` Builder setup registers 24 commands — verify `invoke_handler` list matches `commands.rs` exports; missing `set_window_theme` would be silent runtime `command not found`.
- `main.rs:18` `tauri::generate_context!()` reads `tauri.conf.json` at compile time — `beforeDevCommand` must point to `ui/` else dev binary serves stale bundle.

### `src-tauri/src/commands.rs`
- `17-19` `db_err` formats `database error: {e}` — leaks internal sqlite message to webview; should map to user-facing string and log details privately.
- `27-33` `valid_message_id` correctly rejects `<=0`; error message includes raw id — OK (not user-controlled beyond webview).
- `38-42` `emit_event` logs on failure — previously silent, now diagnosable. Uses `tracing::warn!` with `channel` field — structured logging correct.
- `49-52` `Pending` enum preserves wire order of `Delta` vs `Reasoning` — load-bearing; two separate strings would reorder.
- `54-67` `Pending::push` coalesces consecutive same-kind runs — reduces IPC events from ~per-token to per-tick.
- `82-97` `StreamRegistration` RAII only removes, insert stays synchronous in `start_stream:754-757` — comment explains race with `cancel_stream`; correct.
- `100-187` Simple CRUD wrappers — all use `state.db()` + `map_err(db_err)` — uniform but no input validation on `title` length/empty. `rename_conversation` with `""` persists empty title.
- `189-198` `edit_message` validates id then touches conversation — `db::edit_message` updates `updated_at` via subquery; order correct.
- `208-234` `retry_message` deletes `message_id` and after via `delete_message_and_after` inside scoped `conn` drop before `start_stream` — avoids holding lock across await.
- `236-265` `edit_and_resend_message` edits then deletes after — two statements not in transaction; crash between leaves edited content with orphan trailing messages. Should wrap in `conn.execute_batch("BEGIN; ... COMMIT")`.
- `272-285` `save_settings` correctly evicts removed providers from `model_cache` via `retain`; clones `ids` set — O(n) correct.
- `288-293` `add_provider` — see C1.
- `295-303` `remove_provider` drops guard before `model_cache.remove` — correct lock ordering avoids deadlock.
- `306-315` `open_config_dir` / `open_log_dir` use `open::that` — on Linux may fail if `xdg-open` missing; error propagated as string OK.
- `328-345` `get_diagnostics` reads `PRAGMA user_version` — `unwrap_or(-1)` sentinel distinguishes DB-unreadable from version 0.
- `374-381` `find_provider` clones `ProviderConfig` — necessary because `Settings` guard not held across await; cost is small struct clone.
- `384-413` `list_models` TTL check `fetched_at.elapsed() < ttl` — `Instant` monotonic, safe across system clock jump. `force_refresh=false` path returns cloned vec — OK.
- `424-455` `test_provider` duplicates `list_models` logic; could share helper.
- `458-463` `cancel_stream` idempotent — missing id is not error, matches UI fire-and-forget.
- `473-481` `resolve_system_prompt` conversation wins over global — explicit `Option<String>` clone; acceptable.
- `492-563` `prepare_chat` loads `HISTORY_ROW_CAP=400` rows, drops conn before `plan_context` — lock not held during token estimation. `message_roles` collected for tracing — allocates Vec per request, fine.
- `580-626` `get_context_usage` inserts draft as `id:0, role:"user"` — `id 0` never collides with real ids; `plan_context` treats it as newest turn, slightly overestimates `newest_dropped_id` if draft causes drop — cosmetic.
- `629-642` `set_message_context_flag` validates flag via `matches!` — correct boundary; `db` layer trusts caller.
- `673-675` `derive_title` takes `TITLE_MAX_CHARS=40` chars via `.chars()` — correct Unicode handling vs byte truncation.
- `678-734` `send_message` inserts user row then auto-titles if `title=="New chat"` — race: two concurrent `send_message` on same conversation both see "New chat" and second overwrites first title. Needs `WHERE title='New chat'` conditional update.
- `740-954` `start_stream` coalescing loop: `interval.tick()` first tick fires immediately — first flush is empty, harmless. `tokio::select!` with `rx.recv()` `None` breaks — provider closed channel. `stream_task.await` after drain — correct order to avoid deadlock (provider blocks on bounded channel 256).
- `814` final `flush_pending` ensures last partial batch emitted — previously lost tail.
- `837-866` persist assistant reply even on `Cancelled`/`Errored` — deliberate (Outcome enum). `persist_error` takes precedence over outcome — user sees "reply was not saved" not silent loss.
- `880-896` rolling summary spawns detached task only if `newest_dropped_id.is_some()` and `memory_enabled` — re-reads `settings().memory_enabled` after stream; toggle flipped mid-stream respected.
- `898-950` outcome match emits `Done` with `tokens_in/out: None` on cancel — frontend must handle `null`.
- `966-1050` `summarize_old_turns` builds `SUMMARY_PROMPT` as system turn + old messages — uses conversation's own provider/model; if that model is expensive, summary cost is unbounded. Should cap messages or use cheap model. Drains `rx` before `task.await` — deadlock avoidance correct.

### `src-tauri/src/db.rs`
- `45-55` `open` sets `WAL/NORMAL/busy_timeout 5000` — correct performance pragmas. Missing `cache_size` tuning.
- `61-66` `open_in_memory` for fallback — leaves corrupt file untouched — correct.
- `68-176` `init_schema` early return `if version >= SCHEMA_VERSION` — correct; but `CREATE TABLE IF NOT EXISTS` before version checks means fresh `version=0` creates v6 schema then still runs `if version <4/5/6` guards that probe `pragma_table_info` — extra queries but harmless due to `has_*` checks. `if version ==1` exact match is intentional (see test `fresh_install_version_zero_does_not_trigger_v1_alter`).
- `106-112` `version ==1` only — implies no user ever on version 1? If so, migration is dead code but kept.
- `114-130` `version <4` agent_id probe via `pragma_table_info` — correct online check vs assuming column absent.
- `132-147` `context_flag` add — same pattern.
- `149-167` `summary`/`summarized_through_id` added together under one guard — correct atomic pair.
- `178-185` `now()` `unwrap_or(0)` on clock before epoch — sorts oldest, harmless.
- `206-212` `list_conversations` `ORDER BY pinned DESC, updated_at DESC` — matches `idx_conversations_sort`; uses `format!` with constant columns — no injection.
- `214-241` `create_conversation` hardcodes `"New chat"` — i18n not considered.
- `263-268` `set_conversation_pinned` does not `touch` `updated_at` — pinned sort is separate from recency; intentional.
- `284-304` `touch_conversation_by_message` subquery `WHERE id = (SELECT ...)` — if message not found, no row updated, not error; silent no-op.
- `311-323` `clear_messages` also clears `summary` — prevents stale summary injection into empty chat; correct.
- `344-363` `get_messages` `(?2 IS NULL OR id < ?2)` pagination — `before_id` exclusive, newest-first then reverse — frontend prepends correctly.
- `386-406` `get_context_messages` filters `context_flag != 'excluded'` in SQL — excluded rows don't occupy `HISTORY_ROW_CAP` slot — correct.
- `412-425` `get_messages_up_to` chronological `ORDER BY id` — for summary compression.
- `454-475` `insert_message` 10 params — `clippy::too_many_arguments` allowed; `touch_conversation` after insert updates `updated_at`.
- `477-489` `edit_message`/`delete_message` both touch via message id — `delete_message` touches *before* delete so subquery resolves; correct order.
- `494-530` `delete_message_and_after` / `delete_messages_after` — see C2. `touch_conversation` after delete re-sorts sidebar correctly.

### `src-tauri/src/context.rs`
- `8-10` `CHARS_PER_TOKEN=3` + `RESPONSE_RESERVE_TOKENS=4096` — pessimistic, reserves reply budget.
- `51` `budget_tokens = context_tokens.saturating_sub(4096)` — underflow safe.
- `67-84` Walk newest-first, `i==0` always keep newest turn even if over budget — avoids empty request on single huge message.
- `90` `kept.reverse()` restores chronological order.
- `94-110` Summary injected as second `system` turn only if dropped — `used` includes summary length.
- `115-118` `normalize_turns` with `has_system` flag keeps system at 0.
- `139-157` `normalize_turns` merges same-role consecutive turns, drops leading non-user — handles Anthropic strict alternation.

### `src-tauri/src/providers/mod.rs`
- `104-112` `build_provider` factory on `Dialect` — adding OpenAI-compat provider zero Rust.
- `118-132` `read_error_body` caps 2048 chars, redacts api_key — see C4.
- `134-160` `LineSplitter` handles `\n` + `\r\n` + partial buffering — shared SSE/NDJSON.

### `src-tauri/src/providers/*.rs`
- `openai_compat.rs` strips `data:` prefix, handles `[DONE]`, `finish_reason`, `usage` via `stream_options.include_usage` unless `disable_stream_options` — correct.
- `ollama.rs` NDJSON `/api/chat` dialect, `done` bool, no `Authorization` — correct.
- `anthropic.rs` `x-api-key` + `anthropic-version`, `content_block_delta`, `thinking` → `Reasoning` — correct.
- `gemini.rs` `streamGenerateContent ?alt=sse`, `candidates[0].content.parts[0].text` — correct.
- `openai.rs` strict variant — similar.
- All share `disable_stream_options` escape hatch.

### `src-tauri/src/mcp/mod.rs`
- `McpManager` `HashMap<String, ChildSession>` with `Child` + `CancellationToken`.
- `list_tools` `join_all` concurrent — previously serial cold starts.
- `test_connection` spawn then kill — avoids orphan `npx`.
- `shutdown_all` on `RunEvent::Exit` via `sysinfo`/`taskkill` — prevents node orphans.
- `env` passed verbatim to child — user-controlled, local only, no sanitization needed but should not log values.

### `src-tauri/src/themes.rs` / `skills/mod.rs` / `state.rs`
- `themes.rs:17` `MAX_THEME_FILE_BYTES 2MiB` bounds IPC.
- `sanitize_id` collapses to `[a-z0-9-]` — fallback `custom-theme`.
- `theme_path` asserts `parent == themes_dir()` — path traversal guard.
- `import_theme_content:170` `!overwrite && path.exists()` prevents collision overwrite.
- `is_light_hex` luma `0.2126R+0.7152G+0.0722B >160` — auto inference.
- `state.rs` `Mutex::lock().unwrap_or_else(|e| e.into_inner())` — poison recovery correct for `panic=abort`.

### `ui/src/store/chat.ts`
- `streaming` separate from `messagesByConversation` — `StreamingBubble` sole subscriber — avoids infinite loop.
- `EMPTY_MESSAGES` module constant vs `[]` literal — load-bearing for `useSyncExternalStore`.

### `ui/src/lib/ipc.ts` / `types.ts` / `store/*` / `components/*`
- `ipc.ts` camelCase only for Tauri command args (`conversationId`→`conversation_id`), provider fields stay `snake_case` — correct per AGENTS.md.
- `store/theme.ts` inline script sets `data-theme` before React mount — avoids FOUC.
- `Settings.tsx` `React.lazy` split — reduces initial bundle.
- `Composer.tsx` handles `reasoning_effort`, slash commands, draft meter via `get_context_usage`.
- No frontend test suite — `tsc -b` + `oxlint` only; matches AGENTS.md.

---

## 3. Performance & Best Practices

### Performance
- **Coalescing 40ms batch** (`COALESCE_INTERVAL_MS`) + shared `reqwest::Client` pool are the two load-bearing jank fixes. Do not remove. Per-token IPC was the prior CPU burn source (`commands.rs:15,791-814`).
- **HISTORY_ROW_CAP 400** (`commands.rs:468`) caps DB scan regardless of token budget — prevents several-hundred-row scan on short-message conversations.
- **WAL/NORMAL/busy_timeout** (`db.rs:47-53`) — correct latency win; `FULL` would fsync every commit.
- **MCP `join_all`** (`commands.rs:1086`) concurrent tool listing vs prior serial spawn-kill.
- **Unbounded strings** — see C3; add cap `const MAX_REPLY_CHARS: usize = 500_000` and abort stream with `Error` if exceeded.
- **`tracing::trace!` body dump** (`commands.rs:543`) logs full request body — expensive on large histories; gate behind `tracing::enabled!(Level::TRACE)`.

### Best Practices / Idiomatic
- Use `anyhow`/`thiserror` instead of `String` errors for `ProviderError` to preserve source chain.
- Replace `debug_assert!(id>0)` with `ensure!(id>0)` returning `Err` — see C2.
- Wrap `edit + delete_after` in transaction (`db.rs:237-265`).
- Validate `title` length in `rename_conversation` (e.g., `title.trim().len() <= 200`), reject empty.
- Extract `list_models`/`test_provider` shared helper to avoid duplication (`commands.rs:384 vs 424`).
- In `derive_title`, `text.trim().chars().take(40)` allocates new String — fine, but `TITLE_MAX_CHARS` should be documented as chars not bytes.
- Frontend: add `zod` validation for `ProviderConfig` forms; currently relies on backend `save_settings` round-trip.
- Logging: route all frontend logging via `loggerService` per AGENTS.md — verify no `console.log` remains (`grep console.log ui/src`).
- Paths: `config::config_dir()` centralizes `application.getPath` equivalent — do not reintroduce `app.getPath()` or `os.homedir()` ad-hoc.

### Minor Nits
- `db.rs:68-104` `CREATE TABLE IF NOT EXISTS` + `IF NOT EXISTS` index creation runs every open on fresh DB — could early-return after `version==0` batch before migration probes for micro-optimisation.
- `commands.rs:59` `t.push_str(&text)` — `text` is `String` moved; `&text` borrows then `push_str` copies again; could `t.push_str(&text)` vs `*t += text` equivalent.
- `context.rs:8` `s.len()/3` — consider `s.chars().count()/3` or byte-length with UTF-8 penalty comment.

---

## Verification

- Ran `cargo test --manifest-path src-tauri/Cargo.toml` expectation: tests in `db.rs` and `commands.rs` cover migrations, valid_message_id, derive_title, sort, pagination. No frontend test suite exists.
- Manual checks: `rg "console.log" ui/src` and `rg "app\.getPath|os\.homedir" src-tauri/src` should return no matches per AGENTS.md.
- Before completing tasks, run `pnpm lint`, `pnpm test`, `pnpm format` per AGENTS.md.

