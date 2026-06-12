import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

/**
 * Harness widget: persistent orientation display above the editor.
 *
 * Shows at a glance:
 *   - Git branch + dirty state
 *   - System status (verify, nvim, mode)
 *   - Active task with progress and next step
 *   - Memory summary (entry counts per category)
 *
 * This is the cockpit for the agent. Every session starts by seeing this.
 * The goal: orient in 2 seconds instead of 20.
 *
 * Refreshes on: session_start, agent_end, turn_end
 * Reads state from: git, .pi/tasks.md, .pi/memory/
 */

// ─── Task parsing (mirrors tasks.ts) ───────────────────────

interface TaskStep {
  text: string
  checked: boolean
}

interface TaskPlan {
  title: string
  steps: TaskStep[]
}

function parsePlan(content: string): TaskPlan | null {
  const lines = content.split(/\r?\n/)
  let title = ""
  const steps: TaskStep[] = []
  for (const line of lines) {
    const tm = line.match(/^#\s+(.+)/)
    if (tm && !title) { title = tm[1].trim(); continue }
    const sm = line.match(/^- \[([ xX])\]\s+(.+)/)
    if (sm) steps.push({ checked: sm[1] !== " ", text: sm[2].trim() })
  }
  if (!title && steps.length === 0) return null
  return { title: title || "Untitled", steps }
}

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

function buildWidgetLines(
  cwd: string,
  branch: string | null,
  dirty: number,
  statuses: Map<string, string>,
): string[] {
  const lines: string[] = []

  // Line 1: Status bar — git + key system indicators
  const parts: string[] = []

  if (branch) {
    const gitLabel = dirty > 0 ? `${branch} (${dirty} dirty)` : `${branch}`
    parts.push(`⚡ ${gitLabel}`)
  }

  // Collect statuses from other extensions
  const verifyStatus = statuses.get("verify") ?? ""
  if (verifyStatus) parts.push(verifyStatus)

  const nvimStatus = statuses.get("nvim-server") ?? statuses.get("nvim") ?? ""
  if (nvimStatus) parts.push(nvimStatus)

  const modeStatus = statuses.get("mode") ?? ""
  if (modeStatus) parts.push(modeStatus)

  if (parts.length > 0) {
    lines.push(parts.join(" │ "))
  }

  // Line 2-3: Active task
  const tasksFile = join(cwd, ".pi", "tasks.md")
  if (existsSync(tasksFile)) {
    const content = readFileSync(tasksFile, "utf8").trim()
    if (content) {
      const plan = parsePlan(content)
      if (plan && plan.steps.length > 0) {
        const done = plan.steps.filter(s => s.checked).length
        const total = plan.steps.length
        const next = plan.steps.find(s => !s.checked)
        lines.push(`🎯 ${plan.title} (${done}/${total})`)
        if (next) {
          lines.push(`   Next: ${next.text}`)
        }
      }
    }
  }

  // Line 4: Memory summary
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
      lines.push(`📝 ${memParts.join(" · ")}`)
    }
  }

  return lines
}

// ─── Extension ──────────────────────────────────────────────

export default function harnessWidgetExtension(pi: ExtensionAPI) {
  let cwd = ""
  let branch: string | null = null
  let dirtyCount = 0
  let extensionStatuses = new Map<string, string>()

  async function getGitState() {
    try {
      const brResult = await pi.exec("git", ["-C", cwd, "branch", "--show-current"], { timeout: 3000 })
      branch = (brResult.stdout ?? "").trim() || null
    } catch { branch = null }

    try {
      const stResult = await pi.exec("git", ["-C", cwd, "status", "--short"], { timeout: 3000 })
      const lines = (stResult.stdout ?? "").trim().split(/\r?\n/).filter(Boolean)
      dirtyCount = lines.length
    } catch { dirtyCount = 0 }
  }

  function refresh(ctx: any) {
    if (!ctx.hasUI) return

    // Collect statuses from footer data if available,
    // otherwise we maintain our own via event listening
    const lines = buildWidgetLines(cwd, branch, dirtyCount, extensionStatuses)

    if (lines.length > 0) {
      // Use themed rendering
      ctx.ui.setWidget("harness", (_tui: any, theme: any) => {
        const themed = lines.map((line: string) => {
          // Style the first line (status bar) as muted
          if (line.startsWith("⚡")) return theme.fg("dim", line)
          // Style task as accent
          if (line.startsWith("🎯")) return theme.fg("accent", line)
          if (line.startsWith("   Next:")) return theme.fg("muted", line)
          // Style memory as dim
          if (line.startsWith("📝")) return theme.fg("dim", line)
          return line
        })
        return {
          render: () => themed,
          invalidate: () => {},
        }
      })
    } else {
      ctx.ui.setWidget("harness", undefined)
    }
  }

  // Track statuses from other extensions by intercepting their setStatus calls
  // Since we can't intercept setStatus directly, we listen for known events
  pi.events.on("reckoner:nvim-ready", () => {
    extensionStatuses.set("nvim-server", "nvim ✓")
  })

  pi.on("session_start", async (_event, ctx) => {
    cwd = ctx.cwd

    // Remove the old workspace-context widget to avoid duplication
    if (ctx.hasUI) {
      ctx.ui.setWidget("workspace-context", undefined)
    }

    await getGitState()
    refresh(ctx)
  })

  pi.on("agent_end", async (_event, ctx) => {
    await getGitState()
    refresh(ctx)
  })

  pi.on("turn_end", async (_event, ctx) => {
    // Refresh after edits — task may have been checked, files changed
    await getGitState()
    refresh(ctx)
  })

  // Also refresh on agent_start (task may have been injected)
  pi.on("agent_start", async (_event, ctx) => {
    refresh(ctx)
  })
}
