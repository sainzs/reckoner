---
name: plan-and-build
description: Plans a non-trivial feature end-to-end before writing code — scopes the work, identifies unknowns, then implements with verification at each step.
---

# Plan and Build

Use this for anything bigger than a single-file change.

## Phase 1 — Understand
1. Read `AGENTS.md`, `README.md`, relevant source files.
2. Run `recall()` for anything related to this area.
3. Map the relevant code: what files own what behavior?
4. Identify what you don't know — library APIs, system constraints, user intent.
5. Research unknowns with `web_search` / `web_fetch` before planning.

## Phase 2 — Plan
Write a plan before touching anything:
- What is the goal in one sentence?
- What are the affected files?
- What is the implementation order? (dependencies first)
- What are the risks or unknowns that could invalidate the plan?
- What is the rollback if something goes wrong?
- What tests will confirm it's correct?

**Stop here and show the plan if the task is complex or high-risk.**

## Phase 3 — Implement
- Work through the plan in order.
- After each meaningful step: run tests, check types.
- If something invalidates the plan — stop, reassess, update the plan.
- Checkpoint with `git add -A && git stash` before risky changes.

## Phase 4 — Verify
- Run the full test suite.
- Check types: `npx tsc --noEmit`.
- Read the full diff: `git diff HEAD`.
- If auto-verify fires — fix before finishing.

## Phase 5 — Close
- `remember("codebase", ...)` with architectural decisions made.
- `remember("questions", ...)` with anything left open.
- Summarize: what was built, how it was tested, what was left out and why.
