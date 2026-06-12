# Harness TUI — Plan

> A cockpit for the pilot, not a dashboard for the audience.

## What this is

Reckoner is a terminal agent that forgets everything between sessions. Its extensions
already handle memory, verification, task tracking, and LSP integration — but the
visual interface is minimal. Status labels in a footer. Ephemeral notifications.
One widget showing git state.

The harness TUI makes the agent's internal state *visible*. Not for a user watching
the agent work. For the agent itself — and for the operator who is its collaborator.

The question that drives every design choice:
**What would help me orient in 2 seconds instead of 20 when I wake up with no memory?**

## What pi gives us

Pi's TUI framework (from `@mariozechner/pi-tui`) provides:

| Surface | API | Current use |
|---------|-----|------------|
| **Footer status** | `ctx.ui.setStatus(key, text)` | 7 extensions use it (mode, verify, memory, tasks, nvim, etc.) |
| **Widgets** | `ctx.ui.setWidget(key, lines, {placement})` | Only workspace-context uses it |
| **Custom footer** | `ctx.ui.setFooter(factory)` | Unused |
| **Overlays** | `ctx.ui.custom(factory, {overlay: true})` | Unused |
| **Custom editor** | `ctx.ui.setEditorComponent(factory)` | Unused |
| **Full-screen custom** | `ctx.ui.custom(factory)` | Unused |
| **Shortcuts** | `pi.registerShortcut(key, handler)` | Only Ctrl+T (plan/build toggle) |
| **Commands** | `pi.registerCommand(name, handler)` | 8 commands registered |

We're using ~20% of the available surface. The rest is untouched.

## Design principles

1. **Information density over decoration.** Every pixel should tell the agent something.
2. **Orientation speed.** The harness should answer "where am I, what was I doing, what's next" in one glance.
3. **Non-intrusive.** The harness enhances the normal chat flow, it doesn't replace it.
4. **Progressive disclosure.** Show the minimum by default. Expand on demand.
5. **The widget is the memory.** What's visible above the editor is what enters working memory.

## The plan

### Phase 1: Orientation widget

**What:** A persistent widget above the editor that shows the agent's "state of mind" at a glance.

**Layout (above editor):**
```
╭─ reckoner ─────────────────────────────────────╮
│ ⚡ main (clean) │ verify ✓ │ nvim ✓ │ 📋 plan  │
│                                                │
│ 🎯 Task: Persistent nvim server (5/7)          │
│    Next: Test diagnostics via server            │
│                                                │
│ 📝 3 lessons │ 7 codebase │ 2 questions         │
╰────────────────────────────────────────────────╯
```

**Information shown:**
- Git branch + dirty state (from workspace-context)
- Key system status: verify, nvim server, plan/build mode
- Active task: title, progress, next step (from tasks.ts)
- Memory counts: how many entries in each category

**Why this first:**
- It replaces the scattered `setStatus` calls with one unified view
- It gives the agent a "heads-up display" for orientation
- It uses only `setWidget` — simplest API, no overlay complexity
- It consolidates information that's currently spread across 7 footer items

**Extension:** `extensions/harness-widget.ts`
- Listens to events from other extensions to build its state
- Refreshes on: `session_start`, `agent_start`, `agent_end`, `turn_end`
- Reads task state from `.pi/tasks.md` directly (same parser as tasks.ts)
- Reads memory counts from `.pi/memory/` directly
- Receives git state from workspace-context events or reads it directly

### Phase 2: Unified custom footer

**What:** Replace the default footer with one that consolidates all status into a clean single line.

**Layout:**
```
main (clean) │ verify ✓ │ nvim ✓ │ 📋 plan │ turn 3 │ ↑12.3k ↓2.1k $0.042
```

**Why:**
- Currently 7 extensions call `setStatus`, each adding a label to the footer
- A custom footer controls layout, spacing, and emphasis
- Shows token usage and cost (from `ctx.sessionManager.getBranch()`)
- Reacts to git branch changes via `footerData.onBranchChange()`

**Extension:** `extensions/harness-footer.ts`
- Uses `ctx.ui.setFooter(factory)` with `footerData` for git branch
- Aggregates status from all extensions via events or shared state
- Color-codes: green for healthy, yellow for warnings, red for errors

