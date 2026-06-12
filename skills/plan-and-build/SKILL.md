---
name: plan-and-build
description: Plans a non-trivial feature end-to-end before writing code — scopes the work, identifies unknowns, then implements with verification at each step.
---

# Plan and Build

For anything bigger than a single-file change.

## Understand
1. Read AGENTS.md and relevant source. recall() for related context.
2. repo_map + sg_search to map ownership. Research unknowns with web_search.

## Plan
- Goal in one sentence. Affected files. Implementation order. Risks. Tests.
- Show the plan before implementing if complex or high-risk.

## Implement
- Work in order. After each step: targeted test + typecheck.
- If plan is invalidated — stop, reassess, update.

## Close
- Full test suite. Read `git diff HEAD`. Fix any auto-verify errors.
- remember("codebase"|"questions", ...) for decisions and open items.
