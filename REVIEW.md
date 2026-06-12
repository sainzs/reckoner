# System Review — How It All Flows

> A full architectural review of how the harness TUI, CLI tools, brain model,
> skills, and memory interconnect in Reckoner.

Reviewed: 2026-03-29, commit b2c5adc (16 extensions, 5 skills, 3 prompts)

---

## The Full Flow

### 1. Session Start — Orientation

When `pi` starts with Reckoner as a package, 16 extensions load simultaneously.
Here's what fires at `session_start`, in parallel:

```
session_start
  ├─ nvim-server.ts     → spawns headless nvim, emits "reckoner:nvim-ready"
  ├─ workspace-context   → reads git branch, dirty files, package.json
  ├─ auto-verify.ts      → detects test runner (vitest/jest/mocha)
  ├─ memory.ts           → resolves memory directory (.pi/memory/)
  ├─ tasks.ts            → sets status bar from .pi/tasks.md
  ├─ harness-widget.ts   → builds orientation widget (git + task + memory)
  ├─ harness-footer.ts   → replaces default footer
  ├─ nvim-tools.ts       → checks nvim availability
  ├─ ast-grep.ts         → checks ast-grep availability
  ├─ web-tools.ts        → checks JINA_API_KEY
  ├─ git-checkpoint.ts   → clears checkpoint list
  ├─ guardrails.ts       → enables path/command blocking
  ├─ plan-mode.ts        → sets mode to "build"
  └─ harness-overlay.ts  → stores cwd for later
```

**Event cascade:** `nvim-server` emits `reckoner:nvim-ready` → listened by
`auto-verify`, `nvim-tools`, `harness-widget`, `harness-footer` to know the
server socket is available.

### 2. Before Agent Start — System Prompt Assembly

When the user sends a prompt, `before_agent_start` fires. Five extensions
inject into the system prompt, in sequence:

```
before_agent_start (each appends to event.systemPrompt)
  ├─ principles.ts       → behavioral guidelines (~800 chars)
  ├─ workspace-context    → git branch, package name, scripts (~200 chars)
  ├─ memory.ts            → buildInjection() with 3000-char budget:
  │                          1. mistakes (last 10)
  │                          2. codebase (last 5)
  │                          3. preferences (last 5)
  │                          4. questions (last 5)
  │                          5. journal (last 2)
  ├─ tasks.ts             → active task summary if unchecked steps exist (~150 chars)
  └─ plan-mode.ts         → plan-mode instructions if in plan mode
```

**Total injection:** ~4200 chars appended to pi's default system prompt.
This is what the model "sees" before responding.

**Problem found:** The injection order depends on extension load order,
which is filesystem-dependent. If `memory.ts` loads before `principles.ts`,
principles appear first. If the reverse, memory is first. This is
**non-deterministic** and could affect prompt quality. Pi likely processes
hooks in registration order, but we have no guarantee.

### 3. Agent Runs — The Turn Cycle

```
agent_start
  ├─ auto-verify.ts      → clears modified files, resets cycle count
  ├─ git-checkpoint.ts   → creates checkpoint (git stash create)
  └─ harness-widget.ts   → refreshes widget display

turn_start (LLM responds, may call tools)
  └─ harness-footer.ts   → increments turn counter

tool_call (for each tool the LLM invokes)
  ├─ guardrails.ts       → blocks dangerous paths (.env, .ssh) and commands (rm -rf, sudo)
  └─ plan-mode.ts        → blocks edit/write in plan mode

tool_result (after tool execution)
  └─ auto-verify.ts      → tracks modified files from edit/write tools

turn_end (LLM finished a turn)
  ├─ auto-verify.ts      → runs verification:
  │                          1. tsc --noEmit (if tsconfig.json)
  │                          2. nvim LSP diagnostics (non-TS files via server)
  │                          3. test runner (related test files)
  │                          → if errors: injects steering message, triggers new turn
  │                          → max 2 cycles
  ├─ harness-widget.ts   → refreshes (git state may have changed)
  └─ harness-footer.ts   → updates token counts
```

### 4. Agent End — Lesson Emission

```
agent_end
  ├─ auto-verify.ts      → if errors were caught during this run:
  │                          emits "reckoner:lesson" per error group
  │                            → { type, errorKind, files, summary, fixed }
  │
  ├─ memory.ts            → listens for "reckoner:lesson":
  │                          → writes terse entry to mistakes.md
  │                          → deduplicates against last 5 entries
  │
  ├─ git-checkpoint.ts   → creates post-turn checkpoint
  └─ harness-widget.ts   → refreshes (task may have been updated)
```

This is **the loop**. Errors caught → lesson emitted → memory records →
next session's `buildInjection` surfaces it → agent avoids the mistake.

### 5. Next Session — The Loop Closes

When a new session starts, `memory.ts` reads `mistakes.md` and injects
the last 10 entries at position #1 in the system prompt. The agent starts
with knowledge of past mistakes without being told.

---

## The Tool Inventory

### 17 Tools (what the model can call)

