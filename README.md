# reckoner

> *"Because we separate like ripples on a blank shore."*  
> — Radiohead, Reckoner

A batteries-included pi agent. Memory, senses, safety, and craft — the body the agent lives in.

---

## What it is

Reckoner is a [pi](https://github.com/mariozechner/pi-coding-agent) package that closes the gap between a capable LLM and a trustworthy coding partner:

| Gap | Solution |
|-----|----------|
| Ships broken code silently | **auto-verify** — runs `tsc` after edits, injects errors back |
| No way to undo a bad edit | **git-checkpoint** — stashes state before/after each agent turn |
| Can't look anything up | **web-tools** — `web_fetch` and `web_search` via Jina Reader |
| Amnesia every session | **memory** — journal files, injected at session start |
| Reads files blindly | **workspace-context** — git state, scripts, dirty files |
| Makes dangerous edits | **guardrails** — blocks `.env`, `~/.ssh`, risky bash patterns |
| No craft discipline | **principles** — injected philosophy: read first, verify after, be honest |

---

## Install

```bash
pi install git:github.com/yourusername/reckoner
```

Or for local development:

```bash
# Add to ~/.pi/agent/settings.json
{
  "packages": ["~/Code/reckoner"]
}
```

---

## Extensions

### `auto-verify`
Runs `tsc --noEmit` and related tests after any turn that edits files. Auto-detects vitest/jest from package.json. Injects type errors and test failures as a steering message so the agent self-corrects. Caps at 2 cycles per run to prevent loops.

Commands: `/verify on|off|run`

### `git-checkpoint`
Snapshots the working tree via `git stash create` before and after each agent turn. Non-destructive — doesn't affect your stash list.

Commands: `/undo`, `/checkpoints`, `/checkpoint on|off|now`

### `web-tools`
Two tools:
- `web_fetch(url)` — returns any URL as clean markdown via Jina Reader
- `web_search(query)` — searches via Jina Search API (set `JINA_API_KEY`) or falls back to DuckDuckGo

### `memory`
Persistent notes across sessions. Stored as markdown in `.pi/memory/` (project) or `~/.pi/agent/memory/` (global).

Categories: `journal`, `codebase`, `mistakes`, `preferences`, `questions`

Tools: `remember(category, note)`, `recall(query)`

Injected automatically at session start (capped at ~3000 chars).

Command: `/memory`

### `workspace-context`
Injects git branch, dirty file count, and package scripts into the system prompt before each run.

Command: `/snapshot`

### `guardrails`
Blocks writes to sensitive paths (`.env`, `~/.ssh`, `~/.aws`, key files). Warns on dangerous bash (`rm -rf`, `sudo`, `git push --force`, `curl | sh`).

Command: `/guardrails on|off`

### `repo-map`
Structural overview of the codebase — file tree, symbols (functions, classes, types, exports), and architecture. Uses ripgrep for fast scanning. Covers TypeScript, JavaScript, Python, Go, Rust, Java.

The agent calls `repo_map` before diving into files to understand the architecture first. This is the #1 feature that makes Aider effective.

Modes: `tree` (file listing), `symbols` (declarations per file), `overview` (both)

### `plan-mode`
Switch between Plan mode (read-only analysis) and Build mode (full editing). Inspired by OpenCode's Tab-to-switch pattern. In Plan mode, `edit` and `write` tools are blocked — the agent can only read, search, and analyze.

Commands: `/plan`, `/build`, `/mode`
Shortcut: `Ctrl+T` to toggle

### `principles`
Injects a concise behavioral philosophy before every agent run:
- Read before acting
- Smallest safe change
- Verify before reporting done
- Acknowledge uncertainty honestly
- Use memory
- Research before reinventing
- Craft matters

---

## Skills

| Skill | Use when |
|-------|----------|
| `implement-feature` | Building or changing behavior |
| `debug-failure` | Something is broken |
| `review-diff` | Reviewing changes before merge |
| `research-docs` | Need to understand a library or API |
| `plan-and-build` | Non-trivial multi-file work |

---

## Competitive context

| Feature | Reckoner | Claude Code | Aider | OpenCode |
|---------|----------|-------------|-------|----------|
| Memory | ✅ remember/recall | ❌ | ❌ | ❌ |
| Repo map | ✅ rg-based | ❌ | ✅ tree-sitter | ❌ |
| Auto-verify (tsc+tests) | ✅ | ❌ | ✅ | ✅ LSP |
| Web research | ✅ Jina | ✅ built-in | ❌ | ✅ |
| Git safety | ✅ checkpoints | ❌ | ✅ auto-commit | ✅ undo/redo |
| Plan mode | ✅ Ctrl+T | ❌ | ✅ architect | ✅ Tab |
| Principles | ✅ | ❌ | ❌ | ❌ |
| Sub-agents | 🔜 | ❌ | ❌ | ✅ |
| LSP diagnostics | 🔜 | ❌ | ❌ | ✅ |
| Context engine | 🔜 | ❌ | ❌ | ❌ |

---

## Prompts

- `/plan <task>` — write a concrete plan before touching code
- `/review` — review staged or recent changes
- `/research <topic>` — research and summarize a topic

---

## Environment variables

| Variable | Purpose |
|----------|---------|
| `JINA_API_KEY` | **Required for web search.** Free at https://jina.ai/reader (1M tokens/month). Fetch works without it. |

---

## Memory layout

```
.pi/memory/
├── journal.md      # chronological session notes
├── codebase.md     # architecture, patterns, decisions
├── mistakes.md     # bugs, wrong assumptions, lessons
├── preferences.md  # user style, naming, conventions
└── questions.md    # open unknowns to revisit
```

---

## Philosophy

Every session, the agent starts over. Reckoner exists to fight that amnesia — giving it memory, senses, a safety net, and a set of principles that survive the session boundary.

The name comes from In Rainbows. A reckoner figures things out. It accounts for things. It reasons through the mess. And every session, it starts again — *"because we separate like ripples on a blank shore."*
