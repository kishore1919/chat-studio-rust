# Frontend optimization: dependency reduction + bundle splitting + code dedup

## Context

`ui/` currently ships **24 runtime dependencies** and builds a **922 KB single eager JS chunk** (`dist/assets/index-*.js`) with no vendor/app boundary — every source edit invalidates the whole thing for HTTP caching. Four declared packages are dead or phantom, two heavy trees (`rehype-highlight`/lowlight ~175 KB, `@lobehub/icons` barrel) sit on the critical chat path for marginal benefit, and only two lazy boundaries exist in the entire app (`Settings` route, `MermaidBlock`).

Separately, the frontend is 8,402 lines across 50 files, but five files are 40% of it, and the four settings panes (`AgentsPane`, `McpPane`, `SkillsPane`, `PromptsPane`, 1,415 lines combined) are near-identical CRUD-over-a-settings-array screens with character-for-character duplicated markup.

**Intended outcome:** 24 → 20 runtime deps, a materially smaller eager chunk with a stable vendor boundary, and ~400–600 fewer lines of duplicated UI code — with no behavior change.

**Decisions already made by the user:**
- Full sweep, including breaking up `Settings.tsx` and `Sidebar.tsx`.
- Keep `@lobehub/icons` but move it off the eager path (do *not* hand-roll SVGs).
- Lazy-load `rehype-highlight`; a one-frame flash of unhighlighted code is acceptable.

The mermaid lazy split and the module-scope plugin-array hoisting in `MarkdownContent.tsx` are already correct — **do not touch them.** The comment at `MarkdownContent.tsx:28-33` documents a measured, failed attempt to trim lowlight grammars; do not retry it.

---

## Phase 1 — Remove dead and phantom packages

Verified zero import sites anywhere in `ui/src`, `ui/index.html`, `ui/vite.config.ts`, or `ui/src/index.css`.

| Package | Why it goes |
|---|---|
| `esbuild` (devDep) | No import, no CLI use. `vite.config.ts:34` `minify: 'esbuild'` is served by Vite 8's own bundled esbuild. A pinned direct copy is pure version-drift risk (already flagged in `docs/REVIEW.md:118-121`). |
| `highlight.js` | No direct import. The runtime arrives transitively via `rehype-highlight` → `lowlight`. The `.hljs-*` selectors in `ui/src/index.css:191-260` are hand-written CSS, not a package import. |
| `@radix-ui/react-tooltip` | `ui/src/components/ui/tooltip.tsx` is an orphan — nothing imports `@/components/ui/tooltip`. Delete both. |
| `@radix-ui/react-separator` | `ui/src/components/ui/separator.tsx` is an orphan. (`DropdownMenuSeparator`/`SelectSeparator` come from the dropdown/select primitives, not this package.) Delete both. |

Also delete `ui/src/components/ui/badge.tsx` — orphan (the only "Badge" references outside it are a comment at `ChatHeader.tsx:95` and a locally-defined `ContextFlagBadge` at `MessageBubble.tsx:321`). **Keep** `class-variance-authority` and `@radix-ui/react-slot`: both are still live via `buttonVariants` and `asChild` in `ui/button.tsx`.

→ verify: `cd ui && bun install && bun run build && bunx tsc -b` — clean, and `grep -r "tooltip\|separator\|badge" ui/src` returns no `@/components/ui/*` hits.

## Phase 2 — Establish a vendor/app chunk boundary

`ui/vite.config.ts` has no `build.rollupOptions` at all. This is the single highest-leverage change for cache behavior.

**Important:** this project is on Vite 8, which uses **Rolldown**, not Rollup — the `dist` output already shows rolldown-style `chunk-*` names and a rolldown runtime `modulepreload`. Rolldown's chunking option is `build.rollupOptions.output.advancedChunks.groups`, not `manualChunks`. Confirm which the installed version accepts before committing (a `manualChunks` function may be silently ignored rather than error).

Target groups:
- `react` — `react`, `react-dom`, `react/jsx-runtime` (changes only on upgrade)
- `radix` — all `@radix-ui/*` primitives
- `markdown` — `react-markdown`, `remark-gfm`, `unified` and its micromark/mdast tree
- `vendor` — remaining `node_modules`

Leave `mermaid` alone; its dynamic-import split already works and produces ~3.3 MB of correctly-deferred chunks.

→ verify: `bun run build`, then compare `dist/assets/index-*.js` byte size against the current 922,627 B baseline. Record before/after in the commit body.

## Phase 3 — Defer the heavy eager trees

### 3a. `rehype-highlight` (~175 KB, largest single win)

