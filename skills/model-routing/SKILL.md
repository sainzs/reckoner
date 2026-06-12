---
name: model-routing
description: Choose the right OpenCode Go model for the current task in pi or OpenCode.
---

# Model routing

Use the shared policy in `../../prompts/model-routing.md`.

## What this skill does

It helps you choose a model based on the task instead of defaulting to one model for everything.

## Default mapping

- **Plan / architecture / hard debugging** → `opencode-go/glm-5`
- **Build / implementation / tests** → `opencode-go/kimi-k2.5`
- **Explore / search / lookup** → `opencode-go-minimax/minimax-m2.5`
- **Review / second pass / verification** → `opencode-go-minimax/minimax-m2.7`
- **Title / summary / small utility work** → `opencode-go-minimax/minimax-m2.5`

## How to use it

1. If the task is still unclear, choose the plan model first.
2. Use the build model for normal implementation work.
3. Use the explore model when you are only reading or searching.
4. Use the review model when you want a lighter second opinion.

## Reckoner-specific guidance

- `plan` mode should prefer the strongest reasoning model.
- `build` mode should prefer the balanced coding model.
- `repo_map`, `nvim_diagnostics`, and file search tasks should stay on the fast model.
- If you are doing a review pass, prefer the lighter review model unless the bug is deeply architectural.
