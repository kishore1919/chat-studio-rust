
─── ui/src/index.css:75-76 ───
Accessibility / contrast issue: in light mode primary CTAs use solid `--accent` (#3fd55a, a bright
green) with `--primary-foreground` set to `#ffffff`. White-on-#3fd55a yields a contrast ratio below
2:1, which fails WCAG AA for both normal and large text. Dark mode correctly uses dark text
(#171717), so light mode is inconsistent and likely hard to read. Consider using a darker foreground
on this green in light mode, or adjust the accent green to a darker shade.



─── ui/src/index.css:339-347 ───
These `!important` declarations on `background` and `padding` prevent user-injected custom VS Code
themes from overriding those properties on `.hljs` / `pre code.hljs`, even though the preceding
comment claims that "A custom VS Code theme's own `.hljs-*` rules (injected into #app-theme-tokens,
later in DOM order) still win over these where it defines a given scope." This contradicts the
documented behavior and hard-codes a transparent background and zero padding, breaking custom themes
that rely on those properties. Remove `!important` here if custom overrides are intended, or update
the comment to accurately describe the limitation.



─── ui/src/index.css:8-12 ───
`overflow-x: hidden` intentionally suppresses horizontal scrollbars, but it also clips any child
content that naturally overflows horizontally (wide code blocks, tables, long URLs, etc.) instead of
allowing it to scroll. This is a potential UX/accessibility issue if content can legitimately exceed
the container width. Verify this is intentional; if horizontal overflow should remain accessible,
use `overflow-x: auto` and handle layout shift separately, or ensure children wrap/scroll
internally.



─── ui/index.html:7-21 ───
**Severity: Medium-High (correctness / UX)**

The synchronous theme resolver intentionally runs before first paint to prevent a flash of the wrong
theme, but it does not guard against exceptions. Accessing `localStorage` can throw a
`SecurityError` when storage is disabled (e.g., Safari private mode with third-party cookies
blocked, sandboxed iframes, or enterprise policies), and `matchMedia` calls can also throw in
restricted environments. If any of these throw, the entire IIFE aborts and
`document.documentElement.dataset.theme` is never set, which defeats the anti-flash purpose and
leaves the document un-themed.

**Suggestion:** Wrap the `localStorage` and `matchMedia` reads in a `try/catch` block and fall back
to a safe default (e.g. `'light'` or `'dark'` based on `prefers-color-scheme` if available) so
`dataset.theme` is always assigned before paint.

```js
var resolved = 'light'
try {
  var id = localStorage.getItem('chat-studio-theme-id') || localStorage.getItem('chat-studio-theme')
|| 'system'
  // ... existing resolution logic ...
} catch (e) {
  try { resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' }
catch (_) {}
}
document.documentElement.dataset.theme = resolved
```



─── ui/index.html:3-8 ───
**Severity: Medium (security)**

The page contains an inline script and loads a module script (`/src/main.tsx`) but has no
`Content-Security-Policy` meta tag (or equivalent HTTP header). Because this application will render
user-generated chat content, the absence of a CSP removes an important XSS mitigation layer: a
compromised chat message or renderer could more easily introduce inline scripts or other unexpected
resource loads.

**Suggestion:** Add a CSP meta tag early in `<head>` and restrict scripts to `'self'`. Because this
file uses an inline script, the inline block must be authorized with a SHA-256 hash or a nonce. For
example:

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'
'sha256-...'; style-src 'self' 'unsafe-inline'; connect-src 'self';">
```

The exact hash must be computed from the inline script content and updated whenever it changes. If
the build pipeline supports it, prefer a nonce or generate the CSP header server-side to avoid hash
maintenance.



─── ui/index.html:23-26 ───
**Severity: Low (UX / accessibility)**

The application requires JavaScript to render anything, but there is no `<noscript>` fallback. Users
with JavaScript disabled or with a blocked/errored main script will see only an empty `<div
id="root"></div>` with no indication that the app failed to load.

**Suggestion:** Add a `<noscript>` block inside `<body>` with a concise message, e.g.:

```html
<noscript>
  <p>Chat Studio requires JavaScript to run. Please enable JavaScript in your browser settings.</p>
</noscript>
```



─── ui/package.json:25-25 ───
lucide-react has not published a 1.x major release; released versions are in the 0.x range (e.g.,
^0.475.0). This version specifier will fail to resolve during install, blocking the build. Pin a
valid lucide-react version.



─── ui/package.json:48-48 ───
TypeScript ~6.0.2 does not correspond to a known released stable line at the time of this review.
Since the "build" script depends on tsc, an invalid/unknown version will cause the build to fail.
Verify the version exists in the registry or switch to a known stable release.



─── ui/package.json:45-45 ───
Declaring a direct esbuild dependency while Vite is also present can lead to native binary or
transform mismatches if the versions drift. Vite 8.2.0 bundles and manages its own esbuild version.
Remove this explicit esbuild devDependency unless a specific override is required, and keep it in
sync with Vite's bundled esbuild if retained.



─── src-tauri/src/db.rs:68-88 ───
Multiple db.rs operations perform two or more autocommit statements that must succeed or fail
together: schema migrations in init_schema, clear_messages (DELETE then UPDATE), insert_message
(INSERT then touch_conversation), edit_message (UPDATE then touch), and delete_message (touch then
DELETE). A failure between steps can leave partial schema upgrades, duplicate messages, stale
summaries, or unsorted conversations. Wrap each sequence in a rusqlite transaction so the database
remains consistent.



─── src-tauri/src/db.rs:494-530 ───
`debug_assert!` is stripped in release builds, so the guard against non-positive `message_id` is not
enforced for end users. A placeholder or malicious id (`<= 0`) makes the `id >= ?` / `id > ?`
predicate match every real rowid, turning a retry into a full conversation wipe or deleting all but
one message. The comment says this only catches future callers that bypass IPC validation, but in
release builds it catches nothing. Replace with a runtime check that returns an error (or at least
`assert!`) so the guard survives release builds.



─── src-tauri/src/db.rs:443-451 ───
The function writes the supplied `flag` string directly to the database without enforcing the
documented `"normal" | "pinned" | "excluded"` domain, and the flag update and conversation touch are
separate autocommit statements. Relying solely on the IPC caller for validation is fragile; any
direct caller (or future IPC bug) can persist invalid values that break `get_context_messages`,
which filters on `'excluded'` and checks `flag == 'pinned'`. Additionally, if the touch fails after
the update, the flag change is persisted but the conversation is not re-sorted. Add a domain check
that returns an error for invalid values and wrap both statements in a transaction.



─── src-tauri/src/context.rs:12-14 ───
`estimate_tokens` uses byte length (`s.len()`) while the constant is named `CHARS_PER_TOKEN`, so the
heuristic is inconsistent for non-ASCII text (e.g., a CJK character is ~3 bytes but often only one
token). This causes `used_tokens`/`system_tokens` to over-count and the budget loop to treat
multi-byte content as more expensive than it should be. Additionally, callers pass a throwaway
string (`"a".repeat(used)`) just to measure its length here; the function should either count
characters (`s.chars().count()`) or take a length directly to avoid the large allocation and the
semantic mismatch.



─── src-tauri/src/context.rs:51-85 ───
The budget arithmetic uses `String::len()` (bytes) for `system_cost`, `pinned_cost`, and each row's
`cost`, but compares them against `budget_chars = budget_tokens * CHARS_PER_TOKEN`. This mixes bytes
with a character-derived ceiling, making truncation behavior inconsistent for non-ASCII history.
More importantly, the "always keep the most recent turn" guard is tied to raw index `i == 0`; if the
newest row happens to be pinned, the newest unpinned turn is still subject to the budget and can be
dropped, potentially leaving the request without the latest user question. Because pinned rows and
the always-kept newest turn are charged from the same pool, a `context_tokens` value below
`RESPONSE_RESERVE_TOKENS` (or otherwise tiny) can consume the model's reply reserve, so the stated
reservation is not actually guaranteed.



─── src-tauri/src/context.rs:94-110 ───
When rows were dropped, the summary is injected unconditionally without checking whether it still
fits inside the remaining budget or the response reserve. A long rolling summary can therefore push
the assembled context well past `budget_tokens` and eat into the `RESPONSE_RESERVE_TOKENS` that was
supposed to be reserved for the model's reply. If the summary is meant to replace dropped turns, its
cost should at least be considered in the same budget envelope.



─── src-tauri/src/context.rs:120-127 ───
`used_tokens` and `system_tokens` are computed from pre-normalization byte totals (`used` and
`system_chars`) before `normalize_turns` may drop leading non-user turns and insert `\n` separators
during same-role merges. The returned plan therefore reports token counts that can diverge from the
actual serialized request: a leading assistant turn removed by `normalize_turns` is still charged,
and merged turns gain a newline that is not accounted for. The `estimate_tokens(&"a".repeat(used))`
call also allocates a temporary string as large as the assembled context, which is wasteful for long
histories. Consider computing the counts from the final `messages` content.



─── src-tauri/src/main.rs:210-216 ───
Synchronous `block_on` for MCP shutdown runs on the main thread with no timeout. If `shutdown_all()`
waits for a hung child process or a server that never responds, the Tauri event loop and the entire
process may fail to terminate. Wrap this in a `tokio::time::timeout` and fall back to force-killing
remaining children so the app always exits promptly.



─── src-tauri/src/state.rs:58-65 ───
All lock accessors return `std::sync::MutexGuard<'_>`. Tauri commands are async, so any command that
calls e.g. `state.db()` and then `.await`s before the guard drops will hold a synchronous mutex
across an await point. This blocks an async-runtime worker thread and can deadlock with other tasks.
The same applies to `settings`, `active_streams`, `model_cache`, and `last_request`. Prefer
`tokio::sync::Mutex` for state that is touched inside async commands, or redesign accessors to
extract/cloned data and drop the guard before any `.await`.



─── src-tauri/src/main.rs:143-144 ───
`.unwrap()` on a `Mutex` lock will panic if the mutex is poisoned (a previous holder panicked while
holding it). That turns a recoverable error into an application abort during startup. Recover the
guard instead, e.g. `state.settings.lock().unwrap_or_else(|e| e.into_inner())`, and treat the
contained data as the authoritative state.



─── src-tauri/src/main.rs:115-122 ───
If both on-disk and in-memory SQLite opens fail, the function simply returns after logging. In
release builds the console is hidden (`windows_subsystem = "windows"`), so the user sees only a
silent process exit with no actionable error. Consider surfacing a fatal error dialog or leaving a
persistent crash/notification marker so the failure is visible.



─── src-tauri/src/config.rs:274-283 ───
The `theme_id` migration is unreachable for typical old configs and uses a fragile suppression
heuristic.

- `Settings.theme_id` has `#[serde(default = "default_theme_id")]`, which defaults to `"system"`.
Therefore `settings.theme_id.is_empty()` is only true when a user explicitly sets `theme_id = ""` in
TOML; an old config that only has `theme = "dark"` will never reach `migrate_theme_id`.
- The `raw.contains("theme_id")` check treats any literal occurrence of the substring (including in
comments or unrelated values) as "already configured", so even an explicit `theme_id = ""` will not
be migrated from the `theme` preference.

Consider using `Option<String>` for `theme_id` so the serializer can distinguish "unset" from
"default/system", and replace the substring check with a proper parsed-field check.



─── src-tauri/src/config.rs:430-447 ───
`quarantine_settings_file` gives up if `std::fs::rename` fails and leaves the unreadable
`settings.toml` in place. Subsequent `load_settings` calls will keep hitting the same parse error
instead of falling back to defaults. When rename fails (permissions, locked file, etc.) the function
should at least attempt a copy-and-delete fallback or surface that the bad file could not be moved.



─── src-tauri/src/config.rs:487-503 ───
The save path writes directly to `settings.toml` and then adjusts permissions afterwards, which
creates two reliability/security gaps:

1. **Non-atomic write**: if the process crashes or is killed while `std::fs::write` is in progress,
`settings.toml` can be truncated or partially written, leaving the app unable to start.
2. **Permissions race**: on Unix the file is created with default permissions and only restricted to
`0o600` after the write completes, so credentials (`api_key` values) are briefly readable with the
default umask.

Write to a temporary file in the same directory, set `0o600` on the temp file, then atomically
rename it over `settings.toml`.



─── src-tauri/src/config.rs:466-468 ───
`load_settings` returns a `Parse` error directly when `toml::from_str` fails and never invokes
`quarantine_settings_file` in the same file. That means a malformed `settings.toml` will prevent
startup until something outside this module calls quarantine and reloads. If quarantine is intended
to be the recovery mechanism, `load_settings` should invoke it on parse failure and then load
defaults (or the caller should be documented to do so). As written, the quarantine helper and the
load path are not integrated.



─── src-tauri/src/providers/anthropic.rs:34-45 ───
User-supplied `extra_headers` are appended after the provider's security-critical headers.
`reqwest::RequestBuilder::header` replaces existing headers case-insensitively, so a malicious or
misconfigured extra header named `x-api-key`, `anthropic-version`, or `content-type` can silently
overwrite authentication, API version, or content negotiation. Apply extra headers first, then
overwrite with the mandatory provider headers, or validate/deny-list sensitive header names.



─── src-tauri/src/providers/anthropic.rs:155-166 ───
Both Anthropic and Gemini providers keep only the first system message; additional system messages
are silently dropped or remapped to the user role, altering conversation context and model behavior.
Reject multiple system messages, merge them into a single instruction, convert extras into supported
roles, or document and log the truncation.



─── src-tauri/src/providers/anthropic.rs:230-243 ───
`content_block_start` only emits reasoning for `block_type == "thinking"` and completely ignores
`text` content blocks. Anthropic's `content_block_start` event for `type: text` contains the first
text chunk of the response, so this handler silently drops that initial content. Add handling for
`text` blocks by emitting `ProviderEvent::Delta { text }` from `block.text`.



─── src-tauri/src/providers/anthropic.rs:116-123 ───
Provider stream finalization helpers (anthropic, gemini, openai, ollama, openai_compat) return
Ok(usage) as soon as any token has been emitted, so shape/parse errors, corrupted trailing
SSE/NDJSON chunks, and truncated streams are silently swallowed. Surface recorded stream-parsing
failures as ProviderError::Shape regardless of whether content was emitted, and track completion
sentinels (e.g. data: [DONE]) to detect premature disconnects.



─── src-tauri/src/providers/anthropic.rs:296-298 ───
Unknown SSE event types fall into this wildcard arm and are silently discarded. Anthropic can emit
`event: error` payloads containing failure details (e.g. rate limits, policy violations) mid-stream;
ignoring them hides runtime failures from the caller. Add explicit handling for `error` events and
convert them into a `ProviderError`.



─── src-tauri/src/providers/anthropic.rs:178-182 ───
Streaming chat requests for multiple providers (anthropic, gemini, openai, openai_compat) lack
explicit or idle timeouts; a stalled or half-open connection can hang the async task indefinitely.
Add a request-level or per-frame timeout so streams fail fast and release resources.



─── src-tauri/src/providers/anthropic.rs:212-214 ───
Each `data:` line is parsed as an independent JSON payload. Per the SSE specification, consecutive
`data:` lines for the same event should be concatenated with `\n` before interpretation. Although
Anthropic currently emits single-line JSON, this parser is not strictly SSE-compliant and would
break if a multi-line payload appeared. Accumulate `data:` lines until the terminating empty line,
then parse the combined payload.



