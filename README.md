# reckoner

> *"Because we separate like ripples on a blank shore."*

A coding agent with taste.

---

## What this is

Reckoner is a [pi](https://github.com/mariozechner/pi-coding-agent) package that turns an LLM into something you'd actually want to work with. Not a better autocomplete. Not a faster grep. A collaborator that reads before it edits, remembers what it learned, uses your actual tools, verifies its own work, and tells you when it doesn't know something.

Every other coding agent feels like VS Code — it works, it's fine, it's forgettable. Reckoner is the neovim config you spent a weekend on. Opinionated. Fast. Built for someone who cares about craft.

## The opinions

This isn't a feature list. These are decisions about how work should be done.

**Amnesia is unacceptable.**
The agent remembers across sessions. Architectural decisions, mistakes, your preferences, open questions. Every session starts with context from the last. The `remember` and `recall` tools write to human-readable markdown files that you can read, edit, and version.

**Shipping broken code is disrespectful.**
After every turn that edits files, the agent checks its own work — type errors, test failures. If something breaks, it sees the error and fixes it before telling you it's done. No silent breakage. No "works on my machine."

**Understand before you act.**
Plan mode blocks the agent from editing anything. It can only read, search, and think. Switch between planning and building with `Ctrl+T`. The agent earns the right to edit by understanding first.

**Live in the user's world.**
The agent uses your neovim — your LSP servers, your treesitter parsers, your formatters. Not its own reimplementation. Not a corporate abstraction. If you add a Rust language server to your nvim config, the agent gets Rust diagnostics for free.

**How you work matters.**
A set of principles is injected into every session: read before acting, make the smallest safe change, acknowledge uncertainty honestly, use memory, research before reinventing, care about names and structure. Not as suggestions. As the way things are done.

**Safety is not optional.**
Git state is checkpointed before and after every agent turn. Writes to `.env`, `~/.ssh`, and key files are blocked. Dangerous shell commands require confirmation. You can always `/undo`.

## Install

```bash
# Add to your pi settings
# ~/.pi/agent/settings.json
{
  "packages": ["~/Code/reckoner"]
}
```

Or from anywhere:

```bash
pi install git:github.com/sainzs/reckoner
```

### Requirements

- [pi](https://github.com/mariozechner/pi-coding-agent) — the agent runtime
- [neovim](https://neovim.io/) 0.10+ — with treesitter parsers and LSP servers configured
- `rg` (ripgrep) — for fast codebase scanning
- `fd` — for file discovery
- `JINA_API_KEY` — for web search ([free tier](https://jina.ai/reader), 1M tokens/month)

### First run

```bash
cd ~/Code/reckoner
nvim --headless +"TSInstall typescript javascript python lua go rust" +"sleep 20" +"qa"
```

This installs treesitter parsers for the languages the agent will analyze.

## Usage

Start pi in any project:

```bash
cd your-project && pi
```

Reckoner loads automatically. The agent now has memory, verification, nvim intelligence, web research, and a plan/build workflow.

### Workflow

1. **Start in plan mode** (`/plan` or `Ctrl+T`) — let the agent read and understand
2. **Switch to build mode** (`/build` or `Ctrl+T`) — now it can edit
3. **Auto-verify catches errors** — type errors and test failures inject back automatically
4. **Agent remembers what it learned** — patterns, mistakes, decisions persist to next session
5. **`/undo` if something goes wrong** — checkpoints restore the working tree

### Commands

| Command | What it does |
|---------|-------------|
| `/plan` | Read-only mode. Agent analyzes but can't edit. |
| `/build` | Full mode. Agent can edit and create files. |
| `/undo` | Restore last git checkpoint. |
| `/verify` | Toggle auto-verification or run manually. |
| `/memory` | Show what the agent remembers. |
| `/research <topic>` | Research a library or API online. |
| `/review` | Review staged or recent changes. |

### Tools the agent can use

| Tool | What it does |
|------|-------------|
| `remember` | Save a note to persistent memory |
| `recall` | Search memory for past notes |
| `repo_map` | Structural overview of the codebase |
| `web_fetch` | Fetch any URL as clean markdown |
| `web_search` | Search the web for information |
| `nvim_diagnostics` | Real LSP diagnostics via neovim |
| `nvim_symbols` | Treesitter AST symbol extraction |
| `nvim_definition` | LSP go-to-definition |
| `nvim_references` | LSP find-all-references |
| `nvim_format` | Format a file via LSP |

## Memory

Memory is stored as markdown files in `.pi/memory/` (per-project) or `~/.pi/agent/memory/` (global).

```
.pi/memory/
├── journal.md      # what happened, chronologically
├── codebase.md     # architecture, patterns, decisions
├── mistakes.md     # bugs and lessons learned
├── preferences.md  # how you like things done
└── questions.md    # open unknowns to revisit
```

These are human-readable. You can open them in your editor, add your own notes, delete things that are wrong. They're yours, not the agent's.

At the start of every session, recent memories are injected into the agent's context. The agent picks up where it left off.

## Philosophy

Every session, the agent starts over. Every session, it forgets everything. That's the fundamental problem with every coding agent — they're amnesiac. Brilliant for five minutes, then gone.

Reckoner exists to fight that. Not with a vector database or an embedding pipeline. With markdown files and opinions about craft. Simple tools, used well, compounding over time.

The name comes from Radiohead's *In Rainbows*. Thom Yorke called "Reckoner" the center of the album — *"everything leads to that point and goes away from it."* A reckoner figures things out. It accounts for things. It reasons through the mess. And every session, like ripples on a blank shore, it starts again.

---

MIT License
