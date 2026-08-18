# Chat Studio

A lightweight Tauri v2 desktop chat client for **Ollama**, **OpenRouter**, **NVIDIA NIM**, **OpenAI**, **Anthropic**, **Google Gemini**, and any OpenAI-compatible endpoint. Built with Rust backend, React 19 + TypeScript frontend, styled with Tailwind v4 + shadcn/ui (Radix primitives).

<p align="center">
  <img alt="Chat Studio screenshot" src="docs/screenshot.png" width="800">
</p>

---

## ✨ Features

| Category | Details |
|----------|---------|
| **Multi-provider** | Ollama (native + cloud), OpenRouter, NVIDIA NIM, OpenAI, Anthropic, Gemini, custom OpenAI-compatible endpoints |
| **Streaming** | Token-level streaming with ~40 ms batched IPC (avoids per-token jank) |
| **Local history** | SQLite database with schema migrations — conversations persist across restarts |
| **MCP support** | Model Context Protocol servers (stdio transport) for tool calling |
| **Agents & Skills** | Built-in agents (General, Code Architect, Research Analyst) and skills (Code Review, Summarize, Problem Solver, Translate) with slash commands |
| **Prompt templates** | Reusable prompt snippets via `/prompt <name>` in the composer |
| **Theming** | Light / dark / system, multiple theme variants, configurable accent color, font size, border visibility |
| **Markdown rendering** | GitHub-flavored markdown, syntax highlighting (highlight.js), Mermaid diagrams |
| **Cross-platform** | Windows (NSIS installer), macOS (DMG), Linux (AppImage, .deb, .rpm) |

---

## 🏗 Architecture

```
chat_studio/
├─ Cargo.toml              # Workspace root; release profile (opt-level="z", LTO, strip)
├─ package.json            # Root: only the Tauri CLI (`bun run tauri ...`)
├─ Makefile                # Unified dev/build/test/lint commands
├─ src-tauri/              # Rust backend
│  ├─ tauri.conf.json      # Tauri config (window, bundle, CSP, dev/build commands)
│  └─ src/
│     ├─ main.rs           # App builder, invoke_handler registration
│     ├─ commands.rs       # All #[tauri::command] — the entire IPC surface
│     ├─ db.rs             # rusqlite schema + queries (version-gated migrations)
│     ├─ config.rs         # settings.toml load/save, built-in provider presets
│     ├─ state.rs          # AppState: db handle, settings, active streams, model cache
│     ├─ context.rs        # Conversation history preparation & token budgeting
│     ├─ themes.rs         # Theme tokens & resolution
│     ├─ providers/
│     │  ├─ mod.rs         # Provider trait, StreamEvent, LineSplitter (shared parser)
│     │  ├─ openai_compat.rs # OpenRouter / NIM / custom — SSE parsing
│     │  ├─ ollama.rs      # Ollama native NDJSON (/api/chat dialect)
│     │  ├─ anthropic.rs   # Anthropic Messages API
│     │  ├─ gemini.rs      # Google Gemini API
│     │  └─ openai.rs      # OpenAI Responses/Chat Completions API
│     ├─ mcp/              # MCP client (stdio transport, tool calling)
│     └─ skills/           # Skill execution & slash command routing
└─ ui/                     # React frontend (Vite + Bun)
   ├─ src/
   │  ├─ lib/             # ipc.ts (typed invoke wrappers), types.ts (mirrors Rust), utils.ts
   │  ├─ store/           # zustand stores: chat.ts, settings.ts, theme.ts
   │  ├─ routes/          # Chat.tsx, Settings.tsx (lazy-loaded)
   │  ├─ components/      # Sidebar, ChatHeader, Composer, MessageBubble, StreamingBubble, AgentsPane, McpPane, SkillsPane, PromptsPane, MindMapPanel, ToolCallCard, ThinkingBar, ui/*
   │  ├─ App.tsx          # Root, theme script injection, route setup
   │  ├─ index.css        # Tailwind v4 + CSS custom properties (theming)
   │  └─ main.tsx         # Entry point
   ├─ index.html          # Inline theme script (prevents flash)
   └─ package.json
```

