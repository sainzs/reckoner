---
description: Task-to-model routing policy for Reckoner across pi and OpenCode
---

# Model routing policy

Use this policy when choosing an OpenCode Go model in **pi** or **OpenCode**.

The goal is the same as the article you shared:
- use the strongest model where reasoning matters,
- use a balanced model for normal implementation,
- use a fast/cheap model for exploration,
- keep review and small utility tasks lightweight.

## Shared model matrix

| Task | Recommended model | Why |
|---|---|---|
| Plan / architecture / hard debugging | `opencode-go/glm-5` | strongest reasoning for edge cases and tradeoffs |
| Build / implementation / tests | `opencode-go/kimi-k2.5` | balanced coding model for day-to-day work |
| Explore / search / file lookup | `opencode-go-minimax/minimax-m2.5` | fast and cheap for read-only work |
| Review / second pass / verification | `opencode-go-minimax/minimax-m2.7` | a bit stronger than the fastest model, still efficient |
| Title / summary / lightweight glue | `opencode-go-minimax/minimax-m2.5` | keep small utility work cheap |

## Rules of thumb

- **Plan first, build second.** If the task is still ambiguous, use `opencode-go/glm-5`.
- **Default to `kimi-k2.5` for implementation.** It should handle most coding work without paying the highest cost.
- **Use `minimax-m2.5` for pure lookup.** Searching the repo, reading files, and quick answers do not need the strongest model.
- **Use `minimax-m2.7` for a second opinion.** When you already have code and want a review or verification pass, keep it lighter than the main implementation model.

## Why two provider names

GLM-5 and Kimi K2.5 use the OpenAI-compatible endpoint; MiniMax M2.5 and M2.7 use
the Anthropic-compatible endpoint. These require different base URLs so they are
registered under two provider names in pi:

- `opencode-go/glm-5`
- `opencode-go/kimi-k2.5`
- `opencode-go-minimax/minimax-m2.5`
- `opencode-go-minimax/minimax-m2.7`

## pi naming

pi uses the same provider/model IDs once the OpenCode Go provider is installed.

If you are manually choosing a model in pi, map the current task to the model above instead of using the same model for everything.

## When in doubt

If you are uncertain which model to use:
1. start with `opencode-go/kimi-k2.5`,
2. switch up to `opencode-go/glm-5` only when the task is genuinely hard,
3. switch down to `opencode-go/minimax-m2.5` for exploration and discovery.