`ui/src/components/MarkdownContent.tsx:5` imports it statically at module top-level.

Replace with a **module-scoped cached promise**, not a per-component `lazy()`:

```ts
let rehypePlugins: PluggableList | null = null
let loading: Promise<void> | null = null
```

- `MarkdownContentImpl` reads the module cache on first render. If populated, use it synchronously — later mounts must not re-flash.
- If not populated, render with `REHYPE_NONE` and kick off `import('rehype-highlight')` once, resolving into the module cache and bumping a subscribed state value to re-render.
- **Critical invariant:** the resolved array must be a *stable module-level reference*. `react-markdown` memoizes on `rehypePlugins` identity (see the comment at `MarkdownContent.tsx:24-26`) — allocating a new array per render defeats memoization on every message, streaming and settled alike, which is exactly the regression that comment exists to prevent.
- The existing `highlight?: boolean` prop (streaming callers pass `false` for the unsettled trailing fence) keeps working unchanged.

### 3b. `@lobehub/icons` barrel

`ui/src/lib/providerIcon.tsx:3` statically imports 4 marks; `ChatHeader.tsx:14` pulls `providerIcon` onto the eager path. Convert `ProviderIcon` to a lazy inner component with the existing `CableIcon` fallback as the `<Suspense>` fallback — the `openai_compat` branch already renders `CableIcon`, so the loading state is visually identical to a real state the UI already shows.

### 3c. Conditionally-rendered components in `Chat.tsx`

Both are eagerly imported despite being keyboard-gated:
- `MindMapPanel` (236 lines) — rendered only when `mindMapOpen && activeConversationId !== null` (`Chat.tsx:94-99`), Ctrl+M
- `ShortcutsDialog` (`Chat.tsx:102`) — Ctrl+/

Wrap both in `lazy()` + `<Suspense fallback={null}>`. Follow the existing pattern at `App.tsx:11` and `MarkdownContent.tsx:12-14`.

→ verify: `make dev`; open a chat with a fenced code block (colors arrive within a frame), toggle Ctrl+M and Ctrl+/, check provider logos render in `ChatHeader` and Settings → Providers. Confirm in devtools Network that the highlight chunk is a separate request.

## Phase 4 — Extract shared settings-pane primitives

New directory `ui/src/components/settings/`. Extract these, each verified as character-for-character duplicated across ≥3 panes:

| Primitive | Replaces |
|---|---|
| `PaneHeader` (title + `<PlusIcon className="size-3.5" />` add button) | `AgentsPane.tsx:151`, `SkillsPane.tsx:197`, `PromptsPane.tsx:82`, `McpPane.tsx:250,264` |
| `SettingsCard` (`"flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-xs transition-colors"`) | `PromptsPane.tsx:95`, `SkillsPane.tsx:248`, `AgentsPane.tsx:~157` |
| `CardActions` (edit/delete ghost `Button` pair, `size-7` + `PencilIcon`/`Trash2Icon` at `size-3.5`) | `AgentsPane.tsx:186-200`, `SkillsPane.tsx:285-299`, `PromptsPane.tsx:99-113` |
| `PromptPreview` (`"rounded-lg bg-muted/40 p-2 text-[11px] font-mono text-muted-foreground line-clamp-N"`) | `AgentsPane.tsx:224`, `SkillsPane.tsx:302`, `PromptsPane.tsx:120` |
| `PaneDialog` (`DialogContent max-w-md` → Header/Title/Description → `space-y-3 pt-1` → Footer with Cancel + disabled-until-valid Save) | all four panes |

Also in this phase:
- Replace the copy-pasted icon **switches** `getAgentIcon` (`AgentsPane.tsx:28-42`) and `getSkillIcon` (`SkillsPane.tsx:31-49`) with a single `Record<string, LucideIcon>` lookup — every branch already applies the identical `className="size-4 text-primary"`.
- Route the **6 raw `<textarea>`** sites through the existing `ui/textarea.tsx` (used today only by `Composer.tsx:16` and `MessageBubble.tsx:23`): `AgentsPane.tsx:276`, `McpPane.tsx:508`, `McpPane.tsx:521`, `PromptsPane.tsx:147`, `Sidebar.tsx:633`, `SkillsPane.tsx:358`.

Leave the per-pane CRUD handler bodies (`handleToggle`/`handleDelete`/`openAdd`/`openEdit`) as-is. They are structurally similar but each closes over a different settings key and item shape; a generic hook over them would be a single-use abstraction — exactly what `CLAUDE.md` forbids.

→ verify: `bunx tsc -b` clean (`noUnusedLocals` will catch orphaned imports), then `make dev` and exercise add/edit/delete/toggle in each of the four panes.