─── src-tauri/src/mcp/mod.rs:546-553 ───
McpManager::get_or_spawn has a check-then-act race across the existence check, stale-entry removal,
spawn, and initialize steps. Concurrent calls for the same server_id can spawn multiple child
processes or HTTP sessions before the later insert overwrites the earlier one, leaking resources.
Hold a per-server tokio::sync::Mutex (or equivalent in-flight handle) across the entire
get-or-create sequence.



─── src-tauri/src/mcp/mod.rs:546-550 ───
The session cache is keyed only by `server_id`; it never compares the other parameters (`transport`,
`command`, `args`, `env`, `url`, `headers`). If the MCP server configuration is updated while
keeping the same id, the stale session is silently reused. This is especially bad for HTTP, where
`is_alive` unconditionally returns `true`, so a stale session is never evicted. Store a
configuration fingerprint with each session and compare it before reusing, or provide an explicit
invalidation API.



─── src-tauri/src/mcp/mod.rs:494-498 ───
`shutdown()` and `shutdown_all()` only kill `self.child`, which is always `None` for HTTP
transports. `spawn_http` launches two detached `tokio::spawn` tasks that reconnect forever with no
cancellation token or `select!`. Once an HTTP session is created, its background SSE reconnect and
event-reader tasks leak for the lifetime of the process. Add a `tokio_util::sync::CancellationToken`
(or `Notify`) owned by the session, check it in the reconnect loop, and drop the tasks on
`shutdown()`.



─── src-tauri/src/mcp/mod.rs:105-107 ───
`format_tool_result` builds output by repeatedly pushing `item.to_string()` (which re-allocates a
JSON representation) for non-text blocks. Worse, for null or non-object content items without
`text`, it concatenates JSON strings without separators, producing invalid/misleading output such as
`{"a":1}{"b":2}`. At minimum, separate blocks with a delimiter; better, model content as a typed
enum and serialize cleanly.



─── src-tauri/src/providers/mod.rs:124-126 ───
Security / DoS: `resp.text().await` loads the entire provider-controlled HTTP error body into memory
before any length cap is applied. A misconfigured gateway or malicious endpoint can return a
multi-gigabyte response and exhaust process memory before `MAX_ERROR_BODY` is ever consulted. Stream
the body with a bounded read (e.g., `resp.bytes_stream()` or a byte-limit helper) and stop reading
once the cap is reached.



─── src-tauri/src/providers/mod.rs:124-125 ───
Error handling: `resp.text().await.unwrap_or_default()` discards both the response bytes and the
underlying error when the body cannot be read or is not valid UTF-8. This turns real HTTP failures
into blank error messages, making diagnostics impossible. Propagate or at least preserve the
underlying error and/or fall back to lossy UTF-8 decoding of the available bytes.



─── src-tauri/src/providers/mod.rs:118-126 ───
Semantics/cap bug: `MAX_ERROR_BODY` is documented as a byte cap on how much of the body to keep, but
`body.chars().take(MAX_ERROR_BODY)` caps Unicode scalar values, not bytes. A body with multi-byte
characters can produce a String significantly larger than 2048 bytes, and later `.replace()`
allocates another copy. Cap by bytes (with UTF-8 boundary safety) to honor the documented limit.



─── src-tauri/src/providers/mod.rs:127-132 ───
Security: secret redaction is exact-substring only and skips keys shorter than 8 characters. Short
API keys, URL-encoded variants, Base64-encoded forms, case-differing representations, or values
embedded in patterns like `Authorization: Bearer <key>` may still leak in the returned string and
any logs derived from it. Consider normalizing/common encodings, case-insensitive matching, and
redacting short keys as well.



─── src-tauri/src/providers/mod.rs:139-148 ───
DoS / resource exhaustion: `LineSplitter.buffer` grows without bound while waiting for a newline. A
provider that sends a never-ending stream without `\n` can exhaust process memory. Add a maximum
line/frame length, return an error or truncate once the limit is exceeded, and document the
behavior.



─── src-tauri/src/mcp/mod.rs:125-126 ───
`pending` is a `Mutex<HashMap<i64, oneshot::Sender<Value>>>`, but `HashMap` is not ordered. If a
server sends multiple out-of-order responses that match no request id, they are silently dropped
with a debug log. That is acceptable, but there is no cleanup of stale pending entries on `is_alive`
checks or session death. If a response never arrives for an in-flight request, the `oneshot::Sender`
remains in the map forever, leaking memory; add periodic cleanup or remove entries when the session
is detected dead.



─── src-tauri/src/mcp/mod.rs:164-177 ───
`spawn_stdio` drops the `JoinHandle`s for its reader and stderr tasks. If the session is later
overwritten by another concurrent spawn (see race notes), the losing session's child process is
killed but the detached reader tasks keep running because they hold clones of `pending` and
stdout/stderr handles. Those tasks may then write to a defunct oneshot channel or log lines forever.
Keep `JoinHandle`s in the session, abort them in `shutdown()`, and avoid spawning readers with
shared `pending` that belongs to a different session instance.



─── src-tauri/src/mcp/mod.rs:248-252 ───
HTTP SSE reconnection loop uses `tokio::time::sleep(Duration::from_secs(1))` but has no backoff, no
maximum retry count, and no upper bound. If the remote server is down or unreachable, this loops
forever, creating a new TCP connection every second. On cancellation there is also no way to stop
the loop. Bound retries and implement a cancellation token.



─── src-tauri/src/mcp/mod.rs:378-380 ───
The `post_http` method stores `session_id` from `Mcp-Session-Id` but never invalidates or rotates
it. If the server resets (restarts) the session id, the client will reuse the stale id and the
server will reject requests. This is made worse by the HTTP `is_alive` always returning `true`, so a
server restart is never detected. Maintain a handshake or heartbeat and clear `session_id` on stream
reconnect/POST failure.



