# AGENTS.md

Guidance for AI coding agents (and human contributors) working in this repo.

## What this is

Chat Studio - a Tauri v2 desktop chat client for Ollama Cloud, NVIDIA NIM, and OpenRouter
(plus any OpenAI-compatible endpoint added by the user). Rust backend, React 19 +
TypeScript frontend styled with Tailwind v4 + shadcn/ui (Radix primitives), modeled
visually on Cherry Studio.

## Layout

```
chat_studio/
├─ Cargo.toml              # workspace root; release profile (opt-level="z", lto, strip)
├─ package.json            # root: just the tauri CLI, so `bun run tauri ...` works from here
├─ src-tauri/               # Rust backend
│  ├─ tauri.conf.json       # beforeDevCommand/beforeBuildCommand point into ui/
│  └─ src/
│     ├─ main.rs            # Builder setup, invoke_handler registration
│     ├─ commands.rs        # every #[tauri::command] - the whole IPC surface
│     ├─ db.rs               # rusqlite schema + queries (schema version-gated migrations)
│     ├─ config.rs          # settings.toml load/save, built-in provider presets
│     ├─ state.rs           # AppState: db handle, settings, active streams, model cache
│     └─ providers/
│        ├─ mod.rs          # `Provider` trait, StreamEvent, shared LineSplitter
│        ├─ openai_compat.rs # OpenRouter/NIM/custom - SSE parsing
│        └─ ollama.rs        # Ollama's native NDJSON dialect (not OpenAI-compatible)
└─ ui/                       # React frontend (Vite + Bun)
   └─ src/
      ├─ lib/{ipc,types,utils}.ts   # typed invoke() wrappers; types.ts mirrors Rust structs
      ├─ store/{chat,settings,theme}.ts  # zustand stores
      ├─ routes/{Chat,Settings}.tsx      # Settings is React.lazy-split in App.tsx
      └─ components/                    # Sidebar, ChatHeader, Composer, MessageBubble, ui/*
```

## Commands

Use the `Makefile` (`make help` lists everything), or run directly:

```
cd ui && bun install && cd ..    # install JS deps
bun install                       # installs the tauri CLI at the root

bun run tauri dev -- --no-watch   # dev mode (see "tauri dev is flaky" below)
bun run tauri build               # release build + installer

cargo test --manifest-path src-tauri/Cargo.toml   # Rust test suite
cd ui && bun x tsc -b && bun run lint              # frontend typecheck + lint
cd ui && bun run build                             # frontend production build only
```

There is no JS test suite yet - correctness on the frontend is enforced by `tsc` +
`oxlint` + manual verification. Rust logic (SSE/NDJSON parsing, DB queries, schema
migrations) has real unit tests in `#[cfg(test)]` blocks; add to those when touching
`db.rs` or `providers/`.

## Architecture notes worth knowing before changing things

**Provider abstraction.** `providers::Provider` is one trait with two implementations:
`OpenAiCompatProvider` (SSE, used by OpenRouter/NIM/any custom OpenAI-compatible
endpoint) and `OllamaProvider` (newline-delimited JSON, not SSE - Ollama's own
`/api/chat` dialect). Adding a fourth provider that's OpenAI-compatible costs zero
Rust code - it's just another row in `Settings.providers`. A genuinely different wire
format needs a new file next to `ollama.rs`.

**Streaming path.** Provider sends `StreamEvent::Delta` per network chunk into an
mpsc channel. `commands::send_message`'s spawned task coalesces those into ~40ms
batches before emitting a Tauri event to the frontend - this is deliberate, not
incidental: per-token IPC is the main source of jank/CPU burn in Tauri chat apps.
Cancellation and mid-stream errors both still persist whatever text arrived (see
`Outcome` enum in `commands.rs`) - don't "fix" that into discarding partial output.

**Frontend streaming state.** `store/chat.ts` keeps the in-flight message in its own
`streaming` key, separate from `messagesByConversation`. `StreamingBubble` is the only
component that subscribes to it. This is load-bearing: a zustand selector that returns
a fresh array/object literal on every call (e.g. `messagesByConversation[id] ?? []`
instead of a stable `EMPTY_MESSAGES` constant) causes an infinite render loop against
`useSyncExternalStore` - this has actually happened once in this codebase's history.
If you add a new selector like that, use a module-level constant for the fallback.

**DB schema migrations.** `db.rs`'s `SCHEMA_VERSION` gate uses `PRAGMA user_version`.
`CREATE TABLE IF NOT EXISTS` only helps fresh installs; upgrading an existing on-disk
DB needs explicit `ALTER TABLE` guarded by the old version number (see the `pinned`/
`reasoning` column additions for the pattern). Bump `SCHEMA_VERSION` and add a branch,
don't just add columns to the `CREATE TABLE` statement and assume it's enough.

**Theming.** CSS custom properties in `ui/src/index.css`, resolved to a concrete
light/dark value by `store/theme.ts` before first paint (an inline script in
`index.html` sets `data-theme` synchronously, before React even mounts, to avoid a
flash). shadcn's semantic tokens (`--primary`, `--accent`, etc.) are aliased onto the
app's own tokens (`--accent`, `--bg-elevated`, ...) in the same file - note shadcn's
`--accent` means "subtle hover surface", not "brand color"; that's `--primary`.

## Known environment gotchas

- **This project needs an MSVC C toolchain on Windows**, not MinGW - `rusqlite`
  (bundled SQLite) and the TLS backend both compile C/C++ code via `cc`. If `cargo
  build` fails with `gcc.exe`/`dlltool.exe` not found, the fix is installing VS Build
  Tools' "Desktop development with C++" workload and `rustup default
  stable-x86_64-pc-windows-msvc`, not switching dependencies.
- **`tauri dev`'s file watcher can crash the app moments after launch** (exit code
  255) with nothing actually wrong in the code - confirmed by running the same debug
  binary standalone against a Vite dev server with no crash. Always pass `--no-watch`
  first; if it's still flaky, use `make dev-stable` (Vite + the compiled binary run
  directly, bypassing the tauri-cli wrapper entirely).
- **RAM floor is WebView2, not the app.** An idle build measures ~350-400MB across
  the host process + WebView2's process tree; a bare Tauri window is already
  150-250MB before any app code runs. Don't chase a sub-100MB target by optimizing
  frontend code - it's not where the memory is. If a hard low-RAM number is ever a
  real requirement, that's a framework swap (Slint/egui/TUI), not a tuning pass.
- **Bun, not Node/npm.** No `node_modules`-based tooling assumptions - `bun install`,
  `bun run`, `bun x` throughout. The Tauri CLI is installed as `@tauri-apps/cli` via
  bun (prebuilt binary), not `cargo install tauri-cli` (slow, and needs the same MSVC
  toolchain caveat above).

## Conventions

- Provider config field names are snake_case end-to-end (Rust structs, TS types, and
  JSON over IPC) - only Tauri **command arguments** get auto-camelCased by the
  `#[tauri::command]` macro (e.g. Rust `conversation_id` param -> JS calls with
  `conversationId`). Don't rename fields to camelCase thinking it's inconsistent;
  check `ipc.ts` against `commands.rs` before assuming a mismatch is a bug.
- Comments explain *why*, not what - the existing code leans on this deliberately in
  non-obvious spots (coalescing, schema migrations, the empty-array selector gotcha
  above). Match that style rather than describing what a line of code visibly does.
- No test framework is configured for the frontend; don't add one speculatively.
  Backend changes to `db.rs`/`providers/` should come with `#[cfg(test)]` coverage
  matching the existing style (in-memory SQLite for db tests, fixture strings for
  parser tests).
