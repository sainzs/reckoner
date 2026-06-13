# reckoner

> *"Because we separate like ripples on a blank shore."*

The memory and policy package for Agent Workbench.

---

## The problem

Every coding agent forgets everything between sessions. It makes the same type error,
misuses the same API, breaks the same test - every time, from scratch. Brilliant for
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
its own work — type errors, test failures, and diagnostic issues. If something
breaks, it sees the error and fixes it before telling you it’s done.

**Lessons are recorded automatically.** When auto-verify catches an error, the pattern
is written to `.pi/memory/mistakes.md` - what file, what error, whether it was fixed.
No manual action needed. The loop closes itself.

**Next session starts with context.** Recent lessons, architectural decisions, user
preferences, and open questions are injected into the system prompt. The agent picks
up where it left off. Mistakes are prioritized - they're the most valuable signal.

**Memory is human-readable.** Everything is stored as markdown files you can open,
edit, and version. Not a vector database. Not an opaque embedding store. Your files,
your history, your control.

## What else it does

The loop is the thesis. These are the organs that support it:

| Capability | How |
|-----------|-----|
| **Structural search** | AST-aware code search and refactoring via ast-grep. |
| **Plans before editing** | Plan mode (`Ctrl+T`) blocks edits. The agent reads and thinks first. |
| **Safety net** | Git state checkpointed before and after every turn. `/undo` to restore. |
| **Web research** | `web_search` and `web_fetch` for docs and APIs. Research before reinventing. |
| **Codebase awareness** | `repo_map` for structural overview. Understand before you edit. |
| **Guardrails** | Blocks writes to `.env`, `~/.ssh`, and key files. Dangerous commands require confirmation. |
| **Principles** | Behavioral guidelines injected every session. Read before acting, smallest safe change, verify before done. |

## Getting started

```bash
git clone https://github.com/sainzs/reckoner.git
cd reckoner
npm install
npm run verify:self
```

### Requirements

| Requirement | Why |
|---|---|
| [pi](https://github.com/mariozechner/pi-coding-agent) 0.64+ | the agent runtime |
| `rg` (ripgrep) | codebase scanning |
| `fd` | file discovery |
| `JINA_API_KEY` | web search - [free tier](https://jina.ai/reader) |

### Run with pi from this package

```bash
pi -e .
```

Runs the package in-place for that session.

## Usage

```bash
cd your-project && pi
```

Reckoner loads automatically.

### Workflow

1. Start in plan mode (`/plan` or `Ctrl+T`) - let the agent read and understand
2. Switch to build mode (`/build` or `Ctrl+T`) - now it can edit
3. Auto-verify catches errors - the agent fixes them before reporting done
4. Lessons are recorded automatically - patterns persist to next session
5. `/undo` if something goes wrong - checkpoints restore the working tree

### Model routing

The canonical task→model policy lives in [`docs/orientation-policy.md`](docs/orientation-policy.md) and [`prompts/model-routing.md`](prompts/model-routing.md). The matching skill is a thin wrapper around that shared policy, and `opencode.json` pins the same mappings for OpenCode agents.

### Commands

| Command | What it does |
|---------|-------------|
| `/plan` | Switch to read-only mode. Agent can read but not edit. |
| `/build` | Switch to full mode. Agent can edit. |
| `/undo` | Restore last git checkpoint. |
| `/verify` | Toggle verification. Sub-commands: `run`, `last`, `baseline`. |
| `/memory` | Show what the agent remembers. `recent` for last entries. |
| `/lessons` | Inspect stored lessons. Sub-commands: `repeated`, `unresolved`, `promoted`, `file <path>`. |
| `/metrics` | Show learning-loop metrics. Sub-commands: `recent`, `repeated`. |
| `/orient` | Open orientation overlay (also `Ctrl+Shift+O`). |
| `/inject` | Show last prompt injection trace and budget. |
| `/task` | Show current task plan. |
| `/tone` | Switch theme. Options: `random` (default), `dusk`, `factory`. |
| `/snapshot` | Refresh and show workspace context. |
| `/guardrails` | Show or toggle safety guardrails. |

### Tools

| Tool | What it does |
|------|-------------|
| `remember` | Save a note to persistent memory |
| `recall` | Search memory for past notes |
| `repo_map` | Structural overview of the codebase |
| `sg_search` | Structural code search + rewrite preview via AST patterns |
| `web_fetch` | Fetch any URL as clean markdown |
| `web_search` | Search the web |

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
- **Storage** - append-only, human-readable. Write liberally. The files grow. That's fine.
- **Injection** - curated subset in the system prompt. Only the most relevant entries. Mistakes first.

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

[MIT License](LICENSE) · [Contributing](CONTRIBUTING.md) · [Code of Conduct](CODE_OF_CONDUCT.md)
