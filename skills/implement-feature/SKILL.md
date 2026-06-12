---
name: implement-feature
description: Implements a user-requested code change by gathering context, making the smallest safe edit, and verifying it passes.
---

# Implement Feature

1. recall() for related past work. Read every file you'll edit — whole file.
2. State: what files, what change, what test confirms it.
3. Make the minimal change. Match existing style.
4. Run targeted test first, then typecheck on changed files.
5. Read `git diff` before reporting done.
6. remember("codebase"|"mistakes", ...) for decisions or bugs hit.
