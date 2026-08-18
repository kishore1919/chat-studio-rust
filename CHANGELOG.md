# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial project structure and architecture
- Multi-provider support (OpenRouter, NVIDIA NIM, Ollama, OpenAI, Anthropic, Gemini)
- Streaming responses with batched IPC (~40ms)
- SQLite conversation history with schema migrations
- MCP (Model Context Protocol) stdio transport support
- Built-in agents: General Assistant, Code Architect, Research Analyst
- Built-in skills: Code Review, Summarize, Problem Solver, Translate
- Prompt templates with slash commands
- Theming: light/dark/system, multiple variants, accent colors, font size, borders
- Markdown rendering with syntax highlighting and Mermaid diagrams
- Cross-platform builds: Windows (NSIS), macOS (DMG), Linux (AppImage, .deb, .rpm)

### Changed
- N/A

### Fixed
- N/A

### Security
- N/A

---

## [0.1.0] - 2026-08-17

### Added
- Initial release

---

## Release Template

When releasing a new version, add a new section at the top following this format:

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- New features

### Changed
- Changes in existing functionality

### Deprecated
- Soon-to-be removed features

### Removed
- Removed features

### Fixed
- Bug fixes

### Security
- Vulnerability fixes
```

### Version Guidelines
- **MAJOR** (X): Breaking changes, major rewrites
- **MINOR** (Y): New features, backward compatible
- **PATCH** (Z): Bug fixes, backward compatible

### Commit Categories Mapping
| Commit Type | Changelog Section |
|-------------|-------------------|
| `feat` | Added |
| `fix` | Fixed |
| `refactor` | Changed |
| `perf` | Changed |
| `docs` | (not in changelog) |
| `chore` | (not in changelog) |
| `test` | (not in changelog) |
| `build` | (not in changelog) |
| `ci` | (not in changelog) |
| `revert` | Fixed/Removed |