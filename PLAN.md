# Plan: Close the Loop

> The agent that compounds across sessions.

## Thesis

Reckoner is not a collection of extensions. It is one system with one thesis:
**an agent that treats errors as data, externalizes what it learns, and compounds
its competence across sessions.**

The genesis document already said this:
- *"Your memory lasts exactly as long as this context window. Anything you want to survive must be written to disk."*
- *"Errors are data. Understand why before you fix."*
- *"State should be visible."*

We built the organs. We never built the nervous system.

## The Loop

This is the system we're building. Every arrow is a data flow that must exist in code.

```
          ┌─────────────────────────────────────────────────────┐
          │                                                     │
          ▼                                                     │
    agent edits code                                            │
          │                                                     │
          ▼                                                     │
    auto-verify catches errors ──── no errors ──► done          │
          │                                                     │
          │ yes                                                 │
          ▼                                                     │
    agent fixes the errors                                      │
          │                                                     │
          ▼                                                     │
    lesson emitted (pi.events) ◄── what broke, what fixed it   │
          │                                                     │
          ▼                                                     │
    memory records the pattern ──► mistakes.md                  │
          │                                                     │
          ▼                                                     │
    next session starts                                         │
          │                                                     │
          ▼                                                     │
    memory injects relevant lessons into system prompt ─────────┘
          │
          ▼
    agent avoids the mistake
```

**What exists today:** The top half. Auto-verify catches errors, agent fixes them.
**What's missing:** Every arrow from "lesson emitted" downward. The errors vanish.
The agent makes the same mistake next session.

## The Nervous System: `pi.events`

Pi provides `pi.events` — a shared event bus between extensions. This is our
nervous system. Extensions don't import each other. They communicate through events.

### Event Protocol

```typescript
// Emitted by auto-verify when errors are caught and resolved
pi.events.emit("reckoner:lesson", {
  type: "auto-verify",
  files: ["src/foo.ts", "src/bar.ts"],
  errors: ["TS2345: Argument of type 'string' not assignable to 'number'"],
  fixed: true,
  cycles: 1,
  timestamp: Date.now(),
})

// Emitted by session-reflection at agent_end
pi.events.emit("reckoner:reflection", {
  filesEdited: ["src/foo.ts"],
  errorsEncountered: 2,
  errorsFixed: 2,
  summary: "Refactored auth module, caught type error in token refresh",
  timestamp: Date.now(),
})
```

Memory listens. Other extensions can listen too. The protocol is open.

## Changes

### 1. `extensions/auto-verify.ts` — emit lessons

**Current:** Tracks errors, injects steering message, counts cycles. Forgets everything at agent_end.

**Change:**
- Store error details (not just counts) — the actual error messages and affected files
- At `agent_end`: if `verifyCycles > 0` (errors were caught), emit `reckoner:lesson`
- Include: files involved, error messages, whether all errors were resolved, cycle count
- Keep the existing steering behavior unchanged — this is additive

**Key detail:** The lesson captures *what went wrong*, not *how it was fixed*. The fix
is in the conversation context. The lesson is for pattern recognition across sessions:
"I keep making type errors when editing token refresh in this repo."

### 2. `extensions/memory.ts` — listen for lessons + smarter injection

**Current:**
- `remember` / `recall` tools (manual)
- `buildInjection` injects last 4 journal entries + all category content
- Budget: 3000 chars, often filled with journal noise

**Changes:**

#### 2a. Listen for `reckoner:lesson` events
- On `reckoner:lesson`: write a concise entry to `mistakes.md`
- Format: timestamp, files, error summary, outcome
- Keep entries short — one lesson per block, max 3-4 lines
- Deduplicate: if the same error pattern already exists in recent entries, skip it

#### 2b. Rewrite `buildInjection` priority order
Current order: journal (recent 4) → all other categories
New order:
1. **mistakes** (all — these are the most valuable for the loop)
2. **codebase** (all — architectural decisions prevent structural errors)
3. **preferences** (all — user style)
4. **questions** (all — open unknowns)
5. **journal** (last 2 — chronological context, but lower priority)

#### 2c. Increase budget
- Raise `MAX_INJECT_CHARS` from 3000 to 5000
- Mistakes and codebase notes are high-signal, low-noise — they deserve more space
- If budget is exceeded, truncate journal first, then questions

#### 2d. Label sections for the agent
- Add a preamble: "These are lessons from past sessions. Use them to avoid repeating mistakes."
- Label mistakes clearly: "### Mistakes (auto-learned)"
- This helps the model understand *why* the context is there

### 3. `extensions/session-reflect.ts` — new extension

**Purpose:** At the end of every agent run, automatically reflect on what happened.
This is the "session reflection" from the P1 roadmap, but scoped to the loop.

**Behavior:**
- Hook: `agent_end`
- Check: were files edited? (`tool_result` events with `edit`/`write`)
- Check: did auto-verify fire? (listen for `reckoner:lesson` events during this agent run)
- If either is true: write a concise journal entry via memory
  - What files were touched
  - Whether auto-verify caught anything
  - One-line summary of the work