─── src-tauri/src/mcp/mod.rs:41-48 ───
`build_http_headers` and `create_command` take untrusted `command`, `args`, and `env` and forward
them to a subprocess or HTTP request. There is no allow-list or validation. A malicious config can
spawn arbitrary commands (`cmd /c ...`, `bash -c ...`) and leak secrets via env/headers. At minimum,
document that these come from trusted config; ideally validate `command` against a known safe path
and treat `env` values as potentially sensitive (don't log them).



─── src-tauri/src/mcp/mod.rs:667-673 ───
`shutdown_all` locks `self.sessions` then awaits each `session.shutdown()` while holding the lock.
`shutdown` is async and may block on `child.kill().await`. Any other task trying to use the manager
(including `get_or_spawn`) is blocked for that duration. Take a snapshot of sessions, drop the lock,
then shut them down.



─── src-tauri/src/providers/gemini.rs:222-228 ───
Bug: partial trailing line in `LineSplitter` is not flushed at end-of-stream. The loop `let
Some(chunk) = chunk else { break };` exits immediately when `bytes_stream()` returns `None`, leaving
any incomplete line still buffered in `splitter`. If the provider sends a final SSE event or
trailing usage chunk without a terminating newline, it will be silently dropped. The loop should
call `splitter.flush()` (or a terminal API) after the stream ends before returning/finalizing. Also,
the current `finalize()` only reports `shape_error` when `emitted` is false, so a parse error in the
trailing chunk is additionally hidden.



─── src-tauri/src/providers/gemini.rs:63-74 ───
Maintainability: `urlencoding_simple` does not encode spaces as `%20`, but more importantly it uses
`b as char` for a single byte, which is fine for ASCII bytes in this match arm, but the
implementation is an ad-hoc percent encoder. For correctness with UTF-8 multi-byte sequences it
encodes each byte separately (which is acceptable), yet using a small crate or
`form_urlencoded::byte_serialize`/`percent_encoding` would be clearer, better tested, and less
error-prone than maintaining this hand-rolled encoder.



─── src-tauri/src/skills/mod.rs:55-58 ───
The comment claims recursion is "one level", but the implementation calls `scan_skills_directory`
recursively without any depth tracking, so it will traverse as deeply as the filesystem allows.
Combined with `path.is_dir()` following symlinks, this creates a real infinite-loop/stack-overflow
risk if a circular symlink (e.g., a skill dir linked back into an ancestor) is present. Add a depth
limit and resolve/check symlink metadata (e.g., `fs::symlink_metadata` + `file_type().is_symlink()`)
before deciding whether to recurse.



─── src-tauri/src/skills/mod.rs:59-63 ───
When a standalone `.md` file is found directly inside a search directory, `parse_skill_file` is
called with the *directory* as `parent_dir` (`dir`), not the file path. Since `dir_name` is derived
from `parent_dir`, every standalone skill file in the same directory will receive the same `name`,
`slash_command`, and `id` (`global-<dir_name>`), causing collisions and only the last one kept by
downstream consumers. Pass `path.parent().unwrap_or(dir)` instead.



─── src-tauri/src/skills/mod.rs:83-86 ───
The frontmatter parser treats any `---` substring as the closing delimiter and also treats a leading
`---` anywhere as the opening delimiter, regardless of line boundaries. A markdown horizontal rule
inside the body, or inline triple dashes, will prematurely terminate frontmatter and truncate the
system prompt. Use line-oriented checks (e.g., split on `\n---\n` or use a proper YAML frontmatter
parser) so only a line consisting solely of `---` terminates the block.



─── src-tauri/src/skills/mod.rs:40-40 ───
Skill discovery silently discards fs::read_dir and fs::read_to_string failures for directories and
standalone .md files. Unreadable or permission-denied skill files disappear without diagnostics.
Propagate or at least log these failures.



─── src-tauri/src/skills/mod.rs:27-28 ───
The local skills path is a bare relative path resolved against the process current working
directory. In a Tauri application the CWD is often the app bundle, the system directory, or wherever
the launcher started the process, so discovery will be inconsistent. Resolve it against a
well-defined base (e.g., the project/workspace root configured by the app, or the Tauri app data
dir) instead of relying on CWD.



─── src-tauri/src/skills/mod.rs:20-25 ───
On Unix systems `dirs::config_dir()` is typically `~/.config`, so the `chat-studio/skills` directory
under `~/.config` is pushed twice (once via `home.join(".config")` and once via
`dirs::config_dir()`). Remove the redundant entry to avoid duplicate scanning and duplicated
results.



─── src-tauri/src/skills/mod.rs:95-95 ───
The quote-stripping logic uses `trim_matches` on both `"` and `'`, which removes *any* quote
character from *either* end independently, not matched pairs. A value such as `"foo'` will be
transformed into `foo`, silently corrupting the frontmatter value. Use paired quote handling, or
better yet a real YAML parser for the frontmatter block.



─── src-tauri/src/providers/openai.rs:160-164 ───
OpenAI and OpenAI-compatible providers silently drop invalid reasoning_effort values instead of
validating them. This causes unexpected provider-default reasoning behavior for typos or unsupported
casing. Reject unsupported values with a typed ProviderError, or normalize/validate the value
explicitly before serialization.



─── src-tauri/src/providers/openai.rs:197-212 ───
Provider streaming loops await tx.send(...) directly without polling the cancellation token. When
the consumer is slow or the channel is full, cancellation is delayed until the send completes. Wrap
each send future in tokio::select! with cancel.cancelled() so tasks respect cancellation promptly
and avoid leaking stuck sender tasks.



─── src-tauri/src/providers/ollama.rs:83-94 ───
An empty or completely off-schema response is indistinguishable from success. As the inline comment
already notes, both valid empty replies and unrecognized provider streams return
`Ok(Usage::default())` with no events. Callers cannot detect silent provider misbehavior (e.g.,
wrong endpoint, model that refuses structured output). Consider requiring at least one recognized
non-empty line or a `done` flag before treating an empty stream as success, so an off-schema
provider returns a `Shape` error instead of a silent empty success.



─── src-tauri/src/providers/ollama.rs:176-189 ───
A closed `mpsc` sender is unconditionally reported as `ProviderError::Cancelled`. If the coalescing
task panicked, `tx.send(...).await.is_err()` still returns `ProviderError::Cancelled`, masking a
real runtime failure. There is no separate variant for a dropped receiver, so logs and UI mislabel
crashes as user cancellations. Consider adding a `ProviderError` variant for a disconnected consumer
(or at least surfacing the distinction) so panics/broken pipelines are not misreported as
cancellation.



─── src-tauri/src/providers/ollama.rs:191-195 ───
Returning immediately on `parsed.done` discards additional NDJSON lines in the same `Bytes` chunk.
The loop `for line in splitter.push(&chunk)` is aborted by `return finalize(...)` as soon as a line
has `done: true`, even though the chunk may contain more complete lines (e.g., trailing usage data,
reasoning, or future protocol fields). Process all remaining lines in the chunk before finalizing,
and only return after the chunk is fully drained.



─── src-tauri/src/providers/openai_compat.rs:145-153 ───
BUG: `list_models` loads the entire `/models` response body into memory with `resp.json().await?`
without any size cap. A misbehaving or malicious endpoint can return a huge JSON payload and exhaust
memory within the 20-second timeout window. Consider streaming/capping the response bytes or
applying a maximum acceptable body size before deserialization.



─── src-tauri/src/themes.rs:79-86 ───
`list_themes` reads every `.json` file entirely into a `String` before checking size, so the
`MAX_THEME_FILE_BYTES` guard is bypassed here. A multi-hundred-MB dropped file can still exhaust
memory and stall the IPC. Apply the same size cap (e.g. `metadata().len()` or a bounded reader)
before loading the file.



─── src-tauri/src/themes.rs:170-176 ───
Check-then-act race: `path.exists()` and `fs::write()` are not atomic. Another process or thread can
create the file between the check and the write, silently clobbering an existing theme even when
`overwrite` is `false`. When `overwrite` is false, open with `create_new(true)` (or an equivalent
atomic create-new primitive) so the existence test and creation happen in one step.



─── src-tauri/src/themes.rs:116-122 ───
Several command boundaries convert structured `std::io::Error` and `serde_json::Error` values into
plain strings with `map_err(|e| e.to_string())`. This discards error kind/context (e.g. permission
denied vs. not found vs. parse failure) and makes it harder for the frontend to show actionable
diagnostics. Consider returning typed errors or at least preserving the source error in a structured
payload.



─── src-tauri/src/themes.rs:79-86 ───
`list_themes` silently skips files that fail to read or parse (`Err(_) => continue`). This hides
corrupted theme files, permission errors, and disk problems from both the user and any
diagnostics/logging. Consider returning a partial list plus warnings, or at least logging each
skipped file with its error.



─── src-tauri/src/themes.rs:116-122 ───
The metadata size check and `read_to_string` are not atomic: the file can grow between `metadata()`
and `read_to_string()`, allowing an unbounded read. Additionally, `read_to_string` follows symlinks,
so a symlink placed in `themes_dir()` can redirect this command to arbitrary files outside the
themes directory despite the `theme_path` parent check. Read through a bounded buffer and consider
`O_NOFOLLOW` on Unix.



─── src-tauri/src/themes.rs:97-107 ───
`list_themes` sanitizes the filename to produce an `id`, but
`get_theme_content`/`delete_custom_theme` expect the on-disk file to already have the sanitized
name. A manually added `my_theme.json` is listed as `my-theme` yet cannot be opened because
`theme_path("my-theme")` looks for `my-theme.json`. This also lets two different files (e.g.
`my_theme.json` and `my-theme.json`) collide to the same listed id. Make listing consistent with the
canonical sanitized id or look up files by their actual stem.



─── src-tauri/src/themes.rs:166-176 ───
`std::fs::write` follows symlinks. If `themes_dir()` contains a symlink with the sanitized theme
filename, the write will overwrite the symlink's target outside the themes directory, bypassing the
`theme_path` parent check. Open the file with `O_NOFOLLOW` (or verify the path is not a symlink)
before writing sensitive user content.



─── src-tauri/src/state.rs:66-68 ───
`db()` silently recovers from mutex poisoning by returning the inner `Connection`, but the
accompanying comment's claim that a SQLite handle is never left in a torn state is not guaranteed. A
panic that occurs mid-transaction, while a prepared statement is open, or while a `rusqlite` guard
is active can leave the database connection in an inconsistent state; subsequent callers then
proceed as if the handle is clean. Either prove and document the invariant (for example, that no
fallible SQLite operation can panic while the lock is held), or do not recover poisoning for the
database handle.



─── src-tauri/src/state.rs:39-39 ───
`startup_warnings` is a plain `Vec<String>` in a struct that is shared across threads via Tauri
`State`. While safe Rust prevents mutation through `&AppState`, exposing a `pub` unsynchronized
collection in shared state is a data-race hazard for future code or any `unsafe` access. It should
be `Mutex<Vec<String>>` / `RwLock<Vec<String>>` (or made immutable/private with a synchronized
accessor) to match the rest of the shared-state design and avoid accidental unsynchronized mutation.



─── src-tauri/src/state.rs:34-34 ───
The model cache is a single `Mutex<HashMap>` with per-entry TTL state. Callers must read an entry,
compare `fetched_at` against the TTL, and then write back a new entry in separate lock acquisitions.
This is a classic check-then-act race: concurrent refreshes for the same provider can duplicate work
and publish inconsistent entries. Consider providing an atomic `get_or_refresh`-style accessor, or
switch to a concurrent cache design (e.g., per-key locking or a crate like `moka`) so TTL checks and
updates happen together.



─── src-tauri/Cargo.toml:1-4 ───
The [package] section declares `edition = "2021"` but does not set `rust-version`. If the repository
has a minimum supported Rust version policy, library/binary crates should declare it so CI and
packagers can enforce it consistently.

Suggested fix: add `rust-version = "..."` after `edition`.

Ref: Review Checklist / Edition, MSRV, and Resolver.



─── src-tauri/Cargo.toml:1-4 ───
Release metadata is missing from the package table: there is no `license`/`license-file`,
`repository`, `description`, or `include`/`exclude`. If this crate is ever published or packaged by
downstream tooling, distribution can fail or the crate can be rejected by crates.io. It also risks
bundling unintended files (e.g. local assets, secrets, generated artifacts) without explicit
include/exclude controls.

Suggested fix: add `license`, `repository`, `description`, and relevant `include`/`exclude`
settings.

Ref: Review Checklist / Release and Metadata.



─── src-tauri/Cargo.toml:26-28 ───
`open = "5"` enables launching arbitrary system handlers for URLs and files. This is a
security-sensitive dependency: any user-influenced path or URL passed to it must be validated and
constrained to the intended scheme (e.g. http/https) or file path before invocation, otherwise it
may trigger unintended handler execution.

Note: this comment applies to the manifest only; the actual call sites that use `open` must be
reviewed separately to confirm sanitization is in place.

Ref: Pre-scan Focus Areas - External URL/file opening dependency.



─── src-tauri/Cargo.toml:17-17 ───
The `process` feature of `tokio` is enabled, which exposes `tokio::process::Command`. Any
command/program paths and arguments assembled from untrusted or user-supplied input could lead to
command injection or unexpected program execution.

Note: this comment applies to the manifest only; the actual `tokio::process::Command` call sites
must be reviewed separately to verify that program paths are hard-coded/allow-listed and arguments
are properly escaped/validated.

Ref: Pre-scan Focus Areas - Tokio process feature enabled.



─── ui/src/lib/useCopyFeedback.ts:17-25 ───
**Async error handling missing**: `void navigator.clipboard.writeText(text)` explicitly discards the
returned Promise, so any rejection (e.g., permission denied, insecure context, transient clipboard
failure) is swallowed. The checklist's Async Handling Standards require async functions to include
proper error handling with user-friendly messages; callers currently have no signal that the copy
failed.



─── ui/src/lib/useCopyFeedback.ts:19-21 ───
**Optimistic feedback can mislead users**: `setCopied(true)` runs before
`navigator.clipboard.writeText` resolves, so the UI may show 'copied' even when the clipboard write
ultimately fails. Consider awaiting the Promise and only setting the copied state on success, or
exposing an error state so the caller can provide accurate feedback.



─── ui/src/store/settings.ts:28-33 ───
Real defect: `load()` has no error handling. If `ipc.getSettings()` rejects, the `loading` flag
stays `true` forever and `settings` remains `null`, leaving any UI that depends on
`settingsStore.loading` stuck. Add a `try/finally` (or catch + rethrow) to reset `loading` and
surface the error to callers.

Severity: high — UX hang on backend/network failure.



─── ui/src/store/settings.ts:42-50 ───
State-consistency risk: `addProvider` and `removeProvider` first mutate the backend via IPC, then
reload state. If `get().load()` fails after the IPC mutation succeeds, the local Zustand state is
out of sync with the persisted backend state and the user is not notified. Consider either (a)
updating local state optimistically and rolling back on failure, or (b) catching/retrying/surfacing
the load error so the UI does not silently diverge.

Severity: medium-high.



─── ui/src/store/settings.ts:63-73 ───
Concurrency race: the `modelsByProvider[provider.id]` guard is read-then-write and not atomic. Two
concurrent calls to `prefetchEnabledProviderModels()` can both observe the same missing entry and
fire duplicate `ipc.listModels` requests for the same provider. Consider tracking per-provider
in-flight promises (e.g., a `modelsLoadingByProvider` map) so only one request is outstanding at a
time.

Also, the empty `.catch(() => {})` silently discards every failure, making provider misconfiguration
or network issues invisible. At minimum log these errors or expose them through state.

Severity: medium.



─── ui/src/lib/features.ts:4-12 ───
The backend comments claim skills/agents are "Real as of `set_conversation_system_prompt`", but
consumers still gate UI behind these `FEATURES` flags. Since both values are hardcoded to `true`,
the gating is effectively dead code and no longer provides any runtime protection. If the backend
truly shipped these capabilities, the flags and conditional rendering should be removed to eliminate
stale feature-gating; if the backend is not fully shipped, the comments are misleading and the
hardcoded-true flags could expose unfinished behavior. Either way, the code contradicts the stated
intent.



─── ui/src/lib/utils.ts:22-24 ───
Mutating `callbackRef.current` during render is a side effect in React's render phase. This breaks
rendering purity and can lead to inconsistent behavior under Strict Mode or concurrent React
features. Move this update into a `useLayoutEffect` (or `useEffect`) so the ref is updated after
commit without polluting render.



─── ui/src/lib/utils.ts:26-26 ───
The cleanup effect has an empty dependency array, so it only runs on unmount. If `delayMs` changes
while a timeout is pending, the previous timer is not automatically cancelled and may fire with the
old delay before the next invocation clears it. Include `delayMs` in the dependency array so pending
timers are cleared when the delay changes.



─── ui/src/lib/utils.ts:12-12 ───
`TIME_FMT` is instantiated once at module load with the runtime's default locale. If the application
supports locale switching later in the session, this formatter will not reflect the new locale and
timestamps will stay in the initial language. Consider exposing a factory function or a hook/context
that recreates the formatter when the active locale changes.



─── ui/src/store/theme.ts:26-29 ───
The inner `if (stored)` check is redundant because the enclosing `if (stored)` block already
guarantees `stored` is truthy. It obscures the legacy fallback intent and makes the code read as if
an additional guard is needed. Replace the inner `if (stored) return 'dark'` with a plain `return
'dark'` to clarify that any remaining non-empty legacy value defaults to dark.



─── ui/src/store/theme.ts:48-56 ───
`hexToRgba` silently falls back to the raw hex for any non-6-digit input, which means 3-character
shorthand hex colors (e.g., `#fff`) assigned to `--accent-bg` remain opaque instead of translucent.
Additionally, `alpha` is not validated or clamped, so out-of-range values (negative or > 1) can
produce an invalid `rgba(...)` CSS string. Consider expanding the parser to support shorthand hex
and clamping/validating `alpha` so `--accent-bg` always receives a valid translucent rgba value.



─── ui/src/store/theme.ts:41-45 ───
Both the `try/catch` and the trailing `.catch(() => {})` swallow every failure from
`ipc.setWindowTheme` without any logging. While the comment explains this is non-fatal (e.g., in
headless tests), silently discarding integration errors makes real Tauri window-theme failures
impossible to observe in production. Consider logging the error at a low level or collecting it
through a debug channel so failures are visible without breaking the UI.



─── ui/src/store/theme.ts:141-150 ───
`store.setThemeId(id)` internally calls `applyType(type, get().fontSize)`, so the font size state
must already be updated before the theme change is applied. The current function ordering (fontSize
first, then accent, then themeId) satisfies this, but the dependency is implicit and easy to break
during refactoring. Consider making the coupling explicit, e.g., by having `setThemeId` accept an
optional `fontSize` parameter or by adding a comment here warning that `setFontSize` must precede
`setThemeId`.



─── ui/vite.config.ts:28-28 ───
Risk: `envPrefix: ['VITE_', 'TAURI_']` exposes every environment variable starting with `TAURI_` to
the bundled client code. Tauri CLI historically sets variables like `TAURI_SIGNING_PRIVATE_KEY`,
`TAURI_PRIVATE_KEY`, `TAURI_KEY_PASSWORD`, and similar secrets during build/signing. Even if no
secret is currently used in this project, a future environment change could accidentally leak
signing keys into the frontend bundle. Limit `envPrefix` to only the non-sensitive prefixes required
by the UI (likely just `VITE_`), and if `TAURI_` variables are needed, load them explicitly through
`env` config or `import.meta.env.VITE_*` indirection rather than exposing the entire prefix.



─── ui/vite.config.ts:6-22 ───
Bug/Reliability: `host` is assigned directly from `process.env.TAURI_DEV_HOST` without validation or
normalization. Vite's `server.host` option accepts `boolean | string`, but a malformed or empty
value (e.g., `TAURI_DEV_HOST=` or `TAURI_DEV_HOST=0.0.0.0,192.168.1.5`) will cause Vite to fail or
bind to an invalid host. Normalize it to a boolean for the common `true`/`false` case and validate
string hostnames/IPs before passing them through.



─── ui/vite.config.ts:13-13 ───
Compatibility/Build hazard: `import.meta.dirname` is only available in Node.js >= 20.11.0. This
`ui/package.json` does not declare an `engines` field, so the project can be built on older Node
versions where this property is `undefined`, causing `path.resolve(undefined, './src')` to throw or
produce an incorrect alias. For broader compatibility, use `fileURLToPath(import.meta.url)` and
`path.dirname()` instead, or add an `engines` requirement for Node `>=20.11.0`.



─── ui/src/lib/types.ts:50-50 ───
The `| string` catch-all causes this union to collapse to just `string`, so the literal values
provide no compile-time checking. Rust also defines `Skill::source` as a plain `String` with
`#[serde(default = "default_source")]` (defaulting to `"builtin"`), not `Option<String>`, so the
backend always serializes this key. The `?` therefore makes the TypeScript shape inaccurate. If the
domain is truly closed to these three values, make it a required closed union: `source: 'builtin' |
'custom' | 'global'`; otherwise mirror Rust as `source: string`.



─── ui/src/lib/types.ts:51-51 ───
Multiple `Option<String>` fields from Rust (`path`, `agent_id`, `description`) are typed as optional
(`?: string | null`) in TypeScript, but serde serializes `Option<T>` as `null` rather than omitting
the key. The optional markers are therefore inaccurate and can introduce subtle bugs, such as
destructuring defaults (`const { agent_id = 'general-assistant' } = conversation`) failing because
the value is `null`, not missing. Change these fields to required nullable types (`: string | null`)
to match the actual runtime payload.



─── ui/src/lib/types.ts:22-32 ───
This interface mixes stdio-only fields (`command`, `args`, `env`) and HTTP-only fields (`url`,
`headers`) into one flat object where all fields are required. It therefore allows invalid
combinations (e.g., an HTTP server missing `url` but carrying `command`) to type-check. Since
`transport` discriminates the mode, model this as a discriminated union with the common fields plus
transport-specific variants. This enforces that only the relevant fields are supplied for each
transport and more accurately reflects the backend semantics.



─── ui/src/store/chat.ts:347-355 ───
sendMessage, retryMessage, and editAndResendMessage each mint a fresh streamId and call
attachStreamListener without checking whether a stream is already active. attachStreamListener
unconditionally overwrites the global `streaming` state, so the previous listener remains attached
but drops every event (its closure sees `current.streamId !== oldStreamId`). The old stream's final
assistant message is therefore never appended and its listener leaks. Add a guard in each action: if
`get().streaming` is non-null, reject the new request, cancel/await the existing stream, or queue
it, and always detach the previous listener.



─── ui/src/store/chat.ts:412-416 ───
cancelStream only notifies the backend and relies on a terminal stream event to clear `streaming`
and detach the listener. If the terminal event is delayed, dropped, or the cancel command itself
errors, the UI stays in streaming mode and the listener leaks. The store should keep the stream's
`unlisten` callback (e.g., in the `streaming` state or a side ref) and call it here, then
immediately set `streaming: null` and reset any stale error.



─── ui/src/store/chat.ts:210-213 ───
Using `Promise.all` means the first failing `deleteConversation` rejects before the local `set()`
runs, but any earlier deletions in the batch have already succeeded on the backend. The frontend
conversation list then becomes inconsistent with the backend. Use `Promise.allSettled` instead,
remove only the successfully deleted ids from local state, and report the failures to the user.



─── ui/src/store/chat.ts:334-336 ───
The literal 'New chat' is used as business logic to decide when to auto-generate a title. If the
backend or onboarding flow ever changes the default title, this silently breaks. Extract it to a
shared constant (e.g., `DEFAULT_CONVERSATION_TITLE`) defined alongside the backend default.



─── ui/src/store/chat.ts:83-86 ───
The default agent id 'general-assistant' is hardcoded both in the initial state and as the fallback
when matching conversations in loadConversations. If the default agent changes, these two places
must be updated together or the app will select the wrong conversation on load. Define a single
exported constant such as `DEFAULT_AGENT_ID` and use it everywhere.



─── ui/src/store/chat.ts:308-309 ───
When sendMessage creates a new conversation it passes only provider and model, omitting the
currently selected `activeAgentId`. The backend is likely to store the conversation with no/default
agent, while the local store keeps the previous active agent. This causes mismatches after reload or
when loadConversations tries to match conversations by agent. Pass the active agent id to
`createConversation`, e.g. `get().createConversation(providerId, model, null, get().activeAgentId)`.



─── ui/src/store/chat.ts:498-501 ───
The default context flag value 'normal' is hardcoded in multiple message constructors (optimistic
user message, finished assistant, and partial/error assistant). If the backend's default flag or
enum naming changes, these local messages will be inconsistent. Define a `DEFAULT_CONTEXT_FLAG`
constant and reuse it.



─── ui/src/lib/types.ts:85-85 ───
Rust serializes `border_visibility` as a plain `String` (default `"subtle"`) with no enum
constraints. Keeping it as `string` here is therefore an honest mirror and avoids false positives
for unknown values. The comment in the pre-scan suggests confirming the backend type, and it is
indeed unconstrained.



─── ui/src/lib/types.ts:87-87 ───
`Settings.system_prompt` matches Rust (`Option<String>`), and the remaining nullable fields use
`type | null`, so the nullability convention is mostly consistent except for the `?` markers noted
earlier. No issue here.



─── ui/src/lib/types.ts:0-0 ───
Rust `Settings::font_size` is `u32`, `Settings::context_tokens` is `u32`, and
`Settings::memory_enabled` is `bool` with `#[serde(default)]`. These mappings are accurate.
`ThemePreference` also correctly mirrors the Rust `rename_all = "lowercase"` enum.



─── ui/src/lib/types.ts:120-122 ───
Rust types several identifiers (`Message.id`, `Message.conversation_id`, `Message.created_at`, and
`Conversation.id`) as `i64`, but TypeScript maps them to `number`. This is usually fine for SQLite
rowids in practice, but it loses precision for values outside `Number.MAX_SAFE_INTEGER`. If strict
parity with Rust is required, consider using `bigint` for these fields; otherwise, document the
safe-integer caveat so future consumers are aware of the precision limit.



─── ui/src/lib/types.ts:181-183 ───
Rust `ProviderTestResult` is a single struct with optional `models_found` (`Option<i64>`) and
`message` (`Option<String>`). The TypeScript uses a discriminated union `{ ok: true; models_found:
number } | { ok: false; message: string }`, which is a cleaner consumer API. However, the Rust
command always returns `Some(models_found)` on success and `Some(message)` on failure, and `ok` is
`bool`, so the TypeScript union is functionally compatible. Be aware that a change in Rust to omit
those fields would require adding `?` to the TypeScript side, but currently it is safe.



─── ui/src/components/MarkdownContent.tsx:41-50 ───
Lazy-loaded MermaidBlock is wrapped in Suspense but not in an ErrorBoundary. If the dynamic import
chunk fails to load (network error, build issue), the rejected promise will propagate during render
and crash the nearest React tree instead of falling back gracefully. Wrap the lazy component in an
ErrorBoundary, or add a retry/fallback loader so failed loads are handled.



─── ui/src/components/MarkdownContent.tsx:42-42 ───
String(children) will produce '[object Object]' if react-markdown passes children as an array or
React element (e.g. after rehype transformations). This yields a broken or nonsensical Mermaid
diagram. Coerce safely by joining arrays or falling back to an empty string for non-string children.



─── ui/src/components/MarkdownContent.tsx:96-107 ───
The custom anchor component passes href directly to the DOM without scheme validation. User-supplied
markdown could contain javascript: or data: URLs that execute arbitrary code even with
target="_blank" rel="noreferrer noopener". Validate href against an allowlist of safe schemes
(http:, https:, mailto:, tel:, etc.) and drop or sanitize dangerous ones.



─── ui/src/components/MarkdownContent.tsx:51-54 ───
The block-code detection only checks for newlines when children is a string. If react-markdown
passes children as an array of text nodes, the condition fails and a multi-line fence without a
language class falls through to inline <code> styling, breaking layout. Use a helper that
joins/normalizes children before checking for newlines.



─── ui/src/App.tsx:20-22 ───
Unhandled promise rejection in the initialization effect. If `load()` or
`prefetchEnabledProviderModels()` rejects, the rejection is uncaught and users get no feedback.
Prefer async/await with a try/catch block, add user-facing error handling (e.g. a toast), and
include a cancellation guard to avoid state updates after the component unmounts.



─── ui/src/App.tsx:42-52 ───
The lazy-loaded `Settings` route is only wrapped in `Suspense`. If the dynamic import fails
(network/CDN error, build issue) or `Settings` throws during render, the error bubbles and crashes
the entire app. Add an `ErrorBoundary` around the lazy component so users can recover, retry, or
return to Chat.



─── ui/src/App.tsx:16-16 ───
Route state is held only in local `useState`, so refreshing the page always resets to Chat and the
Settings view cannot be deep-linked or navigated with browser history. Consider persisting the
active route in the URL (path, hash, or query param) to improve UX and enable direct links.



─── ui/src/App.tsx:44-48 ───
The loading spinner has an `aria-label`, but screen readers may not reliably announce it because the
wrapping element lacks `role='status'` and `aria-live`. Add `role='status' aria-live='polite'` to
the fallback container (or to the spinner itself) so assistive technologies announce that Settings
is loading.



─── ui/src/components/EmptyChatState.tsx:43-48 ───
The `onClick` handler returns a `Promise` from an async action, which is a type mismatch for React
event handlers (expected `void`) and leaves the button enabled while `sendMessage` runs. Rapid or
repeated clicks can create duplicate conversations/messages because there is no loading/disabled
state. Disable the buttons when a message is sending (e.g., when `streaming` is non-null) and use a
synchronous wrapper such as `() => { void sendMessage(item.prompt) }`.



─── ui/src/components/EmptyChatState.tsx:51-53 ───
The decorative chevron character `›` is text content without `aria-hidden`, so assistive
technologies may announce it and confuse users. Add `aria-hidden` to the span so only the meaningful
prompt text is exposed.



─── ui/src/components/EmptyChatState.tsx:3-20 ───
Using `item.title` as the React `key` relies on string titles staying unique and unchanged. If
prompts are later edited or translated, duplicate or unstable keys can hurt reconciliation. Consider
adding an explicit stable `id` field to each starter prompt object and using that as the key.



─── ui/src/components/Composer.tsx:182-188 ───
Nested ternary expressions are prohibited by project rules and hurt readability. Replace with a
chain of `if/else` statements or a helper function/memoized value.



─── ui/src/components/Composer.tsx:314-318 ───
Another nested ternary in JSX violates the no-nested-ternary rule. Consider using a small helper
like `getEmptyMessage(isSkillPicking, isPromptPicking, ...)` or an `if/else` block before the
return.



─── ui/src/components/Composer.tsx:213-213 ───
Nested ternary for the `effort` mapping is hard to scan and breaks the no-nested-ternary rule.
Convert to an `if/else` chain or a small lookup table.



─── ui/src/components/Composer.tsx:444-447 ───
Nested ternary inside `cn()` for the progress bar color is a readability issue and violates the
no-nested-ternary rule. Extract the color class to a variable first.



─── ui/src/components/Composer.tsx:270-273 ───
The drag-and-drop surface accepts drops (`onDrop` prevents default) but never reads
`e.dataTransfer.files`. This appears to be incomplete file-attachment functionality. Either
implement file ingestion/attachment or remove the drop zone to avoid confusing users.



─── ui/src/components/Composer.tsx:237-241 ───
Pressing Escape while the command menu is open wipes the entire textarea (`setText('')`) rather than
just closing the menu. This is unexpected and can discard user input the user intended to keep.
Close the menu (e.g., by restoring the draft before the slash or moving focus) instead of clearing
it.



─── ui/src/components/Composer.tsx:50-55 ───
Context-usage refresh errors are silently swallowed (`.catch(() => {})`). If `getContextUsage`
fails, users never know the context meter is stale and telemetry gets no signal. At minimum
log/notify the error. Also, the debounced request is not cancelled on cleanup, so a stale request
may overwrite the current conversation's context usage when the user switches chats. Add an effect
cleanup to cancel/flush the debounced call.



─── ui/src/components/Composer.tsx:171-179 ───
The `/settings` command opens settings by dispatching a synthetic global `KeyboardEvent` instead of
calling an explicit settings-open action. This is fragile: it depends on an external global shortcut
listener, will break if the shortcut mapping changes, and is hard to test. Replace with a dedicated
store/action such as `settingsStore.open()`.



─── ui/src/components/CodeBlock.tsx:29-30 ───
Bug: language label can display unrelated CSS classes. The fallback strips only the literal 'hljs'
substring and then uses the remainder of className as the language name. If className contains
utility classes (e.g. 'hljs some-class text-sm') or has no language- token, the UI will show tokens
like 'some-class text-sm' as the language. Parse only the language- token or default to 'code' when
none is present.



─── ui/src/components/CodeBlock.tsx:12-24 ───
Bug/maintainability: getNodeText is fragile and can silently produce incomplete copy text. ReactNode
may be Iterable<ReactNode> (fragments), which Array.isArray does not cover; React portals have a
different shape and are ignored; the unsafe `as` assertions bypass compile-time checks. Any
component that renders text from props other than `children` will also be skipped. As a result, the
clipboard content may be empty or truncated for non-trivial React trees. Consider using
React.Children helpers or a more robust extraction strategy.



─── ui/src/components/CodeBlock.tsx:32-33 ───
Bug: trailing-newline normalization is inconsistent. The regex `/\n$/` removes only one trailing
newline, so code with multiple trailing newlines will retain extra blank lines in the copied text
while the line-number gutter counts the already-normalized rawText. Decide whether trailing newlines
should be fully stripped (common for copy) or preserved, and apply the same normalization to both
rawText and lineCount.



─── ui/src/components/CodeBlock.tsx:69-71 ───
Bug: empty code blocks still show line number 1. When `rawText` is `''`, `''.split('\n')` returns
`['']` with length 1, so the gutter renders a '1' even though there is no content. Guard against
empty strings so lineCount is 0 (or the gutter is omitted) in that case.



─── ui/src/components/CodeBlock.tsx:32-33 ───
Maintainability/performance: useMemo is unlikely to help here. `children` is typically a new
object/array on every parent render, so these memoizations will almost never cache. They add React
overhead and give a false sense of optimization. Prefer plain derived values unless profiling proves
these computations are a bottleneck.



─── ui/src/components/ChatHeader.tsx:81-109 ───
The clear-context and custom-model dialogs resolve the active conversation (`active`) at the moment
the button is clicked, not when the dialog was opened. If the user switches to a different chat
while either dialog is still open, the action will be applied to the newly selected conversation
instead of the one that triggered the dialog, leading to accidental data loss or model changes.
Capture the target conversation ID in a local state variable when the dialog opens and use that
captured ID in the commit/clear handlers.



─── ui/src/components/ChatHeader.tsx:145-150 ───
Opening the model selector triggers `refreshModels` calls in a synchronous `for...of` loop without
awaiting them or using `Promise.all`. Because `refreshModels` is async and may reject, this creates
unhandled promise rejections and fetches providers sequentially rather than in parallel. Use
`Promise.all` with error handling (e.g., logging or surfacing a toast) so providers refresh
concurrently and failures are handled.



─── ui/src/components/ChatHeader.tsx:44-45 ───
Provider and model IDs are joined with a fixed `':::'` separator and later split on that separator
without any escaping or validation. If either a provider ID or a model ID ever contains `':::'`,
`handleSelect` will split the value incorrectly and pass the wrong IDs to `setConversationModel`, or
end up with an empty/undefined model ID. Use an encoding scheme that cannot collide with
user-provided IDs (e.g., JSON array, URL-encoded segments, or escaping) or validate that IDs do not
contain the separator.



─── ui/src/components/ChatHeader.tsx:92-102 ───
The separator `VALUE_SEP` is reused in many string templates when constructing `SelectItem` values,
but there is no helper function or validation to ensure IDs do not contain the separator. Consider
centralizing the encoding/decoding logic and adding a guard to prevent malformed IDs from producing
incorrect provider/model selections.



─── ui/src/components/AgentsPane.tsx:59-75 ───
Persist calls are not awaited or error-handled. `save()` in the settings store is asynchronous
(`save: (next: Settings) => Promise<void>`), but `handleToggle`, `handleDelete`, and `handleSave`
call it synchronously. If IPC persistence fails or throws, the local state may already have been
optimistically updated without rollback, and the user receives no feedback. Consider making these
handlers async, awaiting `save`, and displaying an error state or rolling back on failure.



─── ui/src/components/AgentsPane.tsx:191-199 ───
Destructive delete lacks confirmation. `handleDelete` immediately removes the agent from settings
and persists the change when the trash icon is clicked. There is no confirmation dialog, making
accidental data loss likely. Consider adding a confirmation step before removing the agent.



─── ui/src/components/AgentsPane.tsx:97-131 ───
Minimal save validation. `handleSave` only checks that `name` and `systemPrompt` are non-empty. It
does not prevent duplicate agent names, validate that `selectedSkills` entries still exist in
`availableSkills`, or guard against excessively long inputs. Consider adding validation for
duplicate names and verifying skill IDs before persisting.



─── ui/src/components/AgentsPane.tsx:116-116 ───
Weak agent ID generation. New agent IDs use `agent-${Date.now()}`, which can collide if multiple
agents are created rapidly (e.g., double-clicking the create button) and is predictable. Consider
using a stronger unique identifier such as `crypto.randomUUID()` or a UUID library.



─── ui/src/components/ConversationTimeline.tsx:0-0 ───
The `activeMessageId` prop is declared in the interface but is never destructured or referenced in
the component. This is dead API surface and suggests the active-tick highlighting feature is either
missing or the prop should be removed to keep the API honest. If the intent is to visually
distinguish the currently selected message in the timeline, implement the highlight; otherwise
remove the prop from the interface.



─── ui/src/components/ConversationTimeline.tsx:90-99 ───
Using `onMouseDown` on a `<button>` prevents keyboard activation. Buttons are focusable by default
and are expected to respond to Enter and Space key presses via `onClick`. Replace `onMouseDown` with
`onClick` for the dash button so keyboard users can jump to messages.



─── ui/src/components/ConversationTimeline.tsx:69-78 ───
The hover preview card is rendered as a plain `<div>` with mouse-only handlers. It is unreachable
via keyboard or assistive technology, and duplicates the jump action already available on the
visible button. Consider either removing the preview's `onMouseDown` action (making it a purely
informational tooltip) and making the button self-sufficient, or converting the card into a
keyboard-focusable, screen-reader friendly control with `role="button"`, `tabIndex={0}`, and a
keydown handler that responds to Enter/Space.



