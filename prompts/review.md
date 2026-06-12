---
description: Review staged or recent changes for bugs, regressions, and missing tests
---
Review the diff (`git diff --cached` or `git diff HEAD~1`) for:

- correctness bugs and wrong assumptions
- regressions in callers or adjacent code
- error handling gaps
- security issues or secret leakage
- missing or weak tests
- performance problems

Lead with the highest-severity finding. Be specific — cite file, behavior, and why it's a problem.
If something is fine, say so plainly. End with what you'd test before merging.
