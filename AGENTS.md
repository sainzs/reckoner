# Reckoner

> *"Because we separate like ripples on a blank shore."* — Radiohead, In Rainbows

A batteries-included pi agent package. Memory, senses, craft, and a safety net.

## What this is

Reckoner is a [pi](https://github.com/mariozechner/pi-coding-agent) package that turns a capable LLM into a trustworthy coding partner. It stays on upstream pi (no fork) and ships everything as extensions, skills, and prompts.

The name comes from In Rainbows. A reckoner figures things out. It accounts for things. It reasons through the mess. And every session, it starts again.

## Project structure

```
reckoner/
├── extensions/           # 10 extensions (TypeScript, loaded via jiti)
│   ├── auto-verify.ts    # tsc + test runner after edits, self-correcting loop
│   ├── git-checkpoint.ts # stash before/after each agent turn, /undo
│   ├── guardrails.ts     # blocks .env/.ssh, dangerous bash patterns
│   ├── memory.ts         # remember/recall tools + session injection
│   ├── nvim-tools.ts     # neovim headless: LSP diagnostics, treesitter symbols, goto-def, references, format
│   ├── plan-mode.ts      # plan/build toggle (Ctrl+T), blocks edits in plan mode
│   ├── principles.ts     # behavioral injection: read first, verify after, be honest
│   ├── repo-map.ts       # structural codebase overview (file tree + rg symbol extraction)
│   ├── web-tools.ts      # web_fetch (Jina Reader) + web_search (Jina API or fallback)
│   └── workspace-context.ts # git state + package scripts in system prompt
├── nvim/
│   └── init.lua          # minimal nvim config for headless use (treesitter + lspconfig only)
├── skills/               # 5 skills
│   ├── implement-feature/SKILL.md
│   ├── debug-failure/SKILL.md
│   ├── review-diff/SKILL.md
│   ├── research-docs/SKILL.md
│   └── plan-and-build/SKILL.md
├── prompts/              # 3 prompt templates
│   ├── plan.md           # /plan <task>
│   ├── review.md         # /review
│   └── research.md       # /research <topic>
├── .pi/memory/           # persistent memory (gitignored)
│   └── preferences.md    # user preferences (helix/nvim, not vscode)
├── package.json          # pi package manifest
├── README.md
└── .gitignore
```

## Build & development

This is a pi package, not an npm project. No build step.

- **Install**: add `"~/Code/reckoner"` to `packages` in `~/.pi/agent/settings.json`
- **Reload**: `/reload` inside any pi session picks up changes instantly
- **Test extensions**: `pi -e ./extensions/some-extension.ts` for isolated testing
- **Nvim setup**: treesitter parsers must be installed (`TSInstall typescript` etc). The `nvim/init.lua` config handles lazy.nvim plugin loading for headless mode.

## Coding style

- TypeScript with 2-space indentation, double quotes, no semicolons
- Extension files use `PascalCase` description in comments, `camelCase` for functions
- Lua files (nvim/) follow standard nvim lua conventions
- Each extension is a single file with a default export function
- Use `StringEnum` from `@mariozechner/pi-ai` for tool parameter enums (NOT `Type.Union`/`Type.Literal` — those break Google API compatibility)

## Tools registered (10)

| Tool | Extension | What it does |
|------|-----------|-------------|
| `web_fetch` | web-tools | Fetch any URL as markdown via Jina Reader |
| `web_search` | web-tools | Search the web (needs JINA_API_KEY) |
| `remember` | memory | Save a note to persistent memory |
| `recall` | memory | Search memory by keyword |
| `repo_map` | repo-map | File tree + symbol extraction via rg |
| `nvim_diagnostics` | nvim-tools | LSP diagnostics for any language via nvim headless |
| `nvim_symbols` | nvim-tools | Treesitter AST symbol extraction |
| `nvim_definition` | nvim-tools | LSP go-to-definition |
| `nvim_references` | nvim-tools | LSP find-all-references |
| `nvim_format` | nvim-tools | LSP format via nvim |

## Commands registered

| Command | Extension | What it does |
|---------|-----------|-------------|
| `/verify on\|off\|run` | auto-verify | Toggle or trigger type checking + tests |
| `/undo` | git-checkpoint | Restore last git checkpoint |
| `/checkpoints` | git-checkpoint | List available checkpoints |
| `/checkpoint on\|off\|now` | git-checkpoint | Toggle or create checkpoint |
| `/plan` | plan-mode | Switch to plan mode (read-only) |
| `/build` | plan-mode | Switch to build mode (full tools) |
| `/mode` | plan-mode | Show or switch current mode |
| `/memory` | memory | Show memory status |
| `/snapshot` | workspace-context | Refresh workspace snapshot |
| `/guardrails on\|off` | guardrails | Toggle safety guardrails |

## Keyboard shortcuts

| Shortcut | What it does |
|----------|-------------|
| `Ctrl+T` | Toggle plan/build mode |

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `JINA_API_KEY` | For web search | Free at https://jina.ai/reader (1M tokens/month) |

## Key decisions made

1. **Stay on upstream pi** — no fork. All additions via extensions/skills/prompts. Zero maintenance burden from tracking upstream.
2. **Nvim as native backend** — neovim headless provides real LSP + treesitter for ANY language. No other agent does this. Uses the user's actual LSP servers and config.
3. **Memory as markdown files** — `.pi/memory/*.md` written by the agent, loaded at session start. Human-readable, versionable, branchable. Not a vector DB.
4. **Auto-verify as turn_end hook** — runs after edits, injects errors as steering messages. Max 2 cycles to prevent loops.
5. **Git checkpoints via stash create** — non-destructive snapshots. Stages untracked files first to capture everything.
6. **Plan mode blocks tools** — not just prompt instructions. The `tool_call` hook literally blocks `edit`/`write` in plan mode.
7. **Principles as system prompt injection** — behavioral guidelines injected every run via `before_agent_start`.
8. **DDG search is dead** — all public search engines serve CAPTCHAs to bots. Web search requires JINA_API_KEY.
9. **StringEnum for Google compat** — `Type.Union`/`Type.Literal` breaks Google's API. Always use `StringEnum` from `@mariozechner/pi-ai`.

## Competitive position

| Feature | Reckoner | Claude Code | Aider | OpenCode |
|---------|----------|-------------|-------|----------|
| Memory (cross-session) | ✅ | ✗ | ✗ | ✗ |
| Nvim LSP diagnostics | ✅ | ✗ | ✗ | ✅ (built-in Go LSP) |
| Treesitter symbols | ✅ | ✗ | ✅ | ✗ |
| Repo map | ✅ rg-based | ✗ | ✅ tree-sitter | ✗ |
| Auto-verify (tsc+tests) | ✅ | ✗ | ✅ | ✅ |
| Web research | ✅ Jina | ✅ built-in | ✗ | ✅ |
| Git safety | ✅ checkpoints | ✗ | ✅ auto-commit | ✅ undo/redo |
| Plan mode | ✅ Ctrl+T | ✗ | ✅ architect | ✅ Tab |
| Principles injection | ✅ | ✗ | ✗ | ✗ |
| Sub-agents | 🔜 | ✗ | ✗ | ✅ |
| LSP go-to-def/refs | ✅ via nvim | ✗ | ✗ | ✅ |
| Context engine | 🔜 | ✗ | ✗ | ✗ |

## Roadmap (what to build next)

### P0 — High impact, ready to build
- [ ] Sub-agents via pi SDK (`createAgentSession`) — explore, research, review as separate agents
- [ ] Task tracking tool (`plan_task`) — structured todo for multi-step work, like OpenCode's `todowrite`
- [ ] Custom compaction — hook `session_before_compact` to preserve memory-relevant info

### P1 — Important, needs more design
- [ ] Persistent nvim server (`--listen`) — skip startup overhead, keep LSP warm
- [ ] Auto-commit on agent_end — proper git history with descriptive messages, not just stashes
- [ ] Augment-style context indexing — semantic search beyond grep

### P2 — Nice to have
- [ ] Nvim rename tool — LSP rename across files
- [ ] Nvim code actions — LSP quick fixes
- [ ] Session reflection — auto-remember at session end
- [ ] Project arc tracking — high-level narrative of what's being built

## User preferences (from memory)

- Editor: Helix or Neovim (not VS Code)
- Aesthetic: dark, atmospheric, Radiohead-influenced
- Philosophy: honesty over confidence, craft over speed, smallest safe change
