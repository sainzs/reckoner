---
name: debug-failure
description: Diagnoses a failing build, test, or runtime issue by reproducing it, narrowing the cause, and verifying the fix.
---

# Debug Failure

## Reproduce first
1. Run the smallest command that shows the failure. Don't guess — see it.
2. Capture the exact error, stack trace, and failing test name.
3. Run `recall()` — has this or something like it happened before?

## Narrow the cause
4. Read recent git changes: `git log --oneline -10`, `git diff HEAD~1`.
5. Read the failing code — the full file, not just the error line.
6. Identify one subsystem or one file that owns the problem.
7. If unclear: instrument with logs or bisect with `git bisect` before guessing.

## If you're stuck
- Use `web_search` for the exact error message.
- Use `web_fetch` for library changelogs if a dependency recently changed.
- Flaky tests are bugs. Treat them as such.

## Fix
- Fix the root cause, not the symptom.
- Don't broaden the change before you understand the cause.
- Keep the fix minimal.

## Verify
- Re-run the exact failing command — confirm it passes.
- Run one nearby passing test — confirm you haven't broken anything adjacent.
- Check types if TypeScript.

## After
- Call `remember("mistakes", ...)` with the root cause and the fix.
  Future sessions will hit the same category of bug. Leave a trail.
- Summarize: what broke, why, what you changed, how you confirmed it.