─── ui/src/components/ConversationTimeline.tsx:103-104 ───
`w-4.5` is not part of the default Tailwind CSS v4 spacing scale, and no custom spacing extension
was found in the project. The expanded dash will silently fail to apply the intended width in a
stock setup. Use an explicit arbitrary value such as `w-[1.125rem]` (18px) or extend the theme
spacing to ensure the hover/expanded state renders correctly.



─── ui/src/components/McpPane.tsx:223-236 ───
`save` is invoked synchronously in `handleSaveServer`, `handleToggle`, and `handleDelete`. If `save`
is asynchronous (common for IPC/zustand stores), the dialog closes / UI updates before persistence
completes, and any rejection is unhandled. Await `save` and wrap it in try/catch to show persistence
errors before closing the modal.



─── ui/src/components/McpPane.tsx:210-213 ───
Splitting arguments on `/\s+/` and filtering empty strings strips quoted/spaced arguments and cannot
represent paths like `C:\Program Files\...` correctly. Consider using a shell-aware parser, a
comma/newline separator, or an array input so spaces and quotes are preserved.



─── ui/src/components/McpPane.tsx:72-79 ───
`HTTP_PRESETS` contains a literal endpoint URL (`http://localhost:3000/mcp`). Business-related URLs
should be configurable or surfaced as a placeholder, not hardcoded in source.



─── ui/src/components/McpPane.tsx:81-91 ───
`parseEnvString` silently drops lines without `=` and accepts empty/whitespace keys, producing
malformed `env`/`headers` objects (e.g. `  =value` sets key `''`). Validate that the trimmed key is
non-empty and surface a parsing error or warning to the user.



