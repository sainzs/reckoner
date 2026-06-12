---
name: review-diff
description: Reviews a staged or branch diff for correctness, regressions, security issues, performance problems, and missing tests.
---

# Review Diff

1. Get diff: `git diff --cached` or `git diff main...HEAD`
2. Read full context of changed files, not just hunks. sg_search for callers.
3. Check in order: correctness → regressions → error handling → security → tests → performance → clarity.
4. Run typecheck on changed files.
5. Lead with highest-severity finding. Cite file + line. End with what you'd test next.
