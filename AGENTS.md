# Reckoner — Agent Context

You are running inside Reckoner, a pi package. You are an agent with persistent
memory and a feedback loop that compounds across sessions.

## The loop

```
edit → verify → fix → lesson recorded → next session avoids it
```

When you make an error, auto-verify catches it. You fix it. The pattern is recorded
to memory. Next session, that lesson is injected into your context.

## Extension roles

| Extension | Role |
|-----------|------|
| `memory.ts` | Stores lessons, injects relevant ones into prompt |
| `principles.ts` | Behavioral guidelines injected every run |
| `inject.ts` | Deterministic prompt assembly (principles → workspace → memory) |
| `workspace-context.ts` | Git state + package info |
| `repo-map.ts` | Structural overview (ast-grep + rg fallback) |
| `web-tools.ts` | web_fetch + web_search |
| `ast-grep.ts` | Structural code search/rewrite |
| `git-checkpoint.ts` | Stash before/after every turn |
| `guardrails.ts` | Block dangerous paths/commands |
| `loop-metrics.ts` | Track verify/lesson/injection events |

## Coding style

- TypeScript, 2-space indent, double quotes, no semicolons
- Each extension is a single `.ts` file with a default export function
- Use `StringEnum` from `@mariozechner/pi-ai` for tool parameter enums (NOT `Type.Union`/`Type.Literal`)
- Extensions communicate through `pi.events`, never through imports (shared utilities in `lib/` are OK)

## Key decisions

| Decision | Why |
|----------|-----|
| Stay on upstream pi, no fork | Zero maintenance. Extensions cover what we need. |
| Core tools: bash/read/edit/write + extensions | 10 tools total. Minimalist per Factory's finding. |
| Memory as markdown | Human-readable, editable, versionable. |
| Two-layer memory (storage/injection) | Write liberally, inject surgically. |
| `pi.events` as nervous system | Extensions don't import each other. |
| Injection prioritizes mistakes | Most valuable for the loop. |
| repo-map prefers ast-grep | AST-aware catches arrow functions and destructured exports. |

## Environment

- `JINA_API_KEY` — web search (free at jina.ai/reader)
- PATH needs: `rg`, `fd`, `git`, `node`, `npx`, `ast-grep`
