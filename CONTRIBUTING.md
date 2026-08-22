# Contributing to Chat Studio

Thank you for your interest in contributing! This document outlines the process and standards for contributing to this project.

## Getting Started

1. **Fork the repository** and clone your fork
2. **Install dependencies**:
   ```bash
   make install
   ```
3. **Run the development server**:
   ```bash
   make dev
   ```
4. **Make your changes** following the guidelines below
5. **Run the full check suite** before committing:
   ```bash
   make check
   ```
6. **Submit a pull request**

## Development Workflow

### Branch Naming
- `feat/<short-description>` — new features
- `fix/<short-description>` — bug fixes
- `refactor/<short-description>` — refactoring (no functional changes)
- `docs/<short-description>` — documentation updates
- `chore/<short-description>` — maintenance, dependency updates
- `test/<short-description>` — test additions

### Commit Messages
Follow [Conventional Commits](https://www.conventionalcommits.org/):
```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types**: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`, `perf`, `build`, `ci`, `revert`

**Scope**: A specific kebab-case module (e.g., `provider`, `streaming`, `chat`, `settings`, `db`, `mcp`, `themes`)

**Examples**:
```
feat(provider): add Anthropic provider support
fix(streaming): handle partial line buffering in Ollama parser
refactor(chat): extract message coalescing logic
docs(readme): update installation instructions
chore(deps): update tauri to v2.11.4
```

### Signing Commits
All commits **must be signed** (GPG) and **DCO signed-off**:
```bash
git commit -S --signoff -m "feat(provider): add Anthropic provider"
```

Verify your commit:
```bash
git cat-file commit HEAD | grep -E "(gpgsig|Signed-off-by)"
```

## Code Standards

### Rust (Backend)
- **Format**: `cargo fmt` (run via `make fmt`)
- **Lint**: `cargo clippy --all-targets -D warnings` (run via `make clippy`)
- **Tests**: `cargo test` (run via `make test`)
- **Comments**: Explain *why*, not *what*. Inline comments ≤ 2 lines.
- **Architecture**: Follow patterns in `AGENTS.md` — provider abstraction, streaming coalescing, DB migrations

### TypeScript (Frontend)
- **Type-check**: `tsc -b` (run via `make typecheck`)
- **Lint**: `oxlint` (run via `make lint`)
- **Build**: `npm run build` (run via `make build-frontend`)
- **State**: Use `zustand` stores in `ui/src/store/` — avoid inline selectors that return new object literals
- **Components**: Use shadcn/ui primitives from `@radix-ui/*` + Tailwind v4

### General
- **Surgical changes**: Touch only what the task requires. Don't refactor unrelated code.
- **Think before coding**: State assumptions. Surface tradeoffs. Ask if unclear.
- **Simplicity first**: Minimum code that solves the problem. No speculative abstractions.

## Testing

### Backend (Rust)
- Unit tests in `#[cfg(test)]` modules alongside code
- Use in-memory SQLite for DB tests
- Use fixture strings for parser tests
- Run: `make test`

### Frontend
- No test framework configured yet
- Correctness enforced by: `tsc -b` + `oxlint` + manual verification
- When adding a test framework, follow existing patterns

## Pull Request Process

1. **Create a PR** against `main` branch
2. **Fill out the PR template** completely
3. **Ensure all CI checks pass** (fmt-check, clippy, test, typecheck, lint, build-frontend)
4. **Request review** from maintainers
5. **Address feedback** — push additional commits (no force-push after review starts)
6. **Merge** — maintainers will squash and merge with signed commit

### PR Requirements
- [ ] All `make check` targets pass
- [ ] Conventional commit messages
- [ ] Signed commits (`-S --signoff`)
- [ ] No unrelated changes
- [ ] Tests added for new functionality
- [ ] Documentation updated if needed

## Architecture Guidelines

### Adding a New Provider
1. **OpenAI-compatible**: Add a row in Settings → Providers (zero Rust code)
2. **New wire format**: Create `src-tauri/src/providers/<name>.rs` implementing `Provider` trait
3. Add dialect to `config.rs` `Dialect` enum
4. Add builder case in `providers/mod.rs` `build_provider()`
5. Add tests in the new provider file

### Database Migrations
- Bump `SCHEMA_VERSION` in `db.rs`
- Add `ALTER TABLE` branch guarded by old version number
- Never just add columns to `CREATE TABLE` — existing installs won't get them
- Test migration path: install old version → create data → upgrade → verify

### Streaming Changes
- Provider sends `ProviderEvent::Delta` per chunk
- Coalescing happens in `commands::send_message` (~40ms batches)
- Frontend state in `store/chat.ts` uses separate `streaming` key
- **Never** discard partial output on cancellation/error — persist what arrived

## Release Process

Releases are manual:
1. Update version in `src-tauri/Cargo.toml` and `ui/package.json`
2. Update `CHANGELOG.md`
3. Create signed tag: `git tag -s v0.x.x -m "v0.x.x"`
4. Push tag: `git push origin v0.x.x`
5. GitHub Actions builds release artifacts
6. Create GitHub Release with generated assets

## Community

- **Issues**: Use templates (bug report, feature request)
- **Discussions**: For questions, ideas, general discussion
- **Discord/Slack**: (link if available)
- **Code of Conduct**: See `CODE_OF_CONDUCT.md`

## License

By contributing, you agree that your contributions will be licensed under the MIT License (see `LICENSE`).
