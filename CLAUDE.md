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