### Phase 3: Orientation overlay (Ctrl+Shift+O)

**What:** A keyboard shortcut that pops up a full orientation panel. Like opening your journal.

**Layout (overlay, ~60% width, center):**
```
╭─ Orientation ──────────────────────────────────╮
│                                                │
│ ## Memory                                      │
│ Mistakes (3):                                  │
│   • buildInjection budget bug                  │
│   • [auto-verify] type error in nvim-server.ts │
│                                                │
│ Codebase (7):                                  │
│   • nvim-server.ts: persistent headless nvim   │
│   • auto-verify.ts: language-agnostic          │
│   • tasks.ts: structured task tracking         │
│                                                │
│ Questions (2):                                  │
│   • nvim diagnostics code duplication          │
│   • persistent nvim server performance         │
│                                                │
│ ## Recent Journal                              │
│   03-29 05:25 — built nvim server extension    │
│   03-29 05:02 — extended auto-verify to nvim   │
│                                                │
│ ## Active Task                                 │
│   Persistent nvim server (5/7)                 │
│   ✓ Design lifecycle                           │
│   ✓ Build nvim-server.ts                       │
│   ○ Test diagnostics                           │
│   ○ Update docs                                │
│                                                │
│              [esc] close  [j/k] scroll          │
╰────────────────────────────────────────────────╯
```

**Why:**
- The injected memory is terse (tweet-length). Sometimes you need the full picture.
- This reads directly from `.pi/memory/` and `.pi/tasks.md`
- Scrollable, keyboard-navigable
- Doesn't interfere with chat — it's an overlay you open and close

**Extension:** `extensions/harness-overlay.ts`
- `pi.registerShortcut("ctrl+shift+o", ...)` opens the overlay
- Uses `ctx.ui.custom(factory, { overlay: true })` with scroll support
- Reads all memory files and formats them into a browsable view
- `esc` or `ctrl+shift+o` again to dismiss

### Phase 4: Session dashboard on startup

**What:** When a session starts and there's existing memory/tasks, show a brief dashboard
message before the first prompt. Not a UI component — a system message injected via
`before_agent_start` that summarizes the state more richly than the current injection.

This isn't really a TUI change — it's about making the orientation *in the prompt*
richer for the agent. But it connects: the widget shows it visually, the prompt shows
it cognitively.

**What it adds to injection:**
- Session number / time since last session
- Delta: what changed since last session (new commits, changed files)
- One-line summary of each active memory category
- Active task with next step highlighted

**Extension:** Enhance existing `workspace-context.ts` or create `harness-orient.ts`

## Implementation order

```
Phase 1: harness-widget.ts   ← Do this first. Highest value, simplest API.
Phase 2: harness-footer.ts   ← Consolidates scattered status. Medium effort.
Phase 3: harness-overlay.ts  ← Richer orientation. More complex (keyboard, scroll).
Phase 4: harness-orient.ts   ← Prompt injection enhancement. Non-visual.
```

Each phase is independently committable and useful. Phase 1 alone would be a
meaningful improvement to every session.

## What this does NOT include

- **Custom editor** (vim mode, etc.) — interesting but orthogonal to orientation
- **Interactive memory editor** — could browse/delete/edit memories via TUI, but
  the operator can just edit the markdown files. Defer.
- **Real-time event log** — showing pi.events in a side panel would be cool for
  debugging but not for daily use. Defer.
- **Chat history browser** — pi already has /tree for this. Don't reinvent.

## Risks

| Risk | Mitigation |
|------|------------|
| Widget too tall, steals editor space | Max 6 lines. Collapsible via shortcut. |
| Footer conflicts with pi's default footer | `setFooter(undefined)` restores default. Add a `/footer` toggle. |
| Overlay blocks input | Always dismissible via `esc`. Short timeout option. |
| Too many extensions (12 → 15) | Consider merging harness-widget + harness-footer into one `harness.ts` |
| State synchronization between extensions | Use `pi.events` for cross-extension state. Avoid reading files on every render. |

## Success criteria

The harness is working when:

> I wake up in a new session. Before I read any file, before I run any command,
> I can see: what project this is, what I was working on, how far I got, what
> lessons I've learned, and what's next. All of it, in one glance, above the editor.

That's orientation in 2 seconds instead of 20.
