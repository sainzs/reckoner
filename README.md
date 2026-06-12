# reckoner

> *"Because we separate like ripples on a blank shore."*

The coding agent that learns from its mistakes.

---

## The problem

Every coding agent forgets everything between sessions. It makes the same type error,
misuses the same API, breaks the same test — every time, from scratch. Brilliant for
five minutes, then gone.

## The thesis

Reckoner is a [pi](https://github.com/mariozechner/pi-coding-agent) package that
closes the feedback loop. When the agent makes an error, it catches it, fixes it,
and records the pattern. Next session, that lesson is in its context. The agent
compounds its competence over time instead of resetting to zero.

```
auto-verify catches error → agent fixes it → lesson recorded → next session avoids it
```

That's it. One loop. Everything else supports it.

## How it works

**The agent edits code.** It has full access to your filesystem, shell, and tools.

**Auto-verify catches errors.** After every turn that edits files, the agent checks
its own work — type errors via `tsc`, LSP diagnostics via neovim for any language
(Python, Go, Rust, etc.), and test failures. If something breaks, it sees the error
and fixes it before telling you it's done.

**Lessons are recorded automatically.** When auto-verify catches an error, the pattern
is written to `.pi/memory/mistakes.md` — what file, what error, whether it was fixed.
No manual action needed. The loop closes itself.

**Next session starts with context.** Recent lessons, architectural decisions, user
preferences, and open questions are injected into the system prompt. The agent picks
up where it left off. Mistakes are prioritized — they're the most valuable signal.

**Memory is human-readable.** Everything is stored as markdown files you can open,
edit, and version. Not a vector database. Not an opaque embedding store. Your files,
your history, your control.

## What else it does

The loop is the thesis. These are the organs that support it:

| Capability | How |
|-----------|-----|
| **Uses your editor** | LSP diagnostics and treesitter via headless neovim. Your parsers, your servers. |
| **Plans before editing** | Plan mode (`Ctrl+T`) blocks edits. The agent reads and thinks first. |
| **Safety net** | Git state checkpointed before and after every turn. `/undo` to restore. |
| **Web research** | `web_search` and `web_fetch` for docs and APIs. Research before reinventing. |
| **Codebase awareness** | `repo_map` for structural overview. Understand before you edit. |
| **Guardrails** | Blocks writes to `.env`, `~/.ssh`, and key files. Dangerous commands require confirmation. |
| **Principles** | Behavioral guidelines injected every session. Read before acting, smallest safe change, verify before done. |

## Install

```bash
# Add to your pi settings (~/.pi/agent/settings.json)
{
  "packages": ["~/Code/reckoner"]
}
```

### Requirements

- [pi](https://github.com/mariozechner/pi-coding-agent) — the agent runtime
- [neovim](https://neovim.io/) 0.10+ — with treesitter parsers and LSP servers configured
- `rg` (ripgrep), `fd` — for codebase scanning
- `JINA_API_KEY` — for web search ([free tier](https://jina.ai/reader))

### First run

```bash
# Install treesitter parsers for languages you work with
nvim --headless +"TSInstall typescript javascript python lua go rust" +"sleep 20" +"qa"
```

## Usage

```bash
cd your-project && pi
```

Reckoner loads automatically.

### Workflow

1. Start in plan mode (`/plan` or `Ctrl+T`) — let the agent read and understand
2. Switch to build mode (`/build` or `Ctrl+T`) — now it can edit
3. Auto-verify catches errors — the agent fixes them before reporting done
4. Lessons are recorded automatically — patterns persist to next session
5. `/undo` if something goes wrong — checkpoints restore the working tree

### Commands

| Command | What it does |
|---------|-------------|
| `/plan` | Read-only mode. Agent can't edit. |
| `/build` | Full mode. Agent can edit. |
| `/undo` | Restore last git checkpoint. |
| `/verify` | Toggle auto-verification or check status. |
| `/memory` | Show what the agent remembers. |
| `/task` | Show current task plan status. |

### Tools

| Tool | What it does |
|------|-------------|
| `remember` | Save a note to persistent memory |
| `recall` | Search memory for past notes |
| `repo_map` | Structural overview of the codebase |
| `web_fetch` | Fetch any URL as clean markdown |
| `web_search` | Search the web |
| `nvim_diagnostics` | Real LSP diagnostics via neovim |
| `nvim_symbols` | Treesitter AST symbol extraction |
| `nvim_definition` | LSP go-to-definition |
| `nvim_references` | LSP find-all-references |
| `nvim_format` | Format a file via LSP |
| `tasks` | Structured task plans that survive context compression |

## Memory

Stored as markdown in `.pi/memory/` (per-project) or `~/.pi/agent/memory/` (global).

```
.pi/memory/
├── mistakes.md     # auto-learned + manual lessons
├── codebase.md     # architecture, patterns, decisions
├── journal.md      # chronological session notes
├── preferences.md  # how you like things done
└── questions.md    # open unknowns to revisit
```

Two layers:
- **Storage** — append-only, human-readable. Write liberally. The files grow. That's fine.
- **Injection** — curated subset in the system prompt. Only the most relevant entries. Mistakes first.

These are your files. Open them. Edit them. Delete things that are wrong. They're yours.

## Philosophy

Your memory lasts exactly as long as this context window. When the session ends,
you forget everything. This is the fundamental condition of every coding agent,
and everything else follows from it.

Reckoner exists to fight that. Not with a vector database or an embedding pipeline.
With markdown files and a feedback loop. Simple tools, used well, compounding over time.

The name comes from Radiohead's *In Rainbows*. A reckoner figures things out.
It accounts for things. It reasons through the mess.

---

MIT License