| Tool | Extension | Purpose | Backend |
|------|-----------|---------|---------|
| `remember` | memory.ts | Save to persistent memory | filesystem |
| `recall` | memory.ts | Search memory by keyword | filesystem |
| `tasks` | tasks.ts | Plan/check/add/view/done | filesystem |
| `repo_map` | repo-map.ts | File tree + symbols overview | `fd` + `rg` |
| `nvim_diagnostics` | nvim-tools.ts | LSP diagnostics (any language) | nvim server |
| `nvim_symbols` | nvim-tools.ts | Treesitter AST extraction | nvim server |
| `nvim_definition` | nvim-tools.ts | LSP go-to-definition | nvim server |
| `nvim_references` | nvim-tools.ts | LSP find-all-references | nvim server |
| `nvim_format` | nvim-tools.ts | LSP formatting | nvim server |
| `sg_search` | ast-grep.ts | AST pattern search | `ast-grep` |
| `sg_rewrite` | ast-grep.ts | AST pattern rewrite (preview) | `ast-grep` |
| `web_fetch` | web-tools.ts | Fetch URL as markdown | Jina Reader |
| `web_search` | web-tools.ts | Web search | Jina Search |
| `Read` | pi built-in | Read files | filesystem |
| `Edit` | pi built-in | Edit files | filesystem |
| `Write` | pi built-in | Write files | filesystem |
| `Bash` | pi built-in | Execute shell commands | shell |

### 15 Commands (what the operator types)

| Command | Extension | Purpose |
|---------|-----------|---------|
| `/plan` | plan-mode | Switch to read-only mode |
| `/build` | plan-mode | Switch to full mode |
| `/mode` | plan-mode | Show/switch mode |
| `/undo` | git-checkpoint | Restore last checkpoint |
| `/checkpoints` | git-checkpoint | List checkpoints |
| `/checkpoint` | git-checkpoint | Toggle/create checkpoints |
| `/verify` | auto-verify | Toggle verification |
| `/memory` | memory | Show memory status |
| `/task` | tasks | Show task status |
| `/guardrails` | guardrails | Toggle path protection |
| `/snapshot` | workspace-context | Refresh git snapshot |
| `/nvim-server` | nvim-server | Check server status |
| `/footer` | harness-footer | Toggle custom footer |
| `/orient` | harness-overlay | Open orientation panel |
| `/sg` | ast-grep | Quick structural search |

### 2 Shortcuts

| Key | Extension | Purpose |
|-----|-----------|---------|
| `Ctrl+T` | plan-mode | Toggle plan/build |
| `Ctrl+O` | harness-overlay | Open orientation overlay |

---

## The Event Bus — Nervous System

Only 2 custom events, but they carry the system's most important data:

```
reckoner:nvim-ready
  Emitter:   nvim-server.ts (session_start)
  Listeners:  auto-verify.ts     → stores socket for fast diagnostics
              nvim-tools.ts      → stores socket for all 5 operations
              harness-widget.ts  → updates status display
              harness-footer.ts  → tracks nvim availability

reckoner:lesson
  Emitter:   auto-verify.ts (agent_end)
  Listener:  memory.ts → writes to mistakes.md (the loop closes here)
```

---

## Skills and Prompts — Task-Specific Guidance

### 5 Skills (loaded when task matches)

| Skill | Trigger | What it teaches |
|-------|---------|----------------|
| `debug-failure` | failing build/test/runtime | reproduce → narrow → instrument → fix |
| `implement-feature` | user-requested code change | read → plan → smallest edit → verify |
| `plan-and-build` | non-trivial multi-step work | understand → plan → implement step-by-step |
| `research-docs` | unknown library/API/error | search → fetch → extract → remember |
| `review-diff` | code review request | correctness → regressions → security → tests |

Skills are loaded by pi when the task description matches. They provide
step-by-step instructions that shape how the model approaches specific work.

### 3 Prompt Templates

| Template | Trigger | What it injects |
|----------|---------|----------------|
| `plan.md` | planning work | "name the files, name the functions, name the tests" |
| `research.md` | looking things up | search → fetch → extract → remember |
| `review.md` | reviewing changes | correctness → regressions → security → tests |

Templates are invoked by the user and expand into the system prompt.

---

## Problems Found

### Severity: High

**1. nvim_symbols returns stale data via persistent server.**
When I called `nvim_symbols` on three different files, all three returned
auto-verify.ts symbols. The `runOnServer` function opens the file via
`execute("edit ...")` but the treesitter parse in `SERVER_LUA_SYMBOLS` may
execute before the buffer switch completes. Need either:
- A `vim.schedule()` wrapper that ensures buffer is loaded before parsing
- Or check `vim.api.nvim_buf_get_name(0)` matches the expected file

**2. Injection order is non-deterministic.**
Five extensions hook `before_agent_start` and append to `systemPrompt`.
The order depends on which extension loads first, which is filesystem-order
dependent. If principles load after memory, the agent sees lessons before
guidelines. This should be explicitly ordered or use a priority system.

### Severity: Medium

