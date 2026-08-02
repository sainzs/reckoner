# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this package is

Reckoner is a [pi](https://github.com/mariozechner/pi-coding-agent) coding-agent
**package** (not a standalone app): a directory of TypeScript extensions, skills,
prompts, and themes that `pi` loads to add memory, auto-verify feedback, and
guardrails to an agent session. It is the "memory/policy" layer of the
Random Access agent toolchain (sibling packages: `registro` for reporting,
`santiagosainz-skills` for workflow skills, `random-access-themes` for design tokens
— see `../../` umbrella `CLAUDE.md`). There is no server, no CLI entrypoint of its
own, and no compiled output (`tsconfig.json` has `noEmit: true`) — `pi` loads the
`.ts` files directly via the `pi` field in `package.json`:

```json
"pi": { "extensions": ["./extensions"], "skills": ["./skills"], "prompts": ["./prompts"], "themes": ["./themes"] }
```

Canonical orientation/policy doc: `docs/orientation-policy.md` (read this first;
`AGENTS.md` is a thin pointer to it).

## Commands

All commands run from this directory (`packages/reckoner`).

```bash
npm install          # install devDependencies (peerDependencies — the @mariozechner/pi-* packages — are provided by the host pi runtime)
npm run typecheck    # tsc -p tsconfig.json --noEmit
npm test             # alias for test:unit
npm run test:unit    # tsx --test tests/**/*.test.ts
npm run verify:self  # typecheck && test:unit — run this before declaring work done
```

Run a single test file directly with `tsx --test`, e.g.:

```bash
npx tsx --test tests/lesson-scoring.test.ts
npx tsx --test tests/memory-format.test.ts
```

There are only two test files today (`tests/lesson-scoring.test.ts`,
`tests/memory-format.test.ts`), using Node's built-in `node:test` runner via `tsx`
— no Jest/Vitest config exists. There is no lint script in `package.json`; rely on
`typecheck` and the style rules below.

To exercise the package interactively (not a verifiable/scriptable command, but
the real "run"):

```bash
pi -e .          # run pi with this package loaded in-place, from this directory
```

## Architecture

### Extension model

Every file in `extensions/*.ts` exports a default function `(pi: ExtensionAPI) => void`
that registers hooks (`pi.on("session_start" | "agent_start" | "agent_end" | "before_agent_start", ...)`),
slash commands (`pi.registerCommand`), and tools (`pi.registerTool`) against the host
`pi` runtime. `extensions/lib/` holds shared, hook-free logic:
- `lib/lesson-types.ts` — the shared type vocabulary (`LessonRecord`, `MemoryCategory`,
  `VerifyResult`, `InjectionFragment`/`InjectionTrace`, etc.) every extension imports.
- `lib/memory-format.ts` — parses/serializes lesson records to/from markdown and scores
  them for relevance (`scoreLessonRecord`).
- `lib/package-path.ts` — resolves paths relative to the package root regardless of
  where `pi install` placed it.

Extensions never import each other directly — per `docs/orientation-policy.md`,
cross-extension coordination goes through `pi.events.emit`/`pi.events.on` (an
event bus), not module imports. The two structural events to know:

- `"reckoner:register-injection"` — any extension can register a `{ key, priority,
  maxChars, build(context) }` entry; `inject.ts` is the sole consumer/orchestrator.
- `"reckoner:verify-result"` — emitted by the **host pi runtime** (auto-verify is a
  pi-core feature, not code in this repo) after an agent turn that edited files;
  `loop-metrics.ts`, `inject.ts`, and `harness-overlay.ts` all subscribe to it.

### The actual data flow (the "loop" the README describes)

1. **Edit** — the agent edits files using its normal tools during a turn.
2. **Auto-verify** (host `pi`, not this repo) runs type-checking/tests/diagnostics
   and emits `reckoner:verify-result` with `introduced`/`resolved`/`unchanged` issues.
3. **Record** — `memory.ts` listens for `"reckoner:lesson"` (and the `remember` tool /
   `reckoner:memory-note` event) and upserts a `LessonRecord` into
   `.pi/memory/<category>.md` (`mistakes.md`, `codebase.md`, `journal.md`,
   `preferences.md`, `questions.md`) under `memDir(cwd)` — project-local `.pi/memory/`
   if it exists, else `~/.pi/agent/memory/`, else falls back to project-local.
   Records are markdown blocks (see `serializeLessonRecord`/`parseLessonFile` in
   `lib/memory-format.ts`), deduplicated/merged by a content fingerprint
   (`fingerprintLesson`) so repeated mistakes accumulate a `repeatCount` instead of
   duplicating.
4. **Promote** — once a mistake's `repeatCount` crosses `PROMOTION_REPEAT_THRESHOLD`
   (3) and it isn't `resolved`, `memory.ts` emits `"reckoner:promotion-candidate"`;
   `guardrails.ts` consumes these to flag historically risky files.
5. **Inject** — on `"before_agent_start"` of the *next* turn/session, `inject.ts`
   collects every registered injection builder, sorts by `priority`, and appends
   each fragment to `event.systemPrompt` until a 5000-char total budget
   (`MAX_INJECT_CHARS = 3200` per memory fragment) is exhausted. `memory.ts`
   registers at priority 40 and renders the highest-`scoreLessonRecord`-scoring
   mistakes/codebase notes/preferences/questions/journal entries relevant to
   `recentFiles`/`activeTask` into a `## Relevant Reckoner memory` block.

That five-step loop is the entire thesis; everything else in `extensions/` is a
supporting capability:

| File | Role |
|---|---|
| `memory.ts` | `remember`/`recall` tools, `/memory`, `/lessons` commands, the storage+injection logic above |
| `inject.ts` | Injection registry/budget orchestrator, `/inject` command |
| `loop-metrics.ts` | Appends JSONL events to `.pi/metrics/loop.jsonl`; `/metrics` command |
| `git-checkpoint.ts` | `git stash create` snapshot before/after each agent turn; `/undo`, `/checkpoints`, `/checkpoint` |
| `guardrails.ts` | Blocks writes to `.env`/`.ssh`/`.aws`/keys/etc. and confirms dangerous bash (`rm -rf`, `sudo`, `git push --force`, ...); flags promoted risky files; `/guardrails` |
| `repo-map.ts` | Structural file-tree + symbol extraction tool (`repo_map`), prefers `sg` (ast-grep), falls back to `rg` regex; covers TS/JS/Python/Go/Rust/Java |
| `ast-grep.ts` | `sg_search` tool — AST pattern search + rewrite preview, requires `ast-grep` on PATH |
| `web-tools.ts` | `web_search`/`web_fetch` tools (needs `JINA_API_KEY`) |
| `principles.ts` | Injects static behavioral guidelines (smallest safe change, verify before done, etc.) |
| `workspace-context.ts` | Git branch/dirty-file/package-script snapshot; `/snapshot` |
| `harness-overlay.ts`, `harness-widget.ts`, `harness-footer.ts` | TUI status overlay/footer rendering verify state, checkpoints, task progress |
| `smart-compaction.ts`, `tool-telemetry.ts` | Context-window compaction heuristics and tool-call telemetry |
| `factory-theme.ts` | Registers the `factory` TUI theme variant |
| `opencode-go.ts`, `kimi-code.ts`, `mimo.ts` | Model/provider-specific integration shims |

### Skills and prompts

`skills/*/SKILL.md` (e.g. `plan-and-build`, `debug-failure`, `implement-feature`,
`research-docs`, `review-diff`, `model-routing`) are markdown playbooks pi surfaces
as slash-invocable workflows; `model-routing` is a thin wrapper around the shared
task→model policy in `prompts/model-routing.md` and `docs/orientation-policy.md`
(the same mapping `opencode.json` pins for OpenCode agents). `prompts/*.md` are
reusable prompt fragments (`plan.md`, `research.md`, `review.md`,
`model-routing.md`). `themes/*.json` are TUI color-token files (`random-access`,
`reckoner-dusk`, `reckoner-factory`) selectable via `/tone`.

### Code style (from `docs/orientation-policy.md`)

- TypeScript, 2-space indent, double quotes, no semicolons.
- One `.ts` file per extension, default-export function `(pi) => void`.
- Use `StringEnum` (from `@mariozechner/pi-ai`) for tool parameter enums.
- Cross-extension coordination via `pi.events`, never direct imports between
  `extensions/*.ts` files.
- `@mariozechner/pi-coding-agent`, `pi-ai`, `pi-tui`, and `@sinclair/typebox` are
  `peerDependencies` (resolved by the host `pi` runtime); `types/reckoner-stubs.d.ts`
  provides loose `any`-typed module declarations so `tsc --noEmit` succeeds standalone
  without that runtime installed.
