import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import type { InjectionBuildContext, InjectionFragment, InjectionTrace, TaskState } from "./lib/lesson-types.js"

interface InjectionEntry {
  key: string
  priority: number
  maxChars?: number
  build: (context: InjectionBuildContext) => string | InjectionFragment | null
}

function trimText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const suffix = "\n\n[injection truncated]"
  return text.slice(0, Math.max(0, maxChars - suffix.length)) + suffix
}

export default function injectExtension(pi: ExtensionAPI) {
  const registry = new Map<string, InjectionEntry>()
  let cwd = ""
  let recentFiles: string[] = []
  let activeTask: TaskState | undefined
  let mode: "build" | "plan" | undefined
  let lastTrace: InjectionTrace | null = null
  const totalBudget = 5000

  pi.events.on("reckoner:register-injection", (data: InjectionEntry) => {
    registry.set(data.key, data)
  })

  pi.events.on("reckoner:verify-result", (result: any) => {
    recentFiles = Array.isArray(result?.touchedFiles) ? result.touchedFiles : []
  })

  pi.events.on("reckoner:task-updated", (task: TaskState | null) => {
    activeTask = task ?? undefined
  })

  pi.events.on("reckoner:mode-changed", (nextMode: any) => {
    if (nextMode?.mode === "plan" || nextMode?.mode === "build") {
      mode = nextMode.mode
    }
  })

  pi.on("session_start", async (_event: any, ctx: any) => {
    cwd = ctx.cwd
  })

  pi.on("before_agent_start", async (event: any) => {
    const sorted = [...registry.values()].sort((a, b) => a.priority - b.priority)
    let prompt = event.systemPrompt
    let remaining = totalBudget
    const trace: InjectionTrace = {
      timestamp: Date.now(),
      totalChars: 0,
      remainingChars: totalBudget,
      fragments: [],
      skipped: [],
    }

    for (const entry of sorted) {
      try {
        const context: InjectionBuildContext = {
          cwd,
          budget: { total: totalBudget, remaining },
          recentFiles,
          activeTask,
          mode,
        }

        let fragment = entry.build(context)
        if (!fragment) {
          trace.skipped.push({ key: entry.key, priority: entry.priority, reason: "no content" })
          continue
        }

        if (typeof fragment === "string") {
          fragment = {
            key: entry.key,
            text: fragment,
            chars: fragment.length,
            priority: entry.priority,
          }
        }

        if (!fragment.text.trim()) {
          trace.skipped.push({ key: entry.key, priority: entry.priority, reason: "empty text" })
          continue
        }

        const maxChars = Math.min(entry.maxChars ?? remaining, remaining)
        if (maxChars <= 0) {
          trace.skipped.push({ key: entry.key, priority: entry.priority, reason: "out of budget" })
          continue
        }

        const text = trimText(fragment.text, maxChars)
        if (!text.trim()) {
          trace.skipped.push({ key: entry.key, priority: entry.priority, reason: "trimmed to nothing" })
          continue
        }

        prompt += text
        remaining -= text.length
        trace.fragments.push({
          key: fragment.key,
          chars: text.length,
          priority: entry.priority,
          reason: fragment.reason,
        })
        trace.totalChars += text.length
        trace.remainingChars = remaining
      } catch (err) {
        console.error(`[inject] Extension failed to build injection ${entry.key}:`, err)
        trace.skipped.push({ key: entry.key, priority: entry.priority, reason: "error" })
      }
    }

    lastTrace = trace
    pi.events.emit("reckoner:injection-trace", trace)
    return { systemPrompt: prompt }
  })

  pi.registerCommand("inject", {
    description: "Show the last injection trace and budget decisions",
    handler: async (args: string, ctx: any) => {
      if (!lastTrace) {
        ctx.ui.notify("No injection trace yet. Start an agent run first.", "info")
        return
      }

      const modeArg = args.trim().toLowerCase()
      if (modeArg === "budget") {
        ctx.ui.notify([
          `Injection budget: ${totalBudget}`,
          `Used: ${lastTrace.totalChars}`,
          `Remaining: ${lastTrace.remainingChars}`,
        ].join("\n"), "info")
        return
      }

      const lines = [
        `Injection trace @ ${new Date(lastTrace.timestamp).toLocaleString()}`,
        `Used ${lastTrace.totalChars}/${totalBudget} chars`,
        "",
        "Included:",
        ...lastTrace.fragments.map(fragment => `- ${fragment.key} (${fragment.chars} chars)${fragment.reason ? ` — ${fragment.reason}` : ""}`),
      ]

      if (lastTrace.skipped.length > 0 && modeArg !== "included") {
        lines.push("", "Skipped:")
        lines.push(...lastTrace.skipped.map(fragment => `- ${fragment.key}: ${fragment.reason}`))
      }

      ctx.ui.notify(lines.join("\n"), "info")
    },
  })
}
