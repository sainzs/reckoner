---
name: implement-feature
description: Implements a user-requested code change by gathering context, making the smallest safe edit, and verifying it passes.
---

# Implement Feature

## Before touching anything
1. Read `AGENTS.md` and `README.md` — understand the rules of this codebase.
2. Run `recall()` for anything related to this feature — past decisions, patterns, known mistakes.
3. Read every file you intend to edit. The whole thing. No partial reads before editing.
4. Use `repo_map` to see the file tree and `nvim_symbols` for declaration surfaces.
5. If you're unfamiliar with a library or API, use `web_fetch` or `web_search` before guessing.

## Plan first
Before any edit, state:
- What files you're changing and why
- What the smallest safe change is
- What test will confirm it works

## Implement
- Make the minimal change. One concern at a time.
- Match the existing code style exactly — naming, indentation, patterns.
- In a monorepo, confirm the correct package before editing.
- If you touch shared code, be conservative.

## Verify
- Run the most targeted test first: `npm test -- --testPathPattern=<file>` or equivalent.
- Run `nvim_diagnostics` on changed files for real LSP errors.
- Look at `git diff` before reporting done. Actually read it.
- If auto-verify fires errors — fix them before finishing.

## After
- Call `remember("codebase", ...)` for any architectural decision made.
- Call `remember("mistakes", ...)` if you hit a non-obvious bug or wrong assumption.
- Summarize: what changed, what was tested, any follow-up risk.
