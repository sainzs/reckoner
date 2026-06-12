import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { truncateToWidth } from "@mariozechner/pi-tui"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parsePlan } from "./lib/parse-plan.js"

/**
 * Harness widget: orientation-only display above the editor.
 *
 * Shows task progress and memory counts. System status (git, verify,
 * nvim, mode) lives in the footer — not here.
 *
 * Refreshes on: session_start, agent_start, agent_end, turn_end
 * Reads from: .pi/tasks.md, .pi/memory/
 */

// ─── Memory counting ────────────────────────────────────────

const CATEGORIES = ["mistakes", "codebase", "preferences", "questions", "journal"] as const

function countEntries(dir: string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const cat of CATEGORIES) {
    const file = join(dir, `${cat}.md`)
    if (!existsSync(file)) { counts[cat] = 0; continue }
    const content = readFileSync(file, "utf8")
    counts[cat] = content.split(/^## /m).filter(b => b.trim()).length
  }
  return counts
}

// ─── Widget builder ─────────────────────────────────────────

function buildWidgetLines(cwd: string): string[] {
  const lines: string[] = []

  // Task: title + progress, next step
  const tasksFile = join(cwd, ".pi", "tasks.md")
  if (existsSync(tasksFile)) {
    const content = readFileSync(tasksFile, "utf8").trim()
    if (content) {
      const plan = parsePlan(content)
      if (plan && plan.steps.length > 0) {
        const done = plan.steps.filter(s => s.checked).length
        const total = plan.steps.length
        const next = plan.steps.find(s => !s.checked)
        lines.push(`task: ${plan.title} (${done}/${total})`)
        if (next) {
          lines.push(`next: ${next.text}`)
        }
      }
    }
  }

  // Memory: compact counts
  const memDir = join(cwd, ".pi", "memory")
  if (existsSync(memDir)) {
    const counts = countEntries(memDir)
    const memParts: string[] = []
    for (const cat of CATEGORIES) {
      if (counts[cat] > 0) {
        memParts.push(`${counts[cat]} ${cat}`)
      }
    }
    if (memParts.length > 0) {
      lines.push(`mem: ${memParts.join(" · ")}`)
    }
  }

  return lines
}

// ─── Extension ──────────────────────────────────────────────

export default function harnessWidgetExtension(pi: ExtensionAPI) {
  let cwd = ""

  function refresh(ctx: any) {
    if (!ctx.hasUI) return

    const lines = buildWidgetLines(cwd)

    if (lines.length > 0) {
      ctx.ui.setWidget("harness", (_tui: any, theme: any) => {
        return {
          render: (width: number) => {
            return lines.map((line: string) => {
              const colonIdx = line.indexOf(":")
              if (colonIdx === -1) return truncateToWidth(line, width)
              const label = line.slice(0, colonIdx + 1)
              const value = line.slice(colonIdx + 1)
              return truncateToWidth(theme.fg("dim", label) + value, width)
            })
          },
          invalidate: () => {},
        }
      })
    } else {
      ctx.ui.setWidget("harness", undefined)
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    cwd = ctx.cwd
    // Remove the old workspace-context widget to avoid duplication
    if (ctx.hasUI) {
      ctx.ui.setWidget("workspace-context", undefined)
    }
    refresh(ctx)
  })

  pi.on("agent_start", async (_event, ctx) => { refresh(ctx) })
  pi.on("agent_end", async (_event, ctx) => { refresh(ctx) })
  pi.on("turn_end", async (_event, ctx) => { refresh(ctx) })
}