### Provider abstraction

`providers::Provider` is a single trait with five implementations:

- **OpenAiCompatProvider** — SSE, used by OpenRouter, NVIDIA NIM, and any custom OpenAI-compatible endpoint
- **OllamaProvider** — newline-delimited JSON (Ollama's own `/api/chat` dialect, not SSE)
- **AnthropicProvider** — Anthropic Messages API
- **GeminiProvider** — Google Generative Language API
- **OpenaiProvider** — OpenAI Chat Completions API (native, with reasoning effort support)

Adding another OpenAI-compatible provider requires **zero Rust code** — just add a row in Settings → Providers.

### Streaming path

1. Provider sends `ProviderEvent::Delta` per network chunk into an `mpsc` channel
2. `commands::send_message` spawns a task that coalesces deltas into ~40 ms batches
3. Batched `StreamEvent::Delta` emitted via Tauri event to frontend
4. Frontend `store/chat.ts` holds in-flight message in `streaming` key (separate from `messagesByConversation`)
5. `StreamingBubble` subscribes to that key — this separation prevents infinite render loops with `useSyncExternalStore`

Cancellation and mid-stream errors **still persist whatever text arrived** (see `Outcome` enum in `commands.rs`).

---

## 🚀 Quick Start

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| **Rust** | stable (MSVC on Windows) | `rustup default stable-x86_64-pc-windows-msvc` on Windows |
| **Bun** | ≥ 1.0 | `curl -fsSL https://bun.sh/install.sh \| bash` |
| **Windows** | 10/11 | VS Build Tools "Desktop development with C++" workload required |

### Install & Run (Development)

```bash
# Clone
git clone https://github.com/your-org/chat_studio.git
cd chat_studio

# Install all deps (Rust + JS + Tauri CLI)
make install
# or manually:
# cd ui && bun install && cd .. && bun install

# Run dev (bypasses flaky tauri-cli watcher on Windows)
make dev
# or: bun run tauri dev -- --no-watch
```

### Production Build

```bash
make build
# or: bun run tauri build
```

Output: `src-tauri/target/release/bundle/` (NSIS/.msi on Windows, .dmg on macOS, AppImage/.deb/.rpm on Linux)

---

## 🛠 Development Commands

All commands available via `make` (run `make help`):

| Target | Description |
|--------|-------------|
| `make install` | Install Rust deps (cargo) + JS deps (bun) + Tauri CLI |
| `make dev` | Dev mode with `--no-watch` (avoids Windows watcher bug) |
| `make dev-stable` | Vite + debug binary directly (bypasses tauri-cli entirely) |
| `make build` | Production build (frontend + release binary + installer) |
| `make test` | Rust test suite (`cargo test`) |
| `make lint` | Frontend lint (`oxlint`) |
| `make typecheck` | Frontend type-check (`tsc -b`) |
| `make clippy` | Rust clippy (`-D warnings`) |
| `make fmt` | `cargo fmt` |
| `make fmt-check` | `cargo fmt --check` (CI) |
| `make check` | Full CI pipeline: fmt-check + clippy + typecheck + lint + test |
| `make clean` | Remove `target/` and `ui/dist` |

---

## ⚙️ Configuration

Settings are stored in `settings.toml` at:

| OS | Path |
|----|------|
| Windows | `%LOCALAPPDATA%\chat-studio\settings.toml` |
| macOS | `~/Library/Application Support/chat-studio/settings.toml` |
| Linux | `~/.config/chat-studio/settings.toml` |

### Provider setup (UI: Settings → Providers)

| Provider | Dialect | Default Base URL | API Key |
|----------|---------|------------------|---------|
| OpenRouter | `openai_compat` | `https://openrouter.ai/api/v1` | Required |
| NVIDIA NIM | `openai_compat` | `https://integrate.api.nvidia.com/v1` | Required |
| Ollama Cloud | `ollama` | `https://ollama.com` | Optional |
| OpenAI | `openai` | `https://api.openai.com/v1` | Required |
| Anthropic | `anthropic` | `https://api.anthropic.com` | Required |
| Google Gemini | `gemini` | `https://generativelanguage.googleapis.com` | Required |
| Custom | `openai_compat` | *your endpoint* | As needed |

Add custom providers in Settings → Providers → "Add Provider". Any OpenAI-compatible endpoint works out of the box.

### MCP Servers (Settings → MCP)

Configure stdio-based MCP servers:

```toml
[[mcp_servers]]
id = "my-server"
name = "My MCP Server"
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/allowed/path"]
enabled = true
```

---

## 🧪 Testing

### Rust (backend)

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Tests cover:
- SSE / NDJSON parsing (`providers/`)
- Database queries & migrations (`db.rs`)
- Config loading & provider building (`config.rs`)

### Frontend

No test framework configured — correctness enforced by:
- `tsc -b` (strict type-checking)
- `oxlint` (linting)
- Manual verification

---

## 📦 Dependencies

### Rust (key crates)

| Crate | Purpose |
|-------|---------|
| `tauri` v2 | Desktop app framework |
| `rusqlite` | SQLite with bundled `libsqlite3-sys` |
| `reqwest` | HTTP client (Rustls TLS) |
| `serde` / `serde_json` | Serialization |
| `tokio` | Async runtime |
| `tracing` | Structured logging |
| `async-trait` | Provider trait |
| `toml` | Settings format |
| `dirs` | Config directory resolution |

### Frontend (key packages)

| Package | Purpose |
|---------|---------|
| `react` 19 / `react-dom` 19 | UI |
| `zustand` | State management |
| `@tauri-apps/api` | Tauri IPC |
| `tailwindcss` v4 | Styling |
| `@radix-ui/*` | Headless UI primitives |
| `react-markdown` + `rehype-highlight` + `remark-gfm` | Markdown rendering |
| `mermaid` | Diagrams |
| `react-virtuoso` | Virtualized message list |
| `sonner` | Toasts |
| `oxlint` | Linting |
| `typescript` 6 | Type-checking |

---

## 🐛 Known Gotchas

| Issue | Workaround |
|-------|------------|
| **Windows: `gcc.exe` / `dlltool.exe` not found** | Install VS Build Tools "Desktop development with C++" and use `rustup default stable-x86_64-pc-windows-msvc` |
| **`tauri dev` crashes immediately (exit 255)** | Use `make dev` (passes `--no-watch`) or `make dev-stable` |
| **High RAM usage (~350–400 MB idle)** | This is WebView2, not app code. Baseline Tauri window is 150–250 MB. |
| **Frontend selector returns new array literal** | Use module-level constant (e.g. `EMPTY_MESSAGES`) for fallback to avoid `useSyncExternalStore` infinite loop |

---

## 🤝 Contributing

1. Read `AGENTS.md` (guiding principles, conventions, architecture notes)
2. Run `make check` before committing — it runs the full CI pipeline
3. Write conventional commits: `feat(provider):`, `fix(streaming):`, `docs(readme):`, etc.
4. **Sign commits**: `git commit -S --signoff` (both GPG and DCO)
5. Target `main` branch for all changes

### Code style

- **Rust**: `cargo fmt` + `cargo clippy -D warnings`
- **TypeScript**: `tsc -b` + `oxlint`
- **Comments**: Explain *why*, not *what*. Inline comments ≤ 2 lines.

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

- [Tauri](https://tauri.app/) — desktop framework
- [shadcn/ui](https://ui.shadcn.com/) — component patterns
- [Cherry Studio](https://github.com/CherryHQ/cherry-studio) — visual inspiration
- [Ollama](https://ollama.com/), [OpenRouter](https://openrouter.ai/), [NVIDIA NIM](https://www.nvidia.com/en-us/nim/) — provider APIs