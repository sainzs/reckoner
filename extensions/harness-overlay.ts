import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { matchesKey, truncateToWidth } from "@mariozechner/pi-tui"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parsePlan, type TaskStep } from "./lib/parse-plan.js"
import type { InjectionTrace, LessonRecord, MemoryCategory, TaskState, VerifyResult, WorkspaceState } from "./lib/lesson-types.js"
import { parseLessonFile, summarizeLesson } from "./lib/memory-format.js"

const CATEGORIES = ["mistakes", "codebase", "questions", "preferences", "journal"] as const
const MAX_VISIBLE_LINES = 20

interface Section {
  title: string
  lines: string[]
}

function readCategoryRecords(dir: string, category: MemoryCategory): LessonRecord[] {
  const file = join(dir, `${category}.md`)
  if (!existsSync(file)) return []
  return parseLessonFile(readFileSync(file, "utf8"), category)
}

function buildSections(state: {
  cwd: string
  workspace?: WorkspaceState
  task?: TaskState | null
  mode?: { mode: "plan" | "build", label: string }
  memoryDir?: string
  verify?: VerifyResult | null
  trace?: InjectionTrace | null
}): Section[] {
  const sections: Section[] = []

  const overview: string[] = []
  if (state.workspace?.branch) {
    overview.push(`branch: ${state.workspace.branch}${state.workspace.dirtyCount > 0 ? ` (${state.workspace.dirtyCount} dirty)` : ""}`)
  }
  if (state.mode?.label) {
    overview.push(`mode: ${state.mode.label}`)
  }
  if (state.task) {
    overview.push(`task: ${state.task.title} (${state.task.done}/${state.task.total})`)
    if (state.task.nextStep) overview.push(`next: ${state.task.nextStep}`)
  }
  if (state.memoryDir) {
    overview.push(`memory: ${state.memoryDir}`)
  }
  if (overview.length > 0) sections.push({ title: "OVERVIEW", lines: overview })

  if (state.verify) {
    const lines = [
      `touched: ${state.verify.touchedFiles.join(", ") || "(none)"}`,
      `introduced: ${state.verify.introduced.length + state.verify.testFailures.length}`,
      `resolved: ${state.verify.resolved.length}`,
      `ignored baseline: ${state.verify.unchanged.length}`,
    ]
    for (const issue of [...state.verify.introduced, ...state.verify.testFailures].slice(0, 5)) {
      const where = issue.file ? `${issue.file}${issue.line ? `:${issue.line}` : ""}` : issue.source
      lines.push(`  ${where} — ${issue.message}`)
    }
    sections.push({ title: "VERIFY", lines })
  }

  if (state.memoryDir && existsSync(state.memoryDir)) {
    const lessonLines: string[] = []
    for (const category of CATEGORIES) {
      const records = readCategoryRecords(state.memoryDir, category)
      if (records.length === 0) continue
      lessonLines.push(`${category} (${records.length})`)
      for (const record of records.slice(-2)) {
        lessonLines.push(`  ${summarizeLesson(record)}`)
      }
    }
    if (lessonLines.length > 0) sections.push({ title: "LESSONS", lines: lessonLines })
  }

  if (state.trace) {
    const lines = [
      `used ${state.trace.totalChars} chars, remaining ${state.trace.remainingChars}`,
      ...state.trace.fragments.map(fragment => `  include ${fragment.key} (${fragment.chars})${fragment.reason ? ` — ${fragment.reason}` : ""}`),
    ]
    if (state.trace.skipped.length > 0) {
      lines.push(...state.trace.skipped.slice(0, 6).map(fragment => `  skip ${fragment.key} — ${fragment.reason}`))
    }
    sections.push({ title: "PROMPT", lines })
  }

  if (sections.length === 0 && state.cwd) {
    const tasksFile = join(state.cwd, ".pi", "tasks.md")
    if (existsSync(tasksFile)) {
      const content = readFileSync(tasksFile, "utf8").trim()
      const plan = parsePlan(content)
      if (plan) {
        sections.push({
          title: "TASK",
          lines: [`${plan.title}`, ...plan.steps.map((step: TaskStep) => step.checked ? `  [x] ${step.text}` : `  [ ] ${step.text}`)],
        })
      }
    }
  }

  return sections
}

