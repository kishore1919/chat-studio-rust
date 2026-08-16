.PHONY: help install dev dev-stable build test lint typecheck check fmt clean

help:
	@echo "Chat Studio - available targets:"
	@echo "  make install     Install Rust deps (via cargo) and JS deps (via bun)"
	@echo "  make dev         Run the app in dev mode (tauri dev --no-watch)"
	@echo "  make dev-stable  Vite + the debug binary launched directly (bypasses"
	@echo "                   a tauri-cli watcher bug seen on Windows - see AGENTS.md)"
	@echo "  make build       Production build (frontend + release binary + installer)"
	@echo "  make test        Run the Rust test suite (src-tauri)"
	@echo "  make lint        Lint the frontend (oxlint)"
	@echo "  make typecheck   Type-check the frontend (tsc --noEmit via -b)"
	@echo "  make check       typecheck + lint + test, in that order"
	@echo "  make fmt         cargo fmt the Rust backend"
	@echo "  make clean       Remove build artifacts (target/, ui/dist)"

install:
	cd ui && bun install
	bun install

# `tauri dev` on its own has an intermittent watcher bug on Windows that
# kills the app moments after launch (exit code 255) even with nothing
# edited. --no-watch avoids it; see AGENTS.md for the full story and the
# dev-stable fallback if this still misbehaves.
dev:
	bun run tauri dev -- --no-watch

# Fallback when `make dev` still isn't stable: run Vite standalone and
# launch the debug binary directly, skipping the tauri-cli dev wrapper
# entirely. Requires `cargo build --manifest-path src-tauri/Cargo.toml`
# to have been run at least once (or run `make build` in debug first).
dev-stable:
	cd ui && bun run dev &
	sleep 2
	./target/debug/chat-studio.exe

build:
	bun run tauri build

test:
	cargo test --manifest-path src-tauri/Cargo.toml

lint:
	cd ui && bun run lint

typecheck:
	cd ui && bun x tsc -b

check: typecheck lint test

fmt:
	cargo fmt --manifest-path src-tauri/Cargo.toml

clean:
	cargo clean --manifest-path src-tauri/Cargo.toml
	rm -rf ui/dist
