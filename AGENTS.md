# AGENTS.md

Guidance for AI coding agents (and human contributors) working in this repo.

## Guiding Principles (MUST FOLLOW)

### Mindset

How to approach any coding task in this repo.

#### Think Before Coding

- State assumptions explicitly. If uncertain, ask before implementing.
- When multiple interpretations exist, surface them — do not pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what is confusing. Ask.

#### Simplicity First

- Write the minimum code that solves the problem. Nothing speculative.
- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that was not requested.
- No error handling for impossible scenarios.
- If you wrote 200 lines and it could be 50, rewrite it.
- Inline comments cap at 2 lines. Needing more means the code is a patch — fix the implementation instead of narrating it. Say *why*, never restate *what*; no changelogs, no rationale essays, no pasted chat/review replies. (Doc comments on an exported API — TSDoc `@param`/`@returns`/`@deprecated` — are documentation, not narration, and are exempt.)

#### Surgical Changes

- Touch only what the task requires. Do not "improve" adjacent code, comments, or formatting.
- Do not refactor things that are not broken.
- Match existing style even if you would do it differently.
- If you notice unrelated dead code, mention it — do not delete it.
- Remove imports / variables / functions that **your** changes orphaned. Leave pre-existing dead code alone unless asked.
- Every changed line must trace directly to the user's request.

#### Goal-Driven Execution

- Convert tasks into verifiable goals before coding:
  - "Add validation" → "Write tests for invalid inputs, then make them pass."
  - "Fix the bug" → "Write a test that reproduces it, then make it pass."
  - "Refactor X" → "Ensure tests pass before and after."
- For multi-step tasks, state a brief plan with explicit verification per step:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
```

### Operational Rules

Project-specific tools, paths, and conventions.

- **Keep it clear**: Write code that is easy to read, maintain, and explain.
- **Read local READMEs first**: Before editing code in a directory, check for a `README.md` in that directory (and its parents) and read it — these files capture local conventions, invariants, and entry points that aren't obvious from the code alone.
- **Fix upstream, don't hack downstream**: When a new feature hits an existing module's limitation, flag the upstream improvement for the user's decision before proposing a downstream workaround.
- **Library-first, custom-last**: Before writing custom code, check library/framework docs for built-in options or existing solutions. Write custom code only when no adequate alternative exists.
- **Build with Tailwind CSS & Shadcn UI**: Use components from `@cherrystudio/ui` (located in `packages/ui`, Shadcn UI + Tailwind CSS) for every new UI component.
- **Log centrally**: Route all logging through `loggerService` with the right context—no `console.log`.
- **Access paths centrally**: Use `application.getPath('namespace.key', filename?)` for all main-process filesystem paths—never call `app.getPath()`, `os.homedir()`, or construct paths ad-hoc. Import the singleton via `import { application } from '@application'`.
- **Lint, test, and format before completion**: Coding tasks are only complete after running `pnpm lint`, `pnpm test`, and `pnpm format` successfully.
- **Write conventional commits**: Commit small, focused changes using Conventional Commit messages (e.g., `feat(data-api):`, `fix(lifecycle):`, `refactor(quick-assistant):`, `docs(testing):`, `chore(deps):`, `test(window-manager):`). Scope must be a specific kebab-case module, never generic like `main` — when `git log` conflicts with this rule, this rule wins.
- **Sign commits and sign off**: Every commit must be both cryptographically signed and DCO-signed off. Use `git commit -S --signoff` (not `--signoff` alone), verify the commit object contains a `gpgsig` header with `git cat-file commit HEAD`, and verify the pushed PR commits show `Verified` on GitHub.
- **Target the right branch**: `main` is the default branch for all active development — submit features, refactors, optimizations, and fixes here.


## Code Commit Rules

All commits must follow these rules — no exceptions.

### Conventional Commits

Format: `<type>(<scope>): <subject>`

- **type**: `feat` | `fix` | `refactor` | `docs` | `chore` | `test` | `perf` | `build` | `ci` | `style`
- **scope**: specific kebab-case module (e.g., `data-api`, `lifecycle`, `quick-assistant`, `window-manager`). Never generic like `main`, `core`, `app`.
- **subject**: imperative mood, lowercase, no trailing period, max 72 chars.
- **body** (optional): explains *why* and *what changed*, not *how*. Wrap at 72 chars.
- **footer** (optional): `BREAKING CHANGE:`, `Fixes #123`, `Co-authored-by:`.
- **No Co-authored-by: trailers for AI agents** — only human contributors.

