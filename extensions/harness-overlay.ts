import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { matchesKey, truncateToWidth } from "@mariozechner/pi-tui"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parsePlan } from "./lib/parse-plan.js"

/**
 * Harness overlay: full orientation panel triggered by Ctrl+O.
 *
 * Shows the agent's complete memory state in a scrollable overlay:
 *   - Active task with all steps
 *   - Memory entries by category (mistakes, codebase, questions, journal)
 *   - Entry counts and recent entries
 *
 * Like opening your journal. Non-intrusive — esc to dismiss.
 * Phase 3 of the harness TUI plan.
 */

const CATEGORIES = ["mistakes", "codebase", "questions", "preferences", "journal"] as const

interface Section {
  title: string
  lines: string[]
}

function readEntries(dir: string, category: string, max: number): string[] {
  const file = join(dir, `${category}.md`)
  if (!existsSync(file)) return []
  const content = readFileSync(file, "utf8")
  const blocks = content.split(/^## /m).filter(b => b.trim())
  return blocks.slice(-max).map(b => b.trim())
}

function buildSections(cwd: string): Section[] {
  const sections: Section[] = []
  const memDir = join(cwd, ".pi", "memory")

  // Active task
  const tasksFile = join(cwd, ".pi", "tasks.md")
  if (existsSync(tasksFile)) {
    const content = readFileSync(tasksFile, "utf8").trim()
    if (content) {
      const plan = parsePlan(content)
      if (plan && plan.steps.length > 0) {
        const done = plan.steps.filter(s => s.checked).length
        const lines = [`${plan.title} (${done}/${plan.steps.length})`]
        for (const step of plan.steps) {
          lines.push(step.checked ? `  [x] ${step.text}` : `  [ ] ${step.text}`)
        }
        sections.push({ title: "ACTIVE TASK", lines })
      }
    }
  }

  if (!existsSync(memDir)) return sections

  // Memory sections — show recent entries per category
  for (const cat of CATEGORIES) {
    const entries = readEntries(memDir, cat, 5)
    if (entries.length === 0) continue

    const lines: string[] = []
    for (const entry of entries) {
      // First line of each entry (timestamp line)
      const firstLine = entry.split(/\r?\n/)[0] ?? ""
      const rest = entry.split(/\r?\n/).slice(1).join(" ").trim()
      const summary = rest.length > 80 ? rest.slice(0, 77) + "..." : rest
      if (firstLine) lines.push(`  ${firstLine}`)
      if (summary) lines.push(`    ${summary}`)
    }

    const total = readEntries(memDir, cat, 999).length
    sections.push({
      title: `${cat.toUpperCase()} (${total})`,
      lines,
    })
  }

  return sections
}

class OrientationOverlay {
  private sections: Section[]
  private scrollOffset: number = 0
  private allLines: string[] = []
  private theme: any
  private onClose: () => void
  private cachedWidth?: number
  private cachedRendered?: string[]

  constructor(sections: Section[], theme: any, onClose: () => void) {
    this.sections = sections
    this.theme = theme
    this.onClose = onClose
    this.buildLines()
  }

  private buildLines() {
    this.allLines = []
    for (const section of this.sections) {
      this.allLines.push(`## ${section.title}`)
      for (const line of section.lines) {
        this.allLines.push(line)
      }
      this.allLines.push("") // blank separator
    }
    // Remove trailing blank
    if (this.allLines.length > 0 && this.allLines[this.allLines.length - 1] === "") {
      this.allLines.pop()
    }
  }

  handleInput(data: string) {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+o") || matchesKey(data, "q")) {
      this.onClose()
      return
    }
    if (matchesKey(data, "j") || matchesKey(data, "down")) {
      this.scrollOffset = Math.min(this.scrollOffset + 1, Math.max(0, this.allLines.length - 5))
      this.invalidate()
      return
    }
    if (matchesKey(data, "k") || matchesKey(data, "up")) {
      this.scrollOffset = Math.max(this.scrollOffset - 1, 0)
      this.invalidate()
      return
    }
    if (matchesKey(data, "g")) {
      this.scrollOffset = 0
      this.invalidate()
      return
    }
    if (matchesKey(data, "shift+g") || matchesKey(data, "G")) {
      this.scrollOffset = Math.max(0, this.allLines.length - 5)
      this.invalidate()
      return
    }
  }

  render(width: number): string[] {
    if (this.cachedRendered && this.cachedWidth === width) {
      return this.cachedRendered
    }

    const t = this.theme
    const maxLines = 20 // cap overlay height
    const visible = this.allLines.slice(this.scrollOffset, this.scrollOffset + maxLines)

    const rendered: string[] = []

    // Title
    rendered.push(truncateToWidth(t.fg("accent", t.bold("ORIENTATION")), width))
    rendered.push("")

    for (const line of visible) {
      if (line.startsWith("## ")) {
        rendered.push(truncateToWidth(t.fg("accent", t.bold(line.slice(3))), width))
      } else if (line.startsWith("  [x]")) {
        rendered.push(truncateToWidth(t.fg("success", line), width))
      } else if (line.startsWith("  [ ]")) {
        rendered.push(truncateToWidth(t.fg("dim", line), width))
      } else if (line.startsWith("    ")) {
        rendered.push(truncateToWidth(t.fg("muted", line), width))
      } else if (line.startsWith("  ")) {
        rendered.push(truncateToWidth(t.fg("dim", line), width))
      } else {
        rendered.push(truncateToWidth(line, width))
      }
    }

    // Scroll indicator
    rendered.push("")
    const total = this.allLines.length
    const pos = total > maxLines ? ` ${this.scrollOffset + 1}-${Math.min(this.scrollOffset + maxLines, total)}/${total}` : ""
    rendered.push(truncateToWidth(
      t.fg("dim", `[ESC] CLOSE  [J/K] SCROLL  [G/G] TOP/BOTTOM${pos}`),
      width,
    ))

    this.cachedWidth = width
    this.cachedRendered = rendered
    return rendered
  }

  invalidate() {
    this.cachedWidth = undefined
    this.cachedRendered = undefined
  }
}