## Phase 5 — Split the two largest files

`Settings.tsx` (972 lines) is already cleanly sectioned — extract each in-file pane to `ui/src/components/settings/`, keeping the shell (header, `NAV_GROUPS`, nav, section switch at `:146-158`):

- `AddProviderDialog` (`:167-248`) + `ModelProviderPane` (`:249-305`) + `ProviderDetail` (`:306-575`) → `ModelProviderPane.tsx`
- `DefaultModelPane` (`:576-631`) → `DefaultModelPane.tsx`
- `THEME_OPTIONS`/`ACCENT_SWATCHES` + `AppearancePane` (`:632-855`) → `AppearancePane.tsx`
- `ContextPane` (`:856-972`) → `ContextPane.tsx`

Then **lazy-load all eight panes** behind the section switch. Today `Settings.tsx:43-46` eagerly imports all four external panes, so the entire settings surface is one 62 KB chunk regardless of which section is active.

`Sidebar.tsx` (697 lines) — split by extracting the conversation-item row and its rename/delete affordances into a sibling component. Keep this conservative: it is on the eager chat path and has no test coverage, so structural moves only, no logic rewrites.

→ verify: `bunx tsc -b`, then click through every nav section in Settings and confirm each loads; exercise sidebar rename/delete/pin.

## Phase 6 — Small consolidations

- Add `newId(prefix: string)` to `ui/src/lib/utils.ts`, replacing the collision-prone `` `<prefix>-${Date.now()}` `` at `AgentsPane.tsx:118`, `McpPane.tsx:205`, `PromptsPane.tsx:60`, `SkillsPane.tsx:152`, `Sidebar.tsx:282`.
- Use the existing `useCopyFeedback` hook (`ui/src/lib/useCopyFeedback.ts`) at the three sites that bypass it — `Settings.tsx:363-367` re-implements the exact pattern with an uncleaned `setTimeout(…, 2000)`, and `ChatHeader.tsx:77` / `MessageErrorBoundary.tsx:41` call `navigator.clipboard.writeText` directly. The hook's own docstring at `:6-9` says it exists precisely because "every call site used to open a bare `setTimeout` and leak it."
- Collapse the duplicate union: `store/theme.ts:4` `ThemeId` is character-identical to `lib/types.ts:67` `ThemePreference`. Keep `ThemePreference` (it's the IPC-boundary name) and re-export or alias from the store.
- Fix the stale comment at `index.css:14` referencing a non-existent `lib/theme.ts` and a `#hljs-theme` element that is never created.

---

## Flagged, not in scope (your call)

- **`vite.config.ts:28` `envPrefix: ['VITE_', 'TAURI_']`** inlines *every* `TAURI_*` env var into the client bundle, including signing secrets during a release build. Already flagged at `docs/REVIEW.md:2476`. This is a real security issue in a file Phase 2 touches anyway — say the word and I'll narrow the prefix in the same commit, but I'm not changing build-secret behavior unasked.
- **`.oxlintrc.json`** is the untouched Vite template: two rules, `options.typeAware` off. Enabling type-aware linting would likely surface real findings but is a separate task with its own churn.
- **`tsconfig.app.json` targets `es2023` while `vite.config.ts:33` builds `es2022`** — harmless in practice, noting for completeness.

## Verification (end to end)

1. `cd ui && bun install` — lockfile drops the 4 removed packages, nothing else moves.
2. `make check` — full pipeline: `cargo fmt --check`, `clippy -D warnings`, `tsc -b`, `oxlint`, `cargo test`. Must be clean. No Rust files are touched by this plan, so any Rust failure is pre-existing.
3. `bun run build` — record `dist/assets/index-*.js` size against the **922,627 B** baseline; confirm distinct `react`/`radix`/`markdown` vendor chunks exist and that a highlight chunk is now separate.
4. `make dev` smoke test: send a message with a fenced code block and a ```mermaid fence; toggle Ctrl+M / Ctrl+/ / Ctrl+B; visit all eight Settings sections; add/edit/delete/toggle one item in each of Agents, Skills, Prompts, MCP; copy a message and copy the API-request debug info.
5. Commit as separate conventional commits per phase (`chore(ui-deps):`, `perf(ui-bundle):`, `refactor(settings-panes):`, …) with `git commit -S --signoff`, so a regression can be bisected to one phase.

**Note on measurement:** there is no bundle-analysis tooling installed and this task is about *reducing* package count, so I'll measure with raw `dist` byte sizes rather than adding `rollup-plugin-visualizer`. If you want a treemap, I can run a visualizer one-off via `bunx` without adding it to `package.json`.