Examples:
```
feat(data-api): add conversation pinning endpoint
fix(lifecycle): prevent double-close on window blur
refactor(quick-assistant): extract model selector into hook
docs(testing): add SSE parser test fixtures
chore(deps): update tauri to 2.0.3
test(window-manager): add focus retention test
```

### Signing & DCO

Every commit must be:
1. **Cryptographically signed** (GPG/SSH): `git commit -S`
2. **DCO signed-off**: `git commit --signoff` (adds `Signed-off-by:` trailer)

Use both together: `git commit -S --signoff -m "..."`

Verify before push:
```bash
git cat-file commit HEAD | grep -E '^(gpgsig|Signed-off-by)'
```

GitHub must show **Verified** badge on the commit.

### Branch Target

- **`main`** is the only target branch for features, fixes, refactors, and optimizations.
- No `develop`, `staging`, or release branches — everything lands on `main`.\n- Hotfixes for released versions: branch from the tag, fix, tag new patch, merge back to `main`.

### Commit Granularity

- One logical change per commit. If `git diff` shows unrelated files, split.
- No "WIP", "fixup", "cleanup" commits in history — rewrite locally before pushing.
- Each commit must pass `cargo test` / `npm run lint` / `npx tsc -b` individually.

### PR Requirements

- PR title = commit subject (or squash-merge subject).
- PR description: what, why, test plan, screenshots for UI changes.
- No draft PRs without CI passing.
- Review required: at least one approval before merge.
- Squash-merge only — no merge commits in `main` history.
- **No `Co-authored-by:` trailers for AI agents** — only human contributors.

## What this is

Chat Studio - a Tauri v2 desktop chat client for Ollama Cloud, NVIDIA NIM, and OpenRouter
(plus any OpenAI-compatible endpoint added by the user). Rust backend, React 19 +
TypeScript frontend styled with Tailwind v4 + shadcn/ui (Radix primitives), modeled
visually on Cherry Studio.

## Layout

```
chat_studio/
├── Cargo.toml              # workspace root; release profile (opt-level="z", lto, strip)
├── package.json            # root: just the tauri CLI, so `npm run tauri ...` works from here
├── src-tauri/               # Rust backend
│  ├── tauri.conf.json       # beforeDevCommand/beforeBuildCommand point into ui/
│  └── src/
│     ├── main.rs            # Builder setup, invoke_handler registration
│     ├── commands.rs        # every #[tauri::command] - the whole IPC surface
│     ├── db.rs               # rusqlite schema + queries (schema version-gated migrations)
│     ├── config.rs          # settings.toml load/save, built-in provider presets
│     ├── state.rs           # AppState: db handle, settings, active streams, model cache
│     └── providers/
│        ├── mod.rs          # `Provider` trait, StreamEvent, shared LineSplitter
│        ├── openai_compat.rs # OpenRouter/NIM/custom - SSE parsing
│        └── ollama.rs        # Ollama's native NDJSON dialect (not OpenAI-compatible)
└── ui/                       # React frontend (Vite + Node)
   └── src/
      ├── lib/{ipc,types,utils}.ts   # typed invoke() wrappers; types.ts mirrors Rust structs
      ├── store/{chat,settings,theme}.ts  # zustand stores
      ├── routes/{Chat,Settings}.tsx      # Settings is React.lazy-split in App.tsx
      └── components/                    # Sidebar, ChatHeader, Composer, MessageBubble, ui/*
```

## Commands

Use the `Makefile` (`make help` lists everything), or run directly:

```
cd ui && npm install && cd ..    # install JS deps
npm install                       # installs the tauri CLI at the root

npm run tauri dev -- --no-watch   # dev mode (see "tauri dev is flaky" below)
npm run tauri build               # release build + installer

cargo test --manifest-path src-tauri/Cargo.toml   # Rust test suite
cd ui && npx tsc -b && npm run lint               # frontend typecheck + lint
cd ui && npm run build                            # frontend production build only
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
- **Node/npm tooling.** `npm install`, `npm run`, `npx` throughout. The Tauri CLI is
  installed as `@tauri-apps/cli` via npm (prebuilt binary), not `cargo install tauri-cli`
  (slow, and needs the same MSVC toolchain caveat above).

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
