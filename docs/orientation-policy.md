# Reckoner orientation and policy

Reckoner is the memory and policy package in Agent Workbench. It helps an agent
improve over time by making the loop explicit: edit code, auto-verify, fix failures,
store the lesson, and carry that context into the next session.

## Working rules

- Make the smallest change that solves the problem.
- Verify after edits; do not report done before the loop is green.
- Keep lessons and preferences in markdown memory files.
- Use `pi.events` for extension-to-extension coordination instead of imports.
- Read the task at hand before touching files.

## Style

- TypeScript, 2-space indent, double quotes, no semicolons.
- One `.ts` file per extension, with a default export function.
- Use `StringEnum` for tool enums.
- Prefer the repo’s existing patterns over new abstractions.

## Architecture

- Memory lives as markdown.
- Injection should prioritize mistakes and recent context.
- The project should stay close to upstream pi.

## Model routing

Use the shared routing policy in [`../prompts/model-routing.md`](../prompts/model-routing.md).
