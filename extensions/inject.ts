import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"

/**
 * Injection coordinator: deterministic system prompt assembly.
 *
 * Problem: 5 extensions hook before_agent_start and append to systemPrompt.
 * Pi chains hooks in extension load order (filesystem-dependent), so the
 * prompt structure is non-deterministic.
 *
 * Solution: each extension registers its injection builder via a
 * reckoner:register-injection event at session_start. This coordinator
 * collects them and applies them in explicit priority order at
 * before_agent_start.
 *
 * Priority assignments:
 *   10 — principles (identity)
 *   20 — workspace-context (orientation)
 *   30 — tasks (focus)
 *   40 — memory (context from past sessions)
 *   50 — plan-mode (constraint, only when active)
 */

interface InjectionEntry {
  key: string
  priority: number
  build: () => string
}

export default function injectExtension(pi: ExtensionAPI) {
  const registry = new Map<string, InjectionEntry>()

  // Collect registrations from other extensions.
  // This listener is registered at extension load time (before any
  // session_start hooks fire), so it catches all emissions.
  pi.events.on("reckoner:register-injection", (data: InjectionEntry) => {
    registry.set(data.key, data)
  })

  pi.on("before_agent_start", async (event) => {
    const sorted = [...registry.values()].sort((a, b) => a.priority - b.priority)

    let prompt = event.systemPrompt
    for (const entry of sorted) {
      const text = entry.build()
      if (text) prompt += text
    }

    return { systemPrompt: prompt }
  })
}