export default function harnessOverlayExtension(pi: ExtensionAPI) {
  let cwd = ""

  pi.on("session_start", async (_event, ctx) => {
    cwd = ctx.cwd
  })

  pi.registerShortcut("ctrl+o", {
    description: "Open orientation overlay",
    handler: async (ctx) => {
      const sections = buildSections(cwd || ctx.cwd)

      if (sections.length === 0) {
        ctx.ui.notify("No memory or tasks found. Nothing to show.", "info")
        return
      }

      await ctx.ui.custom((tui: any, theme: any, _kb: any, done: any) => {
        const overlay = new OrientationOverlay(sections, theme, () => done(null))
        return {
          render: (w: number) => overlay.render(w),
          invalidate: () => overlay.invalidate(),
          handleInput: (data: string) => { overlay.handleInput(data); tui.requestRender() },
        }
      }, {
        overlay: true,
        overlayOptions: {
          anchor: "center",
          width: "70%",
          minWidth: 50,
          maxHeight: "80%",
        },
      })
    },
  })

  pi.registerCommand("orient", {
    description: "Open orientation overlay (same as Ctrl+O)",
    handler: async (_args, ctx) => {
      const sections = buildSections(cwd || ctx.cwd)

      if (sections.length === 0) {
        ctx.ui.notify("No memory or tasks found.", "info")
        return
      }

      await ctx.ui.custom((tui: any, theme: any, _kb: any, done: any) => {
        const overlay = new OrientationOverlay(sections, theme, () => done(null))
        return {
          render: (w: number) => overlay.render(w),
          invalidate: () => overlay.invalidate(),
          handleInput: (data: string) => { overlay.handleInput(data); tui.requestRender() },
        }
      }, {
        overlay: true,
        overlayOptions: {
          anchor: "center",
          width: "70%",
          minWidth: 50,
          maxHeight: "80%",
        },
      })
    },
  })
}