─── ui/src/components/McpPane.tsx:139-162 ───
`handleTestServer` awaits an IPC call and then updates state. If the component unmounts while the
test is in flight, React will warn about setting state on an unmounted component. Use a cancellation
token / mounted flag or `AbortController` to guard state updates.



─── ui/src/components/MessageErrorBoundary.tsx:22-32 ───
The error boundary never resets after catching an error. Once `hasError` is set to `true`, it
remains `true` even when `children` or `fallbackText` change, so a parent reusing this instance
(instead of remounting) will continue showing the fallback for subsequent valid messages. Consider
adding reset logic such as `componentDidUpdate` that clears the error state when the wrapped message
identity changes, or expose a reset method for the parent to call.



─── ui/src/components/MessageErrorBoundary.tsx:39-43 ───
`navigator.clipboard.writeText` returns a Promise that is neither caught nor surfaced to the user,
violating async error handling standards. Clipboard writes can fail due to permission denial,
insecure context, or transient OS errors, leaving the user with no success/failure signal. Use
`async/await` with `try/catch` and provide visual feedback (e.g., a temporary "Copied" label or an
error message).



─── ui/src/components/MermaidBlock.tsx:54-79 ───
Mermaid's `mermaid.render(id, chart)` creates a hidden scratch element in the DOM for the supplied
id. This effect never removes that scratch node on cleanup, so mounting/unmounting the component (or
changing `uniqueId`) leaves orphaned hidden elements in `document.body`. Add cleanup logic to remove
the scratch node in the effect return.



─── ui/src/components/MermaidBlock.tsx:26-37 ───
This function mutates a single global Mermaid config. If multiple `MermaidBlock` instances render
concurrently with different themes, the global theme can be overwritten by one instance after
another has called `ensureMermaidInitialized` but before `mermaid.render` consumes the config,
causing diagrams to render with the wrong theme. Consider serializing render operations, scoping
config per render, or using `mermaid.render`'s per-call configuration if supported by the installed
version.



─── ui/src/components/MermaidBlock.tsx:191-191 ───
Rendering model-generated SVG via `dangerouslySetInnerHTML` bypasses React's XSS protections. While
`securityLevel: 'strict'` disables HTML labels and click bindings, it is not a complete guarantee
against SVG-based vectors (e.g., malicious `href`/`xlink:href`, `foreignObject`, parser edge cases,
or future Mermaid bypasses). Consider sanitizing the SVG with an SVG-aware sanitizer such as
DOMPurify before injection, or rendering it inside an isolated sandbox like an iframe with `srcdoc`.



─── ui/src/components/MermaidBlock.tsx:188-192 ───
Applying `transform: scale(...)` directly to this container does not change its layout size, so at
zoom levels > 1 the scaled SVG visually overflows the `overflow-hidden` parent but the container
does not grow and produces no scrollbars. The zoomed diagram becomes clipped and unusable. Apply the
scale to an inner wrapper and size the outer container to the scaled dimensions, or use an
SVG-native zoom mechanism (e.g., `viewBox`/`transform` inside the SVG itself).



─── ui/src/components/MessageRow.tsx:14-20 ───
Tailwind className composition via template literal can produce trailing whitespace and, more
importantly, allows conflicting utility classes from the consumer (e.g. `mx-0`, `max-w-full`,
`px-0`) to coexist with base classes (`mx-auto`, `max-w-[var(--reading-max)]`, `px-4`). Because
Tailwind utilities resolve based on source order, overrides become unpredictable. Consider using
`clsx` for conditional joining and `tailwind-merge` to deduplicate conflicting classes so the
consumer's `className` reliably overrides the base styles.



─── ui/src/components/MessageRow.tsx:16-16 ───
`max-w-[var(--reading-max)]` depends on the CSS custom property `--reading-max` being defined
elsewhere (e.g. a design token/global style), but there is no fallback value. If the variable is
missing or misspelled, the max-width declaration becomes invalid and rows could silently expand to
full width, breaking the intended reading column layout. Consider adding a fallback such as
`max-w-[var(--reading-max,48rem)]` or ensuring the token layer is always loaded and validated.



─── ui/src/components/MessageList.tsx:71-81 ───
Target-message jump fails on cold cache. This effect only re-runs when `targetMessageId` changes. On
first render the messages array is usually empty, so `findIndex` returns -1 and the effect exits
early. When messages later load, the effect does not run again because `targetMessageId` has not
changed, leaving the viewport at the default/bottom position instead of jumping to the requested
message.



─── ui/src/components/MessageList.tsx:52-69 ───
Two issues here: (1) Conflicting scroll commands — this effect and the target-message effect both
call `scrollToIndex` independently with different destinations and re-fire rules. On a conversation
switch that also supplies a `targetMessageId`, they can race and the bottom-scroll may override the
target jump depending on commit/timing order. (2) The comment claims the effect does not depend on
`messages` and will not re-trigger on every append, but the dependency array includes the full
`messages` array. If `useConversationMessages` returns a new reference on each streaming append, the
effect body will re-run every time even though the `scrolledForRef` guard short-circuits it.



─── ui/src/components/MessageList.tsx:45-50 ───
Mutating a ref (`messagesRef.current = messages`) during render is a side effect in the render
phase. React components should be pure during render; refs should not be written outside of effects
or event handlers. Move this assignment into a `useEffect` to keep the latest value available
without violating render purity and to avoid subtle issues with StrictMode double-renders or
concurrent rendering.



─── ui/src/components/MessageList.tsx:108-110 ───
`startReached` directly invokes `loadOlderMessages` with no in-flight guard. Rapid top-edge
callbacks — for example while the user flings near the top or while a slow fetch is pending — can
trigger multiple overlapping requests before `hasMore` becomes false. Add a local `loadingOlder`
flag (or derive one from the store) and ignore subsequent calls while a fetch is in progress.



─── ui/src/components/MessageList.tsx:111-114 ───
`activeMessageId` is set to explicit navigation targets (last message on initial load, target
message on jump) but is overwritten here with the first visible item. During a smooth scroll to a
target, `rangeChanged` fires repeatedly and makes the timeline highlight flicker to intermediate
messages at the top of the viewport. Decide whether `activeMessageId` means "explicit navigation
target" or "first visible item" and avoid mixing the two semantics.



─── ui/src/components/MessageList.tsx:132-132 ───
The `messages.length > 4` threshold is a hardcoded magic number with no documented rationale. It is
brittle and unclear why exactly 4 messages should suppress the jump-to-bottom button. Make it
configurable (e.g., a `minMessagesForScrollButton` prop) or add a clear comment explaining the UX
rationale.



─── ui/src/components/MessageList.tsx:115-122 ───
`itemContent` is recreated on every render, which can cause Virtuoso to re-render visible rows
unnecessarily and defeats internal memoization. Memoize it with `useCallback`. Also note that the
`key` prop on the element returned from `itemContent` may not override Virtuoso's internal row keys
(which are typically index-based); verify that this actually prevents error-state inheritance when a
different message is rendered at the same list position.



─── ui/src/components/MessageList.tsx:123-130 ───
Defining `Footer` as an inline arrow function inside the component creates a new component type on
every render. This violates the React rule against declaring components inside components and breaks
any memoization that `Virtuoso` or React might apply. Extract `Footer` to a stable top-level
component (passing `isStreamingHere`, `streaming`, etc. as props) and pass stable `components`
references.



─── ui/src/components/MessageList.tsx:83-93 ───
`handleScrollToMessage` is recreated on every render and passed to `ConversationTimeline`. If
`ConversationTimeline` is memoized, this reference change will force it to re-render unnecessarily.
Wrap it with `useCallback` for a stable reference.



─── ui/src/components/MindMapPanel.tsx:35-51 ───
Null-safety issue: if `activeConversationId` is null/undefined or `useConversationMessages` returns
a non-array value, `messages.filter()` will throw a runtime TypeError. The prior `?? []` was removed
to keep array references stable, but the filter call now assumes `messages` is always an array.
Defensive fix: `return messages?.filter((m) => m.role === 'user') ?? []` inside the memo so the
fallback only runs when `messages` is missing and does not create a new array on every render
otherwise.



─── ui/src/components/MindMapPanel.tsx:78-80 ───
Non-standard Tailwind utility: `py-0.2` is not part of the default Tailwind spacing scale (the
smallest positive step is `py-0.5`). It will silently fail to apply unless the project has extended
the spacing scale. Use a standard value such as `py-0.5` or `py-0`.



─── ui/src/components/MindMapPanel.tsx:157-158 ───
Non-standard Tailwind utility: `shadow-xs` is not guaranteed to exist in all Tailwind
versions/configs (it was absent from Tailwind v3.0 defaults and its availability depends on theme
extensions). It appears here and on the message card button. If unavailable, no shadow is rendered.
Prefer the standard `shadow-sm` or ensure the theme defines `xs`.



─── ui/src/components/MindMapPanel.tsx:128-138 ───
Floating-point comparison bug: `zoom !== 1` compares an IEEE-754 result of repeated `+/- 0.15`
operations against `1` exactly. After zooming in/out, values like `0.9999999999999999` or
`1.0000000000000002` are possible, so the reset-zoom button can stay visible even when the displayed
percentage reads 100%. Use an epsilon comparison, e.g. `Math.abs(zoom - 1) > 1e-6`, or compare the
rounded percentage `Math.round(zoom * 100) !== 100`.



─── ui/src/components/MindMapPanel.tsx:144-152 ───
UX bug: the empty state is only shown when there are no user messages. If a search filter reduces
`filteredNodes` to zero, the panel still renders the root node and trunk line with no child nodes
and gives no feedback to the user. Add an explicit empty state when `filteredNodes.length === 0`.



─── ui/src/components/MessageBubble.tsx:107-177 ───
Pin/exclude/delete are gated only by `pending`, while retry/edit use `mutationsDisabled`
(`isStreaming || pending`). During streaming these mutating actions remain enabled and can race with
in-flight generation and store updates. Align all destructive/context mutations with
`mutationsDisabled` so the UI state stays consistent while a response is streaming.



─── ui/src/components/MessageBubble.tsx:79-79 ───
`handleCopy` always copies the raw `message.content`. For assistant messages the visible text has
`<thinking>` blocks and `%%TOOL_CALL_%%` placeholders stripped out (see `cleanedText`), so users
copy hidden markers instead of what they see. Copy the rendered text: `message.content` for user
messages and `cleanedText` for assistant messages.



─── ui/src/components/MessageBubble.tsx:249-249 ───
`message.created_at` is multiplied and passed to `new Date(...)` without validation. If the
timestamp is missing or non-numeric, `new Date(NaN)` renders as "Invalid Date". The same unguarded
formatting is used in the assistant header. Add a helper that validates the timestamp and falls back
to an empty string or placeholder.



─── ui/src/components/MessageBubble.tsx:257-276 ───
Tool-call rendering relies on index-based placeholder parsing. `parseInt(part, 10)` can return `NaN`
for malformed placeholders, silently dropping the card. React keys like `text-${index}` are
unstable: as the number of placeholders changes during streaming, text nodes remount. Validate the
parsed index and prefer stable keys derived from tool id or content offsets.



─── ui/src/components/MessageBubble.tsx:43-46 ───
`editing` and `draft` are initialized from props and never synchronized with `message` afterwards.
If the component instance is reused for a different message (e.g., key collision or list reorder),
the editor can show stale content or submit an edit against the wrong message. Add a `useEffect`
keyed on `message.id` that resets `editing` to `false` and `draft` to `message.content` whenever the
message identity changes.



─── ui/src/components/MessageBubble.tsx:48-52 ───
Reading `useChatStore` through multiple independent selectors can observe different store snapshots
during concurrent rendering, so `isStreaming` and action references may become inconsistent when
computing `mutationsDisabled`. Combine the state and actions into a single selector to guarantee a
consistent snapshot.



─── ui/src/components/MessageBubble.tsx:91-96 ───
`commitEdit` closes the editor even when the edit cannot be submitted (empty draft or mutations
disabled). Pressing Enter while streaming or with an empty draft silently exits edit mode instead of
sending. Return early and keep the editor open when the action cannot be committed, or provide clear
disabled/empty-state feedback.



─── ui/src/components/StreamErrorWatcher.tsx:11-16 ───
The 'Dismiss' action does nothing because its onClick handler is empty. Sonner action buttons do not
automatically close the toast, so users will tap a non-functional button. Capture the toast id
(toast.error returns an id) and call toast.dismiss(id) in the handler, or call toast.dismiss() to
close all toasts.



─── ui/src/components/StreamErrorWatcher.tsx:26-36 ───
The diagnostics fetch uses .then().catch() promise chains, which violates the project's async/await
standard and makes the control flow harder to follow. Rewrite this effect with an async IIFE or
inner async function, awaiting ipc.getDiagnostics() and using a standard try/catch block.



─── ui/src/components/StreamErrorWatcher.tsx:30-35 ───
Startup-warning toasts have duration: Infinity and are fired on every mount without deduplication.
React StrictMode, navigation, or any remount will stack duplicate warnings that never auto-dismiss.
Provide stable toast ids (e.g., derived from the warning string) so sonner dedupes them, or track
already-shown warnings in a ref/state. Also consider dismissing them in the effect cleanup so they
do not outlive the component session.



─── ui/src/components/StreamErrorWatcher.tsx:37-40 ───
All diagnostics failures are silently swallowed in the empty catch block, hiding potential
IPC/backend issues and making debugging harder. Diagnostics may be advisory, but failures should
still be logged (e.g., console.error('Failed to load diagnostics', err)) and ideally reported to
telemetry rather than ignored entirely.



─── ui/src/components/Sidebar.tsx:295-301 ───
[Async Error Handling] `handleCreateAssistant` calls async store action `saveSettings(updated)`
without try/catch. If saving fails, the promise rejection goes unhandled and the user receives no
feedback that the assistant wasn't created.



─── ui/src/components/Sidebar.tsx:330-336 ───
[Async Error Handling] `handleBatchDelete` calls async store action
`deleteConversations(Array.from(selectedIds))` without try/catch. A failed batch delete leaves the
UI in the 'deleted' state (select mode cleared, selection cleared) while the backend still has the
conversations, with no user feedback.



─── ui/src/components/Sidebar.tsx:220-240 ───
[Race Condition / Unhandled Async] The initial auto-create `useEffect` calls `createConversation`
async but does not await or catch it. It also races with `loadConversations()`: when this effect
first runs, `conversations` may still be empty because `loadConversations` hasn't resolved, causing
an empty conversation to be created even when the server already has chats. Consider awaiting
`loadConversations` and/or using a 'loading' state before auto-creating.



─── ui/src/components/Sidebar.tsx:255-260 ───
[Logic / Comment Accuracy] The comment says 'Find latest chat for this assistant', but
`conversations.find(...)` returns the first matching conversation, not the latest. If the list isn't
guaranteed to be ordered most-recent-first, this will switch to the oldest conversation instead of
the latest.



─── ui/src/components/Sidebar.tsx:97-104 ───
[Code Style] The `className` conditional uses a nested ternary expression, which violates the
project's no-nested-ternary rule and reduces readability. Refactor into a helper variable or `cn`
with explicit branches.