**3. `harness-widget.ts` can't read other extensions' setStatus values.**
It listens for `reckoner:nvim-ready` to know nvim status, but can't see
verify status, mode status, or checkpoint status. The widget's status line
is incomplete. It needs either:
- More events from other extensions
- Or access to `footerData.getExtensionStatuses()` (only available in setFooter)

**4. `workspace-context.ts` widget is removed by `harness-widget.ts` but
workspace-context still builds its prompt block.**
The workspace-context extension injects git state into the system prompt AND
sets a widget. harness-widget removes the widget but the prompt injection is
now duplicated — both workspace-context and the widget show git state. The
prompt injection from workspace-context adds ~200 chars of redundant info
that the harness widget already shows visually.

**5. `repo-map.ts` uses regex-based symbol extraction, not treesitter.**
It runs `rg` with regex patterns like `^\\s*function\\s+\\w+`. This misses
arrow functions, destructured exports, and anything with unusual formatting.
Meanwhile `nvim_symbols` uses proper treesitter parsing and `sg_search` uses
tree-sitter AST patterns. The repo-map tool is the weakest link in code
intelligence — it could delegate to `ast-grep` for symbol extraction.

**6. `auto-verify.ts` runs `tsc` AND potentially nvim diagnostics on TS files.**
For projects with a tsconfig, `tsc --noEmit` runs for the whole project.
Then non-TS files go through nvim. But if there's NO tsconfig, TS files
go through nvim too. This means: in a TS project with tsconfig, the agent
gets tsc errors. In a TS project WITHOUT tsconfig, it gets nvim/ts_ls errors.
The error format differs, which could confuse the model.

**7. `harness-footer.ts` accesses `ctx.sessionManager.getBranch()` which may
throw on ephemeral sessions.**
The token counting loop iterates session entries and casts to `AssistantMessage`.
If the session manager isn't initialized or the branch is empty, this could
silently fail (caught by try/catch) but produce no token data.

### Severity: Low

**8. `parsePlan()` is duplicated in 3 files.**
`tasks.ts`, `harness-widget.ts`, and `harness-overlay.ts` each have their
own copy of the markdown task parser. A bug fix in one won't propagate.
These aren't cross-extension imports (which are banned) — they're utility
code that could live in a shared module.

**9. Task `done` action writes empty string instead of deleting the file.**
`.pi/tasks.md` becomes a 0-byte file. This works (parsePlan returns null)
but is semantically confusing. Should `unlink` instead.

**10. nvim-server process is never explicitly killed.**
`nvim-server.ts` spawns a detached process and unrefs it. No `session_shutdown`
handler. The server process persists until the terminal closes or is manually
killed. If the user runs multiple pi sessions, they accumulate orphan nvim
processes all bound to the same socket path.

**11. Skills don't reference the new tools.**
All 5 skills mention `recall()`, `web_search`, and `web_fetch`, but none
mention `sg_search`, `nvim_diagnostics`, `nvim_symbols`, `repo_map`, or
`tasks`. The skills were written before these tools existed.

---

## What's Connected Well

1. **The learning loop works end-to-end.** auto-verify → lesson → memory →
   injection is clean, tested, and the most important flow in the system.

2. **The nvim server architecture is sound.** One process, warm LSPs, event-based
   discovery. The fallback-to-spawn pattern means nothing breaks if the server
   doesn't start.

3. **Memory two-layer design is elegant.** Storage vs injection, budget tracking,
   priority ordering. The constraint (3000 chars) forces discipline.

4. **Git checkpointing is non-destructive.** `stash create` never modifies the
   working tree. The `/undo` path is safe.

5. **Guardrails are thoughtful.** Blocks `.env` but not `.env.example`. Confirms
   but doesn't block `rm -rf` (the user might need it).

---

## What's Disconnected

1. **Skills don't know about tools.** They were written for a simpler toolset
   and haven't been updated for nvim, ast-grep, tasks, or repo-map.

2. **The harness widget can't see most extension state.** It only knows about
   nvim-server (via event). Everything else (verify, mode, checkpoints) is
   invisible to it.

3. **repo-map uses regex while nvim-tools and ast-grep use tree-sitter.** Two
   parallel symbol extraction systems, one inferior.

4. **workspace-context duplicates what harness-widget shows.** Both display
   git state, but via different mechanisms (prompt injection vs widget).

5. **No extension knows what the agent is about to work on.** Memory injection
   is static — last N entries regardless of relevance. No file-context-aware
   filtering.

---

## Recommendations (priority order)

1. **Fix nvim_symbols stale buffer bug** — high severity, data correctness
2. **Update skills to reference current tools** — medium, affects agent behavior
3. **Replace repo-map regex with ast-grep** — medium, improves code intelligence
4. **Add `reckoner:status-change` event** — so widget can track all extension statuses
5. **Deduplicate workspace-context prompt injection** — remove git info from prompt
   since harness-widget already shows it visually
6. **Add `session_shutdown` handler to nvim-server** — clean up orphan processes
7. **Extract shared utilities** (parsePlan, countEntries) into a `lib/` module
