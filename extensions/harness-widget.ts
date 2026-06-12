import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { truncateToWidth } from "@mariozechner/pi-tui"
import type { LessonRecord, TaskState, VerifyResult } from "./lib/lesson-types.js"

interface WidgetState {
  task?: TaskState
  topRisk?: {
    summary: string
    severity: "info" | "warn" | "error"
  }
}

function summarizeVerifyRisk(result: VerifyResult): WidgetState["topRisk"] | undefined {
  const issue = result.introduced[0] ?? result.testFailures[0]
  if (!issue) return undefined
  const location = issue.file ? `${issue.file}${issue.line ? `:${issue.line}` : ""}` : issue.source
  return {
    summary: `${location} — ${issue.message}`,
    severity: issue.source === "test" ? "error" : "warn",
  }
}

export default function harnessWidgetExtension(pi: ExtensionAPI) {
  let enabled = true
  let active = true
  const state: WidgetState = {}

  function renderLines(): string[] {
    const lines: string[] = []
    if (state.task) {
      lines.push(`task: ${state.task.title} (${state.task.done}/${state.task.total})`)
      if (state.task.nextStep) lines.push(`next: ${state.task.nextStep}`)
    }
    if (state.topRisk) {
      lines.push(`risk: ${state.topRisk.summary}`)
    }
    return lines.slice(0, 3)
  }

  function clearWidget(ctx: any) {
    try {
      if (ctx.hasUI) ctx.ui.setWidget("harness", undefined)
    } catch {
      // The session may already be replacing/reloading; stale contexts are safe to ignore.
    }
  }

  function refresh(ctx: any) {
    if (!active || !enabled) return

    try {
      if (!ctx.hasUI) return
      const lines = renderLines()
      if (lines.length === 0) {
        ctx.ui.setWidget("harness", undefined)
        return
      }

      ctx.ui.setWidget("harness", (_tui: any, theme: any) => ({
        render: (width: number) => lines.map((line) => {
          const colonIdx = line.indexOf(":")
          const label = colonIdx >= 0 ? line.slice(0, colonIdx + 1) : line
          const value = colonIdx >= 0 ? line.slice(colonIdx + 1) : ""
          if (line.startsWith("risk:") && state.topRisk?.severity) {
            const color = state.topRisk.severity === "error" ? "error" : state.topRisk.severity === "warn" ? "warning" : "accent"
            return truncateToWidth(theme.fg("dim", label) + theme.fg(color, value.trimStart()), width)
          }
          return truncateToWidth(theme.fg("dim", label) + value, width)
        }),
        invalidate: () => {},
      }))
    } catch {
      // Ignore stale extension contexts after /reload, /new, /resume, /fork, or /clone.
      active = false
    }
  }

  pi.events.on("reckoner:task-updated", (task: TaskState | null) => {
    state.task = task ?? undefined
  })

  pi.events.on("reckoner:verify-result", (result: VerifyResult) => {
    state.topRisk = summarizeVerifyRisk(result)
  })

  pi.events.on("reckoner:memory-updated", (summary: any) => {
    const lesson = summary?.lastRecord as LessonRecord | undefined
    if (!lesson || lesson.category !== "mistakes") return
    if (!state.topRisk && lesson.summary) {
      state.topRisk = {
        summary: lesson.summary,
        severity: lesson.resolved === false ? "warn" : "info",
      }
    }
  })

  pi.on("session_start", async (_event: any, ctx: any) => {
    active = true
    refresh(ctx)
  })

  pi.on("session_shutdown", async (_event: any, ctx: any) => {
    active = false
    clearWidget(ctx)
  })

  pi.on("agent_end", async (_event: any, ctx: any) => {
    refresh(ctx)
  })

  pi.on("turn_end", async (_event: any, ctx: any) => {
    refresh(ctx)
  })

  pi.registerCommand("widget", {
    description: "Toggle the harness widget on/off",
    handler: async (args: string, ctx: any) => {
      const mode = args.trim().toLowerCase()
      if (mode === "off") enabled = false
      else if (mode === "on") enabled = true
      else enabled = !enabled

      if (!enabled) {
        clearWidget(ctx)
        if (ctx.hasUI) ctx.ui.notify("Harness widget disabled", "info")
        return
      }

      refresh(ctx)
      if (ctx.hasUI) ctx.ui.notify("Harness widget enabled", "info")
    },
  })
}
