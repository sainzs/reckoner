---
name: debug-failure
description: Diagnoses a failing build, test, or runtime issue by reproducing it, narrowing the cause, and verifying the fix.
---

# Debug Failure

1. Run the smallest command that shows the failure. recall() for prior hits.
2. Read recent changes: `git log --oneline -5`, `git diff HEAD~1`.
3. Read the failing file fully. Use sg_search to trace call paths.
4. Run targeted checks to confirm hypotheses. If stuck: web_search the exact error.
5. Fix root cause, not symptom. Keep fix minimal.
6. Re-run the failing command. Run one adjacent test.
7. remember("mistakes", ...) with root cause and fix.
