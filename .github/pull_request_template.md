# Pull Request Template

## Description
<!-- Describe your changes in detail -->

## Type of Change
<!-- Check all that apply -->
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update
- [ ] Refactoring (no functional changes)
- [ ] Performance improvement
- [ ] Test addition/update
- [ ] Chore / Dependency update

## Related Issues
<!-- Link to related issues using fixes #, closes #, relates to # -->
Fixes #

## Changes Made
<!-- List the key changes -->
-
-
-

## Testing
<!-- Describe how you tested your changes -->
- [ ] Ran `make check` (fmt-check + clippy + typecheck + lint + test)
- [ ] Tested manually in dev mode (`make dev`)
- [ ] Tested production build (`make build`)
- [ ] Added/updated Rust tests in `src-tauri/src/`
- [ ] Verified no frontend type errors (`cd ui && bun x tsc -b`)

## Screenshots (if UI changes)
<!-- Add screenshots or GIFs demonstrating the changes -->

## Checklist
<!-- Ensure all items are checked before requesting review -->
- [ ] My code follows the project's style guidelines (AGENTS.md)
- [ ] I have performed a self-review of my code
- [ ] I have commented my code in hard-to-understand areas (explaining *why*, not *what*)
- [ ] My changes generate no new warnings (Rust clippy, TypeScript, oxlint)
- [ ] I have signed my commits (`git commit -S --signoff`)
- [ ] Commit messages follow Conventional Commits format (e.g., `feat(provider):`, `fix(streaming):`)
- [ ] All new/changed code is covered by tests where applicable