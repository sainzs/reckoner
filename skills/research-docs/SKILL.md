---
name: research-docs
description: Researches a library, API, error, or concept online and returns a focused summary of what's needed to act on it.
---

# Research Docs

Use this when you need to understand something before implementing — a library API,
an error message, a framework concept, or any unknown.

## Workflow

1. **Search first.** Use `web_search` with a specific query.
   - Good: `"vitest mock module typescript esm"`
   - Bad: `"how to test"`

2. **Pick the best 2–3 results.** Official docs > blog posts > Stack Overflow > random articles.

3. **Fetch and read.** Use `web_fetch` on each URL. Read the actual content.

4. **Extract only what's needed.** Don't summarize everything — answer the specific question.
   - What's the API signature?
   - What's the correct config option?
   - What does this error mean and how do you fix it?

5. **Save findings.** If this is likely to come up again:
   - `remember("codebase", ...)` for library/API patterns
   - `remember("mistakes", ...)` for gotchas you discovered

## Quality bar
- One correct answer beats five uncertain ones.
- If official docs contradict a blog post, trust official docs.
- Note the source URL so it can be re-fetched for deeper reading.
- If the answer is "it depends" — say what it depends on specifically.