class OrientationOverlay {
  private sections: Section[]
  private scrollOffset = 0
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
      this.allLines.push(...section.lines)
      this.allLines.push("")
    }
    if (this.allLines[this.allLines.length - 1] === "") this.allLines.pop()
  }

  handleInput(data: string) {
    const maxOffset = Math.max(0, this.allLines.length - MAX_VISIBLE_LINES)
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+shift+o") || matchesKey(data, "q")) {
      this.onClose()
      return
    }
    if (matchesKey(data, "j") || matchesKey(data, "down")) {
      this.scrollOffset = Math.min(this.scrollOffset + 1, maxOffset)
      this.invalidate()
      return
    }
    if (matchesKey(data, "k") || matchesKey(data, "up")) {
      this.scrollOffset = Math.max(this.scrollOffset - 1, 0)
      this.invalidate()
      return
    }
    if (matchesKey(data, "pageup")) {
      this.scrollOffset = Math.max(this.scrollOffset - MAX_VISIBLE_LINES, 0)
      this.invalidate()
      return
    }
    if (matchesKey(data, "pagedown")) {
      this.scrollOffset = Math.min(this.scrollOffset + MAX_VISIBLE_LINES, maxOffset)
      this.invalidate()
      return
    }
    if (matchesKey(data, "g")) {
      this.scrollOffset = 0
      this.invalidate()
      return
    }
    if (matchesKey(data, "shift+g") || matchesKey(data, "G")) {
      this.scrollOffset = maxOffset
      this.invalidate()
    }
  }

  render(width: number): string[] {
    if (this.cachedRendered && this.cachedWidth === width) return this.cachedRendered

    const visible = this.allLines.slice(this.scrollOffset, this.scrollOffset + MAX_VISIBLE_LINES)
    const rendered: string[] = []
    rendered.push(truncateToWidth(this.theme.fg("accent", this.theme.bold("ORIENTATION")), width))
    rendered.push("")

    for (const line of visible) {
      if (line.startsWith("## ")) rendered.push(truncateToWidth(this.theme.fg("accent", this.theme.bold(line.slice(3))), width))
      else if (line.startsWith("  ")) rendered.push(truncateToWidth(this.theme.fg("muted", line), width))
      else rendered.push(truncateToWidth(line, width))
    }

    rendered.push("")
    const total = this.allLines.length
    const pos = total > MAX_VISIBLE_LINES ? ` ${this.scrollOffset + 1}-${Math.min(this.scrollOffset + MAX_VISIBLE_LINES, total)}/${total}` : ""
    rendered.push(truncateToWidth(this.theme.fg("dim", `[ESC] CLOSE  [J/K] SCROLL  [PGUP/PGDN] PAGE${pos}`), width))

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
  const state: {
    cwd: string
    workspace?: WorkspaceState
    task?: TaskState | null
    mode?: { mode: "plan" | "build", label: string }
    memoryDir?: string
    verify?: VerifyResult | null
    trace?: InjectionTrace | null
  } = { cwd: "" }

  pi.on("session_start", async (_event: any, ctx: any) => {
    state.cwd = ctx.cwd
  })

  pi.events.on("reckoner:workspace-updated", (workspace: WorkspaceState) => { state.workspace = workspace })
  pi.events.on("reckoner:task-updated", (task: TaskState | null) => { state.task = task })
  pi.events.on("reckoner:mode-changed", (mode: any) => { state.mode = mode })
  pi.events.on("reckoner:memory-ready", (summary: any) => { state.memoryDir = summary?.dir })
  pi.events.on("reckoner:memory-updated", (summary: any) => { state.memoryDir = summary?.dir })
  pi.events.on("reckoner:verify-result", (verify: VerifyResult) => { state.verify = verify })
  pi.events.on("reckoner:injection-trace", (trace: InjectionTrace) => { state.trace = trace })

  async function openOverlay(ctx: any) {
    const sections = buildSections(state)
    if (sections.length === 0) {
      ctx.ui.notify("No orientation data yet. Run an agent turn first.", "info")
      return
    }

    await ctx.ui.custom((tui: any, theme: any, _kb: any, done: any) => {
      const overlay = new OrientationOverlay(sections, theme, () => done(null))
      return {
        render: (width: number) => overlay.render(width),
        invalidate: () => overlay.invalidate(),
        handleInput: (data: string) => {
          overlay.handleInput(data)
          tui.requestRender()
        },
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
  }

  pi.registerShortcut("ctrl+shift+o", {
    description: "Open orientation overlay",
    handler: async (ctx: any) => {
      await openOverlay(ctx)
    },
  })

  pi.registerCommand("orient", {
    description: "Open orientation overlay (same as Ctrl+Shift+O)",
    handler: async (_args: string, ctx: any) => {
      await openOverlay(ctx)
    },
  })
}