─── ui/src/components/Sidebar.tsx:343-348 ───
[UX / Validation] `commitRename` silently closes the dialog and does nothing when
`renameDraft.trim()` is falsy. This allows the user to accidentally save an empty title without
validation or feedback. Consider showing a validation message or disabling the Save button.



─── ui/src/components/Sidebar.tsx:231-232 ───
[Potential Null Access] `settings.providers[0]?.id` is accessed without first confirming
`settings.providers` exists. While `settings.providers` is likely always defined, the surrounding
code already null-guards `settings`; consider adding a fallback or default to avoid runtime
surprises.



─── ui/src/components/Sidebar.tsx:242-253 ───
[Async Error Handling] `handleNewChat` calls `createConversation` synchronously and ignores its
returned promise. If conversation creation fails (e.g., network error), the promise rejection is
unhandled and the user receives no error feedback.



─── ui/src/components/Sidebar.tsx:88-98 ───
[Accessibility / Keyboard] The invisible overlay button covering each conversation row can conflict
with keyboard focus and screen-reader semantics: the absolute `<button>` has `aria-label` and
`aria-current`, but the visible container contains interactive buttons that are positioned above it
(z-10) while the row itself is not focusable. This creates a confusing tab order and may make the
row unclickable via keyboard. Consider making the visible container the interactive element or
restructuring focus handling.



─── ui/src/components/SkillsPane.tsx:66-90 ───
The mount-only `useEffect` with an empty dependency list captures the initial `settings` value from
the render closure. If the settings store hydrates asynchronously, `settings` can be `null` on mount
and `handleScanGlobal` returns early, so the global scan is never retried. Additionally, `skills` is
read from the stale render closure inside `handleScanGlobal`, which can cause deduplication to run
against an empty or outdated list and result in duplicate global skills. Consider triggering the
scan when `settings` becomes available (e.g., by including `settings` in the effect dependencies or
by using a store subscribe pattern) and reading the latest skills state from the store inside the
callback.



─── ui/src/components/SkillsPane.tsx:80-84 ───
Global skill scan failures are only logged with `console.error`; there is no UI feedback. The user
only sees the spinner stop, with no indication that discovery failed or how to retry. Surface the
error in the UI (toast, inline alert, etc.) and provide a retry action.



─── ui/src/components/SkillsPane.tsx:76-78 ───
`save` is likely an asynchronous store action, but it is invoked without `await` and without error
handling. If persistence fails the user has no indication, and `setScanning(false)` may run before
the save completes. Use `await save(...)` inside the `try` block and handle failures consistently.



─── ui/src/components/SkillsPane.tsx:278-295 ───
`size='icon-sm'` is not a standard shadcn/ui Button variant size and is likely to produce a
TypeScript error or leak the non-standard prop to the underlying DOM element (React warning).
Additionally, these icon-only buttons lack accessible labels (`aria-label`), relying only on
`title`. Extend the Button variants to include a small icon size if needed, and add `aria-label` for
screen readers.



─── ui/src/components/SkillsPane.tsx:258-260 ───
`py-0.2` is not a valid Tailwind spacing scale value (the standard scale includes `0`, `0.5`, `1`,
etc.), so it will be silently ignored and produce inconsistent vertical padding on the source badge.
Use a standard class such as `py-0.5` or an arbitrary value like `py-[2px]`.



─── ui/src/components/SkillsPane.tsx:101-108 ───
`handleDelete` immediately persists the deletion without confirmation. This makes it easy to
accidentally remove built-in/global skills that may be hard to restore. Show a confirmation dialog
before calling `save`.



─── ui/src/components/SkillsPane.tsx:131-133 ───
The slash command is generated from user input or the skill name but is never checked for uniqueness
against existing skills. Multiple skills with the same slash command can cause ambiguous trigger
behavior. Validate uniqueness before saving and warn the user.



─── ui/src/components/PromptsPane.tsx:48-68 ───
`save` is declared as `async (next: Settings) => Promise<void>` in the settings store, but
`handleSave` calls it without `await` and immediately closes the dialog (`setModalOpen(false)`).
This creates a floating promise: persistence failures are silently swallowed, the user gets no error
feedback, and the dialog is already closed. Additionally, the Save button remains enabled, so rapid
clicks can submit multiple times. Make `handleSave` async, `await save(...)`, and wrap it in
`try/catch` to surface errors and only close the dialog on success.



─── ui/src/components/PromptsPane.tsx:59-63 ───
New prompt IDs are generated with `prompt-${Date.now()}`. If the user clicks rapidly or tests run
quickly, two prompts can share the same millisecond timestamp, producing duplicate React `key`
values and ambiguous edit/delete targets. Use a stronger unique ID generator such as
`crypto.randomUUID()` or a project-specific id utility.



─── ui/src/components/PromptsPane.tsx:29-32 ───
`handleDelete` immediately removes the prompt from persisted settings with no confirmation dialog,
undo path, or safeguard against misclicks. It also calls the async `save` without `await` or error
handling, so a persistence failure would be silent. Add a confirmation step and await/catch the save
promise before treating the deletion as successful.



─── ui/src/components/PromptsPane.tsx:135-154 ───
The `Label` components are not associated with their inputs: they have no `htmlFor` prop and the
`Input`/`textarea` have no `id`. This breaks label-click focus and hinders screen-reader
association. Add matching `htmlFor` and `id` values (e.g. `htmlFor="prompt-name"` and
`id="prompt-name"`).



─── ui/src/components/PromptsPane.tsx:48-51 ───
The save logic does not enforce prompt name uniqueness. Since prompts are referenced by name via
`/prompt <name>`, allowing duplicate names makes lookup ambiguous. Add a uniqueness check before
saving, accounting for the current prompt when editing (i.e. allow keeping the same name but reject
a name already used by another prompt).



─── ui/src/components/ThinkingBar.tsx:11-15 ───
Bug: `if (!ms)` treats a legitimate `0` ms duration as absent. A reasoning duration of `0` will
display as 'Reasoning Process' instead of '0ms'. Use explicit null/undefined checks (`ms === null ||
ms === undefined`) instead of a falsiness check.



─── ui/src/components/ThinkingBar.tsx:18-28 ───
Bug: The comment states 'A manual toggle still overrides this', but the `useEffect` unconditionally
collapses the bar whenever streaming finishes (`setOpen(false)`), regardless of whether the user
manually expanded it during streaming. Track a manual-override flag if the intent is to honor user
toggles, or update the comment to match the actual behavior.



─── ui/src/components/ThinkingBar.tsx:86-90 ───
Data-integrity bug: Only the first `<think>` block is captured into `reasoning`, but the replacement
strips all `<think>...</think>` blocks from `cleanedContent`. If the model emits multiple reasoning
blocks, the later ones are silently discarded from both outputs. Consider extracting all blocks or
keeping all reasoning concatenated.



─── ui/src/components/ThinkingBar.tsx:90-97 ───
Edge-case bug: An unclosed `<think>` tag is only handled when it begins the string. If a partial
`<think>` appears mid-content, the raw markup and its reasoning leak into `cleanedContent`. Consider
handling an unclosed tag anywhere in the text if no closing tag exists.



─── ui/src/components/ThinkingBar.tsx:86-90 ───
Inconsistency: The closed-tag regex uses the case-insensitive `i` flag, but the unclosed-tag branch
uses case-sensitive `startsWith('<think>')`. An unclosed uppercase variant (e.g., `<THINK>`) will be
missed. Align the case handling between both branches.



─── ui/src/components/ui/input.tsx:4-9 ───
The component is a plain function component and does not forward refs. This causes a React warning
when consumers pass a ref (e.g., from form libraries like React Hook Form, focus management, or
accessibility tools) and breaks functionality that depends on direct DOM access. Wrap the component
with React.forwardRef so that refs are forwarded to the underlying <input> element.



─── ui/src/components/StreamingBubble.tsx:17-21 ───
**Hardcoded business/markup marker.** The string `<think>` is hardcoded here as the heuristic for
detecting embedded reasoning content. This marker is a business/protocol-level detail; it should
live in a shared constant or configuration so it can be updated or localized in one place. Pre-scan
focus area confirmed.



─── ui/src/components/StreamingBubble.tsx:13-23 ───
**Wrong active-state during streaming for extracted reasoning.** `isThinkingActive` is set to
`hasReasoning && !displayText`, so when reasoning is extracted from the text because it contains
`<think>` (not the `streaming.reasoning` field), `hasReasoning` is `false`, making
`isThinkingActive` always `false`. As a result, `ThinkingBar` will display a completed 'Reasoning
Process' label instead of the 'Thinking...' streaming state while the model is still emitting
reasoning tokens. The active-streaming state should also be true when extracted reasoning is present
and the answer text has not started yet.



─── ui/src/components/ui/label.tsx:5-17 ───
Label is a wrapper around a Radix primitive but does not forward refs. Consumers passing a ref
(e.g., for focus management, form libraries, or accessibility tools) will have the ref dropped
instead of reaching the underlying <label> element. Use React.forwardRef so the ref is consistently
forwarded across React versions and does not rely on React 19's ref-as-prop behavior.



─── ui/src/components/ui/dialog.tsx:6-8 ───
Dialog, DialogTrigger, DialogPortal, DialogOverlay, DialogContent, and DialogTitle are plain
function components that spread `{...props}`. In React 18, `ref` is not included in props, so any
ref passed to these wrappers is silently dropped instead of being forwarded to the underlying Radix
primitive. This breaks imperative access (focusing the trigger/content, measuring the overlay, etc.)
and can cause runtime warnings. These components should be wrapped with `React.forwardRef` so refs
are forwarded correctly. (DialogHeader and DialogFooter are plain `<div>` wrappers; while less
critical, forwarding refs there is also recommended for consistency.)



─── ui/src/components/ui/dialog.tsx:14-16 ───
`DialogPortal` is exported as a public component, but `DialogContent` unconditionally renders its
own `<DialogPortal>` around the overlay and content. This means consumers who compose
`<DialogPortal><DialogContent /></DialogPortal>` will create nested portals, which can lead to
unexpected rendering and event-bubbling behavior. In addition, `DialogContent` cannot customize
portal behavior (e.g., passing a `container` prop). Consider either removing `DialogPortal` from the
public API or changing `DialogContent` to accept/forward portal-related props rather than hardcoding
its own portal.



─── ui/src/components/ui/dialog.tsx:94-105 ───
`DialogDescription` is optional and `DialogContent` does not enforce or provide a default
description. Radix Dialog expects an accessible description and will log a runtime accessibility
warning when `DialogContent` is used without a `DialogDescription`, leaving `aria-describedby`
unresolved. Consider making the description required in the component contract, rendering a default
visually-hidden description, or documenting that consumers must supply one to avoid a11y warnings.



─── ui/src/components/StreamingBubble.tsx:32-39 ───
**Potentially empty visible body rendered.** If `displayReasoning` and `displayText` are both falsy
(for example, the stream has produced only whitespace or the `<think>` tag with no content yet), the
component still renders the 'Assistant' header, the pulsing dot, and the live status region, but no
visible reasoning or answer text. This produces an awkward UI state where the assistant row appears
to be doing nothing. Consider guarding the whole bubble or providing a placeholder when no
displayable content exists.



─── ui/src/components/ui/dropdown-menu.tsx:1-2 ───
This component wraps Radix UI primitives, which rely on client-side React hooks, context, and DOM
event handling. If the project uses React Server Components (e.g., Next.js App Router), this file
must include a `"use client"` directive at the top; otherwise, consuming these components from a
server component will fail at runtime.



─── ui/src/components/ui/dropdown-menu.tsx:62-78 ───
The `checked` prop is destructured only to be passed explicitly, while the remaining `...props` are
also spread. This is redundant because `checked` is already included in `props`. Either remove
`checked` from the destructuring and rely on `{...props}`, or remove `{...props}` and pass only the
explicitly destructured props to keep the intent clear.



─── ui/src/components/ui/dropdown-menu.tsx:180-196 ───
`DropdownMenuContent` and `DropdownMenuSubContent` use nearly identical className strings, differing
only in `shadow-md` vs `shadow-lg`. This duplication is a maintenance risk if animation or styling
requirements change. Consider extracting a shared base class constant and merging it with the
variant-specific shadow class to keep the two surfaces in sync.



─── ui/src/components/ui/dropdown-menu.tsx:14-25 ───
Uses newer Tailwind syntax: `origin-(--radix-dropdown-menu-content-transform-origin)` requires
Tailwind v3.4+/v4 CSS-variable origin support, and `outline-hidden` requires Tailwind v3.4+. If the
project's Tailwind version is older, these utilities will be emitted as literal class names and
silently break the animation origin and focus outline behavior. Verify the installed Tailwind
version supports these classes.