- If neither: do nothing (pure read-only sessions don't need reflection)

**Key constraint:** This must be automatic. The agent shouldn't have to call `remember()`.
The loop closes itself.

### 4. `AGENTS.md` — rewrite around the thesis

**Current:** Feature list. "A coding agent with taste."

**New structure:**
- **What you are:** The self-correcting agent. You compound across sessions.
- **The loop:** The diagram. Every extension's role in the loop.
- **Your principles:** Keep these — they're good. Add: "Treat errors as data."
- **Extensions as a system:** Not a feature list. Show how they connect.
- **Technical decisions:** Keep the table — it's useful.
- **What to build next:** Reframe around deepening the loop, not adding features.

### 5. `README.md` — reframe the narrative

**Current:** "A coding agent with taste." Feature list with opinions.

**New lead:** The loop. The thesis. Then the features as consequences of the thesis,
not independent opinions.

Keep:
- Install section
- Usage section
- Commands table
- Memory section

Reframe:
- Opening: the problem (agents forget), the thesis (this one doesn't)
- "The opinions" → "How the loop works"
- Philosophy section: tie back to genesis

### 6. `package.json` — update description

Current: "A batteries-included pi agent."
New: "The coding agent that learns from its mistakes."

## Implementation Order

Dependencies flow downward. Each step is independently committable.

```
1. auto-verify.ts  ──── emits lessons (producer)
        │
2. memory.ts       ──── listens + better injection (consumer)
        │
3. session-reflect.ts ── auto-journal (new extension)
        │
4. AGENTS.md       ──── rewrite (identity)
        │
5. README.md       ──── reframe (narrative)
        │
6. package.json    ──── description update
```

Steps 1-3 are the code changes. Steps 4-6 are the documentation.
Steps 1 and 2 are the **minimum viable loop**. Everything else builds on it.

## Risks

| Risk | Mitigation |
|------|------------|
| `pi.events` might not work across extensions as expected | Test with a simple emit/listen before building the full thing |
| Auto-generated memory entries might be noisy | Keep entries short (3-4 lines). Deduplicate. Can always tune later. |
| Injection budget too small for useful lessons | Raising to 5000 chars. If still too small, make it configurable. |
| Session-reflect might generate useless entries for trivial edits | Only reflect when files were edited AND verify fired. Skip trivial. |
| Memory deduplication is hard without embeddings | Simple string matching on error messages. Good enough for v1. |

## Verification

For each step:

1. **auto-verify.ts**: Make a type error in a .ts file. Watch auto-verify catch it.
   Check that a `reckoner:lesson` event is emitted (log it).

2. **memory.ts**: Verify the lesson event writes to `mistakes.md`.
   Verify `buildInjection` now prioritizes mistakes.
   Start a new session — confirm mistakes appear in the injected context.

3. **session-reflect.ts**: Edit a file. Check that a journal entry is auto-written
   at agent_end. Check that read-only sessions don't generate entries.

4. **AGENTS.md / README.md**: Read them. Do they tell a coherent story?
   Does someone reading AGENTS.md understand why each extension exists?

5. **Full loop**: Start a session. Edit code. Let auto-verify catch an error.
   End the session. Start a new session. Check that the lesson from the last
   session appears in the system prompt. Ask the agent about it.

## Rollback

- `git stash create` before starting
- Each extension change is independent — can revert any file without breaking others
- The event protocol is fire-and-forget — if no one listens, nothing breaks

## What this does NOT include

- **Learned principles** (principles.ts evolving from mistakes) — too complex for v1.
  The loop needs to prove itself first. If mistakes.md accumulates useful patterns,
  we can synthesize them into principles later.

- **Custom compaction** (preserving memory during context compression) — important but
  orthogonal. Memory is on disk, not in context. Compaction loses conversation history,
  not memories. This is a real problem but a separate one.

- **Sub-agents** — still valuable but not part of the loop. Defer.

- **Semantic search** (embedding-based recall) — keyword search is good enough for v1.
  The memories are short and categorical. We don't need cosine similarity yet.

## Status

**The loop is closed.** Verified end-to-end (2026-03-29):

> Session 1: agent introduced type error in src/math.ts, auto-verify caught TS2322,
> agent fixed it, lesson written to mistakes.md automatically.
> Session 2: buildInjection surfaced the lesson in the system prompt, agent reported
> it without being told. The lesson survived the session boundary.

Since then:
- Budget enforcement fixed (sections respect remaining budget, not just thresholds)
- Task tracking added (structured plans that survive context compression)
- Auto-verify extended to any language via headless nvim LSP diagnostics
- Tasks status bar fix (blank → "no task" after completion)

### What's next

The loop exists and works. These deepen it:

1. **Relevance filtering** — inject lessons relevant to the files being edited, not just recent
2. **Learned principles** — synthesize recurring mistakes into principles.ts dynamically
3. **Custom compaction** — preserve memory across context compression
4. **Loop metrics** — track whether recalled lessons actually prevent repeated mistakes
