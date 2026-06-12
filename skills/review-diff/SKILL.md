---
name: review-diff
description: Reviews a staged or branch diff for correctness, regressions, security issues, performance problems, and missing tests.
---

# Review Diff

## Get the diff
- Staged: `git diff --cached`
- Branch: `git diff main...HEAD`
- Last commit: `git diff HEAD~1`

## Read before judging
Read the full context of changed files, not just the hunks. A two-line change can break invariants
established 100 lines away. Use `nvim_symbols` to see the declaration surface of changed files.
Use `sg_search` or `nvim_references` to find callers of changed functions.

## Checklist (in priority order)
1. **Correctness** — does the logic do what it claims? Edge cases, off-by-ones, wrong assumptions.
2. **Regressions** — does anything existing break? Check callers of changed functions.
3. **Error handling** — are failures surfaced or silently swallowed?
4. **Security** — secrets, user input unsanitized, permissions widened.
5. **Tests** — is the behavior covered? Are the tests testing behavior or just lines?
6. **Performance** — O(n²) where O(n) exists, unnecessary allocations, blocking calls.
7. **Clarity** — names that lie, comments that mislead, dead code left behind.

## Output
- Lead with the highest-severity finding.
- Cite specific file + line + behavior.
- If something is fine, say it's fine — don't pad with non-issues.
- Run `nvim_diagnostics` on changed files — real LSP errors catch what eyeballing misses.
- End with: what you would test next if you were merging this.