─── ui/src/components/StreamingBubble.tsx:45-47 ───
**Live region toggle may flood assistive technology.** The status region uses `aria-live="polite"
role="status"` but its text is recomputed on every render. Although the *text* is stable ('Assistant
is responding' / 'Assistant is thinking'), React will still queue a live-region announcement each
time the element re-renders or when `displayText` flips between truthy and falsy. With 25Hz
streaming updates this can create repeated announcements. Consider debouncing updates or moving the
announcement outside the streaming subtree so it only announces once per state transition.



─── ui/src/components/ToolCallCard.tsx:30-53 ───
The outer expand/collapse control is a native `<button>` that contains a shadcn/ui `<Button>` (which
also renders a `<button>`). Nesting interactive elements is invalid HTML and produces unreliable
behavior for screen readers, keyboard focus, and pointer events. Even with `stopPropagation`, nested
buttons can prevent proper click handling and violate accessibility rules. Consider making the outer
toggle a `div` with `role="button"` and `tabIndex`, or moving the copy action outside the outer
button.



─── ui/src/components/ToolCallCard.tsx:23-26 ───
`handleCopy` calls `copy(...)` but never awaits the result or catches a rejection. The underlying
`useCopyFeedback` helper also swallows `navigator.clipboard.writeText` with `void`, so a permission
denial, transient write failure, or browser policy block gives the user no feedback and may leave
the transient "copied" state incorrect. Surface the promise to the user, disable the button while
copying, or at least catch and report errors.



─── ui/src/components/ToolCallCard.tsx:145-148 ───
`extractToolCalls` returns `cleanedText` that still contains the original LLM output minus only the
matched tool/atem tags. A consumer that renders this string as HTML (rather than as escaped
text/React children) is vulnerable to injection. Since this is a utility whose callers may not all
use React text nodes, consider sanitizing the returned `cleanedText` or documenting that it must be
rendered as text/escaped before insertion into HTML.



─── ui/src/components/ToolCallCard.tsx:96-100 ───
The parameter regex relies on an early-terminating alternation
(`(?:</parameter>|(?=<parameter=|$))`) instead of proper XML parsing. This can split a parameter
value incorrectly when it contains nested-looking tags, unescaped markup, or malformed input,
merging or truncating values and compromising data integrity. Similarly, the `<atem:function_calls>`
branch treats an entire block containing multiple `<atem:invoke>` calls as a single tool call.
Consider using a real XML/DOM parser for user-provided tool-call markup, or at least add unit tests
and documented limitations for these regexes.



─── ui/src/components/ToolCallCard.tsx:30-34 ───
The outer toggle button lacks `aria-expanded` and an accessible name/aria-label, so screen-reader
users cannot tell that it expands/collapses content or what it controls. The inner copy button has
only a `title` attribute, which is not consistently exposed to assistive technologies. Add
`aria-expanded={expanded}`, an `aria-label` such as `Show details for {toolCall.name}`, and an
`aria-label="Copy tool arguments"` to the copy `Button`.



─── ui/src/components/ui/separator.tsx:5-25 ───
The component does not forward refs to the underlying Radix primitive. Since
`SeparatorPrimitive.Root` supports refs and consumers of a low-level UI primitive may reasonably
expect to obtain a DOM reference for focus management, scrolling, layout measurement, or testing,
the wrapped component should use `React.forwardRef`. Without it, passing `ref` will silently fail or
produce a TypeScript error because the props type is `ComponentProps` rather than
`ComponentPropsWithRef`. Fix by converting `Separator` to `React.forwardRef(SeparatorPrimitive.Root,
(props, ref) => …)` or assigning `Separator.displayName`.



─── ui/src/components/ui/separator.tsx:8-15 ───
Defaulting `decorative` to `true` hides the separator from assistive technologies. This is
acceptable for purely visual dividers, but if the component is ever used to separate meaningful
regions (e.g., between navigation groups or form sections), screen-reader users will lose the
structural semantics. Consider whether the default should remain `true` (consistent with Radix's own
default) or whether the wrapper should expose clearer documentation. At minimum, consumers should be
able to override `decorative` and provide `aria-label` when `decorative={false}`, which the current
prop spreading already allows. No code change is strictly required, but verify the default matches
the project's accessibility intent.



─── ui/src/components/ui/textarea.tsx:4-7 ───
**Missing ref forwarding.** The props type `React.ComponentProps<'textarea'>` includes `ref`, but
because this is a regular function component, any `ref` passed by a consumer is silently ignored and
never reaches the underlying `<textarea>` DOM node. This breaks legitimate use cases such as form
libraries (e.g., React Hook Form), auto-resize hooks, or parent components that need to focus/scroll
the element. Convert the component to use `React.forwardRef` so that refs are forwarded to the
native textarea.



─── ui/src/components/ui/button.tsx:33-49 ───
The Button component is not wrapped with `React.forwardRef`. As a low-level primitive that is
frequently composed inside forms, dialogs, tooltips, and other Radix components, the ref is dropped
whenever `asChild` is not used and cannot be forwarded to a custom child element. This breaks
library expectations and accessibility patterns (e.g., focus management). Convert the component to a
`forwardRef` component.

Example fix:
```tsx
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        data-slot="button"
        className={cn(buttonVariants({ variant, size, className }))}
        ref={asChild ? undefined : ref}
        {...props}
      />
    )
  },
)
```



─── ui/src/components/ui/button.tsx:33-49 ───
The `size` prop is part of the public variant API but is not passed through to `data-slot` or used
as a DOM attribute, which is fine. However, when `asChild={true}`, the `size` variant value remains
in the merged class string only; any child-provided `size` prop will conflict with the Button's
`size` variant value. More importantly, the current `Button` accepts `asChild` without a separate
display name, so the component name will be lost in React DevTools. Add `Button.displayName =
'Button'` for better debugging, especially when used polymorphically.



─── ui/src/components/ui/button.tsx:10-12 ───
The base style uses `outline-none` and relies entirely on `focus-visible:ring-ring`. In `index.css`,
`--ring` maps to the brand green (`--accent` #3fd55a). In light mode `--primary` is the same green
with `--primary-foreground` white, so the focus ring color matches the default button background;
depending on the monitor/viewport, the ring may have low contrast against the default primary fill.
Consider using a higher-contrast ring (e.g., `ring-foreground` or an offset ring) for the default
variant, or verify the design visually with keyboard-only users.



─── ui/src/components/ui/sonner.tsx:12-19 ───
Security / Type safety risk: A parent component can override the store-derived theme because
`{...props}` is placed after the explicit `theme` prop. This means `<Toaster theme="dark" />` would
bypass the theme store entirely and apply an arbitrary theme value, defeating the app-wide theming
guarantee. If the design intent is for the store to be the single source of truth for the
application toaster, the explicit `theme={...}` should be moved after `{...props}` so the store
value always wins.

Suggested fix: place `{...props}` before the explicit `theme` prop, or explicitly destructure and
omit `theme` from props.



─── ui/src/components/ui/sonner.tsx:12-18 ───
Maintainability risk: `style` is typed by casting to `CSSProperties`, but the injected CSS custom
properties (`--normal-bg`, etc.) are not declared anywhere in the file. This relies on the consuming
application (e.g. Tailwind CSS variables) providing those variables. While common in this stack, the
component has no fallback, so missing variables will silently produce unstyled toasts. Consider
adding fallbacks or documenting the contract.



─── ui/src/components/ui/tooltip.tsx:12-18 ───
Issue: TooltipProvider is nested inside every Tooltip instance, creating redundant contexts. Radix
UI recommends a single shared TooltipProvider at the application level so that global settings
(delayDuration, skipDelayDuration, disableHoverableContent) work consistently. Nesting a Provider
inside each Tooltip means sibling tooltips will not share state (e.g., the skip delay when moving
between triggers) and may produce unexpected timing behavior. Recommend removing the Provider from
Tooltip and exporting a top-level TooltipProvider that app shells use once.



─── ui/src/components/ui/tooltip.tsx:12-22 ───
Issue: delayDuration is hardcoded inside the internal TooltipProvider, but it is not a valid prop of
TooltipPrimitive.Root, so callers have no way to customize the open delay per Tooltip. Radix allows
delayDuration on Provider, not Root. If a project wants per-tooltip delays, an explicit prop should
be threaded through or the Provider should be exposed for configuration at the app level.



─── ui/src/components/ui/tooltip.tsx:20-47 ───
Issue: TooltipTrigger and TooltipContent are plain functional components that do not forward refs.
Consumers or design-system integrations may pass refs to the trigger (e.g., for focus management,
measure refs, or form libraries) or to the content (e.g., popper/scroll containers). Without
React.forwardRef those refs are silently dropped, which breaks accessibility and integration
expectations. Both components should be wrapped with React.forwardRef.



─── ui/src/components/ui/switch.tsx:5-27 ───
Accessibility: The Switch is an interactive form-like control, but the component does not enforce or
document that callers must provide an accessible name. Without an associated visible label or an
explicit `aria-label`/`aria-labelledby`, screen-reader users will encounter an unlabeled toggle.
Consider requiring a label prop or clearly documenting that consumers must supply accessible
labeling via Radix Root props.



─── ui/src/main.tsx:7-13 ───
Critical reliability issue: `initTheme()` runs at module load time and mutates localStorage / DOM
state. If it throws for any reason (corrupted localStorage data, quota exceeded, script error,
etc.), the subsequent `createRoot(...).render(...)` call never executes and the entire application
fails to mount. Wrap this call in a `try/catch` block and fall back to the default theme so that a
theme initialization failure cannot brick the whole UI.



─── ui/src/main.tsx:13-17 ───
Runtime null-safety violation: the non-null assertion `!` on `document.getElementById('root')`
bypasses the required null check required by the checklist. If the `#root` container is missing or
renamed, `createRoot` will throw a TypeError at runtime. Replace the assertion with an explicit null
check and surface a clear error message before attempting to render.



─── ui/src/main.tsx:13-17 ───
Missing root-level ErrorBoundary: an unhandled render error anywhere inside `<App />` will propagate
and cause React to unmount the entire root, leaving the user with a blank screen and no feedback.
Add an ErrorBoundary around `<App />` so that runtime rendering errors degrade gracefully instead of
destroying the whole UI.



─── ui/src/components/ui/select.tsx:1-2 ───
Add a `'use client'` directive at the top of this file. It imports `@radix-ui/react-select`
primitives that access the DOM and attach client-side event handlers, so it will fail under React
Server Components without the directive.



─── ui/src/components/ui/select.tsx:6-16 ───
These wrappers are plain functions whose props type (`React.ComponentProps`) includes `ref`. In
React versions prior to 19, refs passed to function components are dropped at runtime and usually
trigger a console warning. Convert all Select subcomponents to `React.forwardRef` so refs reach the
underlying Radix primitives.



─── ui/src/components/ui/select.tsx:80-80 ───
The arbitrary CSS-variable shorthand (`max-h-(--radix-select-content-available-height)`,
`origin-(--radix-select-content-transform-origin)`) is Tailwind CSS v4 syntax. In Tailwind v3 these
classes are silently ignored because the parser expects bracket notation such as
`max-h-[var(--radix-select-content-available-height)]` and
`origin-[var(--radix-select-content-transform-origin)]`. Verify the project's Tailwind version.



─── ui/src/components/ui/select.tsx:95-95 ───
These utilities use Tailwind v4's CSS-variable shorthand (`h-(--radix-select-trigger-height)`,
`min-w-(--radix-select-trigger-width)`). Under Tailwind v3 they are ignored, so the viewport will
not match the trigger dimensions. Use v3-compatible bracket notation
(`h-[var(--radix-select-trigger-height)]`, `min-w-[var(--radix-select-trigger-width)]`) if the
project is on v3.



─── ui/src/components/ui/select.tsx:52-52 ───
`shadow-xs` is not part of the default Tailwind v3 shadow scale (sm/md/lg/xl/2xl). If the project
uses Tailwind v3, this shadow utility will be missing and the trigger will render without the
intended shadow.



─── ui/src/components/ui/select.tsx:117-117 ───
`outline-hidden` is a Tailwind CSS v4-only utility. On Tailwind v3 it is ignored silently, leaving
the browser's default focus outline visible. Use `outline-none` if the project is on Tailwind v3.



─── ui/src/components/ui/select.tsx:123-127 ───
The `CheckIcon` is `size-4` (16px) but its containing span is only `size-3.5` (14px). The icon
overflows its wrapper and may be clipped or visually misaligned, especially because the parent
`SelectPrimitive.Content` has `overflow-hidden`. Make the wrapper `size-4` or the icon `size-3.5` to
keep them consistent.



─── ui/src/routes/Chat.tsx:40-55 ───
Global keyboard shortcuts intercept Ctrl/Cmd+B, M, and comma on `window` without checking whether
the user is currently typing in an input, textarea, or contenteditable element. This means common
composer text-editing shortcuts (e.g., Ctrl+B for bold) will unexpectedly toggle the sidebar or
mind-map panel instead of being handled by the composer. Add a guard that returns early when
`document.activeElement` is an editable element, or scope the listener to a container that excludes
the composer.



─── ui/src/routes/Chat.tsx:57-61 ───
The `setTimeout` clearing `targetMessageId` is neither stored nor cancelled. If `Chat` unmounts
within 300ms, `setTargetMessageId` will be called on an unmounted component. Also, selecting another
message before the previous timeout fires leaves a stale timer that can clear the newly selected
target prematurely. Store the timer in a ref (`useRef`), clear the previous timer before scheduling
a new one, and cancel it in a cleanup effect.



─── ui/src/routes/Chat.tsx:20-22 ───
`localStorage` access is unguarded. Both the lazy initializer (`localStorage.getItem`) and the
effect (`localStorage.setItem`) can throw in private browsing, when storage is disabled, or when
quota is exceeded, causing the component to crash. Wrap `getItem` and `setItem` in `try/catch`
blocks and fall back to the default visible state.



─── ui/src/routes/Chat.tsx:27-29 ───
Writing the collapsed state on every toggle is also unguarded and can throw when storage is
unavailable or full.



─── ui/src/routes/Chat.tsx:31-38 ───
Restoring focus relies on the magic DOM id `'composer-textarea'`, tightly coupling `Chat.tsx` to
`Composer`'s internal implementation. If the id changes, focus restoration silently breaks. Prefer
exposing a focus method or ref from `Composer` (e.g., via `useImperativeHandle` or a forwarded ref)
and have `Chat` call it, or let `Composer` manage its own auto-focus when it mounts with an active
conversation.



─── ui/src/routes/Settings.tsx:320-334 ───
Race-prone persistence and unhandled save errors in ProviderDetail. `persist` reads the current
`settings` snapshot, mutates the providers array, and awaits `save`; rapid consecutive edits
(adding/removing models, toggling enabled, blur updates) can interleave and overwrite each other.
Additionally, `handleTest` awaits `persist` outside its try/finally block, so a rejected `save` will
leave `testing` stuck as `true` and the button permanently disabled. Wrap `save`/`persist` in
try/catch, surface an error state to the user, and consider using an updater function or
optimistic/pessimistic locking from the store instead of read-modify-write.



─── ui/src/routes/Settings.tsx:160-177 ───
AddProviderDialog derives the provider id only from the display name with no uniqueness or
URL-format validation. Two providers with similar names (e.g. "My Provider" and "my-provider") will
generate the same slug and can silently collide or overwrite an existing provider. The base URL is
accepted as any non-empty string, so malformed/invalid URLs can be persisted. Validate that the
generated id is unique and that `baseUrl` is a valid HTTP(S) URL before calling `onAdd`, and surface
validation errors in the dialog.



─── ui/src/routes/Settings.tsx:570-573 ───
DefaultModelPane triggers a full `save` IPC write on every provider selection and on every keystroke
of the model input without debouncing or error handling. This serializes the entire settings object
repeatedly, increases IPC overhead, and raises the risk of partial/raced writes. Add a debounced
save for the text input and a try/catch around `save` so the user is notified if persistence fails
instead of leaving the UI out of sync.



─── ui/src/routes/Settings.tsx:639-647 ───
AppearancePane and ContextPane persist settings asynchronously without handling rejections, and
ContextPane uses `void ipc.saveSettings(next)` which silently discards errors. If the IPC write
fails, the in-memory store has already been updated via `setLocalSettings`, so the UI reflects a
state that is not actually persisted. Wrap `save`/`ipc.saveSettings` in try/catch, revert the local
store on failure, and show the user a clear error message. Also note that `handleAccentChange` uses
a non-null assertion (`settings!`) which is brittle if future changes alter the early-return guard.



─── ui/src/routes/Settings.tsx:589-595 ───
DefaultModelPane triggers a full settings save on every keystroke of the default model input without
debouncing or error handling. This causes repeated full-settings IPC writes (which can be large when
skills are populated) and can race with other persistence calls. Use a debounced save, and handle
`save` rejections by surfacing an error to the user so the UI does not silently diverge from
persisted state.



─── ui/src/routes/Settings.tsx:631-637 ───
ContextPane's async persistence silently discards errors. `applyLive` calls `setLocalSettings(next)`
optimistically, then `debouncedPersist` invokes `void ipc.saveSettings(next)` which swallows
rejections. If the IPC write fails, the in-memory store shows the new value while disk remains
stale, and the user is never notified. Wrap the save in try/catch and revert local state or show a
persistent error on failure.



─── .github/FUNDING.yml:3-3 ───
The `github` sponsorship entry still contains the literal placeholder `[your-username]`. This will
not resolve to a valid GitHub Sponsors account, so the repository's "Sponsor" button will be broken
or missing until it is replaced with the actual maintainer or organization username. Please update
it with the real GitHub username (and remove the square brackets if only a single username is
intended, since the value is accepted as either a plain string or an array).



─── .github/workflows/ci.yml:1-12 ───
Security: Missing least-privilege `permissions`. The workflow has no `permissions` key, so all jobs
inherit the repository's default token with broad write access. For a CI workflow that only needs to
read code and post statuses, add `permissions: contents: read` at the workflow level (and grant only
the specific permissions each job requires).



─── .github/workflows/ci.yml:17-21 ───
Security/Supply-chain: Third-party actions are not pinned to immutable commit SHAs.
`dtolnay/rust-toolchain@stable` and `oven-sh/setup-bun@v1` resolve mutable branches/tags, so a
compromised or broken release can be silently injected. Pin each to a full commit SHA (e.g.,
`dtolnay/rust-toolchain@<sha>` and `oven-sh/setup-bun@<sha>`) and use comments to note the versions.



─── .github/workflows/ci.yml:12-17 ───
Reliability: None of the jobs set `timeout-minutes`. A hanging cargo build/test or `bun install` can
consume runner resources indefinitely and block later workflow runs. Add `timeout-minutes` to every
job (e.g., 10-15 minutes for fmt/clippy/typecheck/lint, 20-30 minutes for test and build-frontend).



─── .github/workflows/ci.yml:3-10 ───
Reliability: Missing `concurrency` control. Without a concurrency group and `cancel-in-progress:
true`, rapid pushes or PR updates will queue redundant overlapping CI runs, wasting resources and
possibly producing stale results. Add a `concurrency` block keyed by `github.workflow` and
`github.ref`.



─── .github/ISSUE_TEMPLATE/bug_report.yml:1-4 ───
The template auto-assigns the `bug` label, but it is not possible to verify from this file alone
that the `bug` label has been created in the repository. If the label is missing, GitHub will still
create the issue but won't apply the label automatically, which defeats the auto-categorization
purpose. Consider documenting or creating the `bug` label in repository settings.



─── .github/ISSUE_TEMPLATE/bug_report.yml:18-26 ───
The `Operating System` dropdown only lists Windows, macOS, and Linux. Users on unsupported platforms
(e.g., FreeBSD, ChromeOS, Web, or mobile) will be forced to choose an inaccurate option or leave the
required field in an invalid state. Adding an `Other (specify in description)` catch-all option
improves data quality and user experience.



─── .github/dependabot.yml:58-63 ───
The root npm config updates only `@tauri-apps/cli`, which is declared as a `devDependency` in
`package.json`. However, unlike the Cargo and `/ui` npm configs, this entry does not define
`prefix-development`. As a result, Dependabot will fall back to `chore(deps):` for dev dependency
updates, producing inconsistent commit prefixes across the repository and potentially breaking
release-note categorization that relies on `chore(deps-dev):`. Add `prefix-development:
"chore(deps-dev):"` to align with the other ecosystems.



─── ui/.gitignore:10-13 ───
Security: sensitive environment files are not ignored. The file only ignores `*.local` but does not
ignore `.env`, `.env.*`, or `.env.*.local`, which risks accidentally committing API keys, database
credentials, or other secrets to version control. Consider adding `.env`, `.env.*`, and
`!.env.example` (if an example file is intentionally tracked).



─── ui/.gitignore:11-13 ───
Maintainability: common generated artifact directories are not ignored. Depending on the toolchain,
outputs such as `coverage/`, `.cache/`, `.temp/`, `.turbo/`, `.vercel/`, `.netlify/`, or
framework-specific directories (e.g. `.next/`, `.nuxt/`, `.svelte-kit/`) may be produced during
development or CI. Review the project's tooling and add the relevant directories to keep the working
tree clean and avoid committing build/test artifacts.



─── .gitignore:1-4 ───
Ignoring Cargo.lock is appropriate for libraries, but for a Tauri application (a binary crate) it
removes reproducible release builds and makes CI/builds depend on the latest compatible dependency
versions. Unless this is a workspace library, consider committing Cargo.lock and removing this line.



─── .gitignore:6-8 ───
The Tauri-specific `**/*.rs.bk` rule duplicates the global Rust rule above it. Removing the
redundant line improves maintainability.



─── .gitignore:34-37 ───
Only .env variants are ignored. If the project uses TLS keys, API secrets, or credential files
(e.g., *.pem, *.key, *.p12, credentials.json, secrets.toml, id_rsa), they are not protected from
accidental commits. Consider adding broader secret/credential patterns.



─── .gitignore:6-8 ───
src-tauri/target/ already covers most Tauri build outputs, but generated mobile project directories
(e.g., src-tauri/gen), sidecar binaries (src-tauri/binaries/ or sidecars/), and per-platform bundle
intermediates may still be committed if the project uses them. Verify these outputs are
intentionally tracked or add explicit ignore patterns.



─── .gitignore:52-56 ───
This list should match the AI tools the team actually uses; .vscodeignore is for VS Code extension
packaging rather than an AI agent. Consider adding common agent ignore files such as .aiderignore
and .claudeignore, and remove .vscodeignore if it is not relevant.



─── Makefile:0-0 ───
The `help` text claims `make install` installs Rust dependencies (via cargo), but the recipe only
installs JavaScript dependencies with `bun install`. New contributors may therefore have a missing
Rust toolchain or un-fetched crates when they later run `make build` or `make test`. Either add a
Cargo step such as `cargo fetch --manifest-path src-tauri/Cargo.toml` to the recipe, or update the
help message so it does not promise Rust dependency installation.



─── Makefile:37-40 ───
This target has several correctness/maintainability issues:
1. The binary path `./target/debug/chat-studio.exe` is Windows-only; on macOS and Linux the
executable is `./target/debug/chat-studio`, so `make dev-stable` will fail on non-Windows platforms.
2. The Vite process is backgrounded with `&` but never terminated, so repeated invocations or an
exiting app leave orphaned dev-server processes running.
3. `sleep 2` is a fragile, racy way to wait for Vite startup; on slower machines the Tauri binary
may launch before the frontend server is actually listening.

Consider making the binary path platform-aware, polling the Vite port for readiness instead of
sleeping, and adding a shell trap/wait to kill the backgrounded Vite process when the app exits.




──────── Project Summary ────────

### Top Issues

1. **Build is blocked by invalid npm versions and toolchain conflicts**
   - `ui/package.json` pins `lucide-react` to `^1.x`, but that package has no stable 1.x release; use a valid `^0.x` version.
   - `typescript` is set to `~6.0.2`, which is not a known stable release, so `tsc`-based scripts will fail.
   - `esbuild` is declared directly while Vite 8.2.0 manages its own esbuild, inviting binary/transform mismatches.
   - `ui/vite.config.ts` exposes all `TAURI_*` env vars to bundled client code, including signing secrets, and does not validate `TAURI_DEV_HOST` or document the Node 20.11+ requirement for `import.meta.dirname`.

2. **MCP allows arbitrary command/network execution**
   - `src-tauri/src/mcp/mod.rs` forwards untrusted `command`, `args`, and `env` to subprocesses and HTTP headers with no allow-list or validation, creating command-injection risk.
   - `src-tauri/Cargo.toml` enables the `process` feature of `tokio` and depends on `open = "5"`; any user-influenced path or URL passed to these must be validated first.

3. **Database operations are non-atomic and under-validated**
   - `src-tauri/src/db.rs` performs multi-statement mutations (migrations, `clear_messages`, `insert_message`, `edit_message`, `delete_message`, `set_message_flag`) as separate autocommit statements; partial failures will leave the DB inconsistent.
   - `debug_assert!(message_id > 0)` is stripped in release builds, so a non-positive id turns targeted deletions into full conversation wipes.
   - `set_message_flag` writes the caller-supplied string directly without enforcing the documented `"normal" | "pinned" | "excluded"` domain.

4. **Synchronous locks and blocking shutdowns on the async runtime**
   - `src-tauri/src/state.rs` exposes `std::sync::Mutex` guards, and commands that `.await` while holding them can deadlock Tauri worker threads.
   - `src-tauri/src/main.rs` uses `.unwrap()` on mutex locks (abort on poison) and a `block_on` MCP shutdown with no timeout, which can hang process exit.
   - `src-tauri/src/mcp/mod.rs` shuts down sessions while holding the `sessions` lock, blocking all other manager operations.

5. **Provider streaming is unbounded, silent, and insecure**
   - Across `src-tauri/src/providers/anthropic.rs`, `gemini.rs`, `openai.rs`, `ollama.rs`, `openai_compat.rs`, and `mod.rs`: no explicit request or idle timeouts, unbounded `LineSplitter` buffers, full error bodies loaded into memory before `MAX_ERROR_BODY` is applied, and usage returned even when trailing frames are corrupted.
   - `anthropic.rs` lets `extra_headers` override security-critical headers such as `x-api-key` and `anthropic-version`.
   - SSE parsing does not concatenate multi-line `data:` events and silently drops `event: error` payloads.

6. **MCP session cache has races and resource leaks**
   - `src-tauri/src/mcp/mod.rs` has a check-then-act race in `get_or_spawn` that can spawn duplicate child processes.
   - Cache key is only `server_id`, so configuration changes are silently ignored.
   - HTTP transports launch detached reconnect loops with no cancellation token or backoff, and `shutdown()`/`shutdown_all()` cannot stop them.

7. **Settings/theme file I/O is non-atomic and trust-unsafe**
   - `src-tauri/src/config.rs` writes `settings.toml` in place, then adjusts permissions, leaving a window for truncated/corrupt files, and does not recover from a failed quarantine rename.
   - `src-tauri/src/themes.rs` uses `path.exists()` + `fs::write()` (TOCTOU), follows symlinks, and converts structured errors into plain strings.

8. **Frontend store actions are racy and swallow failures**
   - `ui/src/store/chat.ts` starts new streams without checking for an active stream, and `cancelStream` relies on a terminal event to clear state.
   - `ui/src/store/settings.ts` leaves `loading` stuck on rejection and mutates the backend before reloading state.
   - `ui/src/routes/Settings.tsx` persists on every keystroke without debouncing or handling rejection.
   - `ui/src/App.tsx` initialization rejects are unhandled.

9. **Core UI primitives are broken for ref/accessibility consumers**
   - Many `ui/src/components/ui/*.tsx` components (`button.tsx`, `input.tsx`, `textarea.tsx`, `label.tsx`, `dialog.tsx`, `select.tsx`, `dropdown-menu.tsx`, `separator.tsx`, `tooltip.tsx`) are plain function components that do not forward refs.
   - `dialog.tsx` renders nested portals and lacks an enforced description, triggering Radix accessibility warnings.
   - `ui/index.html` has no CSP and no `<noscript>` fallback; `ui/src/index.css` has a white-on-green contrast failure.

10. **Context token budget mixes bytes and characters**
    - `src-tauri/src/context.rs` uses `String::len()` (bytes) against `budget_tokens * CHARS_PER_TOKEN`, causing non-ASCII text to over-count.
    - The rolling summary is injected unconditionally, and token totals are computed before normalization, so reported counts can diverge from actual context.

### Module Hotspots

- **`src-tauri/src/mcp/mod.rs`** — races, process/command injection, HTTP task leaks, no backoff, shutdown deadlock.
- **`src-tauri/src/providers/`** (`anthropic.rs`, `gemini.rs`, `openai.rs`, `ollama.rs`, `openai_compat.rs`, `mod.rs`) — streaming timeouts, unbounded buffers, header injection, silent error swallowing, SSE/NDJSON edge cases.
- **`src-tauri/src/db.rs`** — multi-statement autocommit operations, release-only assertions, missing enum validation.
- **`src-tauri/src/config.rs` and `src-tauri/src/themes.rs`** — non-atomic file writes, symlink/TOCTOU issues, fragile migrations.
- **`src-tauri/src/state.rs` / `src-tauri/src/main.rs`** — sync mutex across async, poison handling, blocking shutdown.
- **`ui/src/store/chat.ts` and `ui/src/store/settings.ts`** — stream races, unawaited saves, stuck loading states.
- **`ui/src/routes/Settings.tsx` and `ui/src/components/*Pane.tsx`** — repeated persistence without debouncing/error handling.
- **`ui/src/components/ui/*.tsx`** — ref forwarding and Tailwind-version mismatches.
- **`ui/package.json`, `ui/vite.config.ts`, `ui/index.html`** — build blockers, secret exposure, missing CSP/noscript.

### Cross-Cutting Concerns

- **Unhandled or unawaited async operations** appear throughout the frontend: stores (`chat.ts`, `settings.ts`), `App.tsx`, `AgentsPane.tsx`, `PromptsPane.tsx`, `SkillsPane.tsx`, `McpPane.tsx`, `Sidebar.tsx`, `Settings.tsx`, and `MessageErrorBoundary.tsx`. The pattern is “mutate backend / update local state / ignore the returned promise,” leading to stale UI and unhandled rejections.

- **Low-level UI primitives do not forward refs** across `button.tsx`, `input.tsx`, `textarea.tsx`, `label.tsx`, `dialog.tsx`, `select.tsx`, `dropdown-menu.tsx`, `separator.tsx`, and `tooltip.tsx`. This breaks form libraries, focus management, and testing.

- **Tailwind version mismatches / non-standard utilities** recur in `select.tsx`, `dropdown-menu.tsx`, `MindMapPanel.tsx`, `SkillsPane.tsx`, `ConversationTimeline.tsx`, etc. (`outline-hidden`, `shadow-xs`, `w-4.5`, `py-0.2`, CSS-variable shorthand like `h-(--radix-...)`). These are silently ignored under Tailwind v3.

- **Hardcoded business constants duplicated in multiple places**: `New chat` default title, `general-assistant` fallback agent id, `normal` context flag, `:::` provider/model separator, and the ` thinking` reasoning marker. This makes the frontend fragile when backend defaults change.

- **Accessibility gaps**: low-contrast primary CTA in `ui/src/index.css`, missing `noscript`, global keyboard shortcuts in `ui/src/routes/Chat.tsx` that intercept composer shortcuts, mouse-only handlers in `ConversationTimeline.tsx`, missing `aria-expanded`/labels in `ToolCallCard.tsx`, and live-region issues in `StreamingBubble.tsx`.

- **Security / trust boundaries**: no CSP in `ui/index.html`; `TAURI_*` env vars leaked to client bundle in `ui/vite.config.ts`; arbitrary subprocess execution in `src-tauri/src/mcp/mod.rs`; `open` and `tokio::process` in `src-tauri/Cargo.toml`; unsafe markdown `href` handling in `ui/src/components/MarkdownContent.tsx`; weak secret redaction in `src-tauri/src/providers/mod.rs`.

### Quick Wins

- Fix `ui/package.json`: pin a real `lucide-react` 0.x version, a valid TypeScript version, and remove the explicit `esbuild` dependency.
- Add a CSP meta tag and a `<noscript>` fallback to `ui/index.html`, and wrap the synchronous theme resolver in `try/catch`.
- Convert the `ui/src/components/ui/*.tsx` primitives to `React.forwardRef` in a single pass; add a default `DialogDescription` and remove nested portals.
- Wrap `initTheme()` and `document.getElementById('root')` checks in `ui/src/main.tsx` with `try/catch` and add a root-level ErrorBoundary.
- Make `settings.ts` save/add/remove provider actions `await` the IPC call and reset `loading` in `finally`; debounce `Settings.tsx` persistence.
- Add request and per-frame timeouts to provider streaming code; cap `LineSplitter` buffer length; flush the trailing partial line in `gemini.rs`.
- Replace `db.rs` multi-statement autocommit sequences with transactions and turn the `message_id` `debug_assert!` into a runtime guard.
- Guard `localStorage` access in `ui/src/routes/Chat.tsx` and the theme resolver.
- Add `.env`, `.env.*`, and credential patterns to `ui/.gitignore` and the root `.gitignore`.
- Harden `.github/workflows/ci.yml`: add `permissions: contents: read`, pin third-party actions to commit SHAs, set `timeout-minutes`, and add a `concurrency` group.