# Reckoner

Agent with persistent memory. Edit → verify → fix → lesson stored → next session avoids it.

## Style

TypeScript, 2-space indent, double quotes, no semicolons.
Each extension: single `.ts` file, default export function.
Use `StringEnum` for tool enums (NOT `Type.Union`/`Type.Literal`).
Extensions communicate via `pi.events`, not imports (`lib/` shared utils OK).

## Architecture

10 tools total. Memory as markdown. Injection prioritizes mistakes.
`pi.events` is the nervous system. Stay on upstream pi, no fork.
