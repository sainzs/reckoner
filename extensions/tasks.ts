import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { Type } from "@sinclair/typebox"
import { StringEnum } from "@mariozechner/pi-ai"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"

/**
 * Tasks: structured planning that survives context compression and sessions.
 *
 * The agent can self-correct (auto-verify) and remember (memory), but it
 * can't externalize a structured plan. Complex multi-step work gets held
 * in context — fragile. This extension fixes that.
 *
 * File: .pi/tasks.md (per-project)
 * Format:
 *   # <title>
 *
 *   - [ ] Step 1
 *   - [x] Step 2
 *   - [ ] Step 3
 *
 * Two layers (same philosophy as memory):
 *   Storage  — full plan on disk, human-readable, editable
 *   Injection — terse summary in system prompt (title + progress + next step)
 *
 * Tool: tasks (actions: plan, check, add, view, done)
 * Injection: active task summary at before_agent_start
 */

const ACTIONS = ["plan", "check", "add", "view", "done"] as const

interface Step {
  text: string
  checked: boolean
}

interface TaskPlan {
  title: string
  steps: Step[]
}

function tasksFile(cwd: string): string {
  return join(cwd, ".pi", "tasks.md")
}

function ensureDir(path: string) {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function parsePlan(content: string): TaskPlan | null {
  const lines = content.split(/\r?\n/)
  let title = ""
  const steps: Step[] = []

  for (const line of lines) {
    const titleMatch = line.match(/^#\s+(.+)/)
    if (titleMatch && !title) {
      title = titleMatch[1].trim()
      continue
    }

    const stepMatch = line.match(/^- \[([ xX])\]\s+(.+)/)
    if (stepMatch) {
      steps.push({
        checked: stepMatch[1] !== " ",
        text: stepMatch[2].trim(),
      })
    }
  }

  if (!title && steps.length === 0) return null
  return { title: title || "Untitled", steps }
}

function formatPlan(plan: TaskPlan): string {
  const lines = [`# ${plan.title}`, ""]
  for (const step of plan.steps) {
    const mark = step.checked ? "x" : " "
    lines.push(`- [${mark}] ${step.text}`)
  }
  return lines.join("\n") + "\n"
}

function statusSummary(plan: TaskPlan): string {
  const total = plan.steps.length
  const done = plan.steps.filter(s => s.checked).length
  const next = plan.steps.find(s => !s.checked)
  const lines = [
    `**${plan.title}** — ${done}/${total} steps`,
  ]
  if (next) {
    lines.push(`Next: ${next.text}`)
  } else if (total > 0) {
    lines.push("All steps complete.")
  }
  return lines.join("\n")
}

function injectionSummary(plan: TaskPlan): string {
  const total = plan.steps.length
  const done = plan.steps.filter(s => s.checked).length
  const remaining = plan.steps.filter(s => !s.checked)

  const lines = [
    `## Active task`,
    "",
    `**${plan.title}** (${done}/${total} complete)`,
  ]

  if (remaining.length > 0) {
    lines.push("")
    lines.push("Remaining:")
    for (const step of remaining.slice(0, 5)) {
      lines.push(`- [ ] ${step.text}`)
    }
    if (remaining.length > 5) {
      lines.push(`  ...and ${remaining.length - 5} more`)
    }
  } else {
    lines.push("", "All steps complete — mark done with tasks(action: 'done') or continue.")
  }

  return lines.join("\n")
}

export default function tasksExtension(pi: ExtensionAPI) {
  let cwd: string = ""

  pi.on("session_start", async (_event, ctx) => {
    cwd = ctx.cwd
    const file = tasksFile(cwd)
    if (ctx.hasUI) {
      if (existsSync(file)) {
        const plan = parsePlan(readFileSync(file, "utf8"))
        if (plan && plan.steps.length > 0) {
          const done = plan.steps.filter(s => s.checked).length
          ctx.ui.setStatus("tasks", `task: ${done}/${plan.steps.length}`)
        } else {
          ctx.ui.setStatus("tasks", "no task")
        }
      }
    }
  })

  pi.on("before_agent_start", async (event) => {
    const file = tasksFile(cwd)
    if (!existsSync(file)) return

    const content = readFileSync(file, "utf8")
    const plan = parsePlan(content)
    if (!plan || plan.steps.length === 0) return

    // Only inject if there are unchecked steps
    const hasWork = plan.steps.some(s => !s.checked)
    if (!hasWork) return

    const injection = `\n\n---\n${injectionSummary(plan)}\n---`
    return { systemPrompt: `${event.systemPrompt}${injection}` }
  })

  pi.registerTool({
    name: "tasks",
    label: "Tasks",
    description: [
      "Manage a structured task plan for multi-step work. The plan persists on disk and survives context compression and session boundaries.",
      "",
      "Actions:",
      "  plan  — Create a new plan (provide title + steps). Replaces any existing plan.",
      "  check — Mark a step as complete (provide step text to match).",
      "  add   — Add a new step to the current plan (provide step text).",
      "  view  — Show current plan status.",
      "  done  — Clear the plan (task complete).",
    ].join("\n"),
    promptSnippet: "Create and track structured plans for multi-step work",
    promptGuidelines: [
      "Use tasks(action: 'plan') at the start of non-trivial work to externalize your plan.",
      "Check off steps as you complete them — this survives context compression.",
      "If you're resuming work and see an active task injected, continue from where it left off.",
    ],
    parameters: Type.Object({
      action: StringEnum([...ACTIONS], {
        description: "plan=create new plan, check=mark step done, add=add step, view=show status, done=clear plan",
      }),
      title: Type.Optional(Type.String({
        description: "Plan title (required for 'plan' action)",
      })),
      steps: Type.Optional(Type.Array(Type.String(), {
        description: "List of steps (required for 'plan' action)",
      })),
      step: Type.Optional(Type.String({
        description: "Step text — for 'check' (matches partially) or 'add' (new step text)",
      })),
    }),
    async execute(_toolCallId, params) {
      const file = tasksFile(cwd)
      const action = params.action as typeof ACTIONS[number]

      if (action === "plan") {
        if (!params.title || !params.steps || params.steps.length === 0) {
          return {
            content: [{ type: "text" as const, text: "Error: 'plan' action requires title and steps." }],
          }
        }

        const plan: TaskPlan = {
          title: params.title,
          steps: params.steps.map(s => ({ text: s, checked: false })),
        }

        ensureDir(file)
        writeFileSync(file, formatPlan(plan), "utf8")

        return {
          content: [{
            type: "text" as const,
            text: `Plan created: ${plan.title}\n\n${plan.steps.map(s => `- [ ] ${s.text}`).join("\n")}`,
          }],
          details: { file, steps: plan.steps.length },
        }
      }

      if (action === "check") {
        if (!params.step) {
          return {
            content: [{ type: "text" as const, text: "Error: 'check' action requires step text." }],
          }
        }

        if (!existsSync(file)) {
          return {
            content: [{ type: "text" as const, text: "No active plan. Create one with action: 'plan'." }],
          }
        }

        const plan = parsePlan(readFileSync(file, "utf8"))
        if (!plan) {
          return {
            content: [{ type: "text" as const, text: "Could not parse plan file." }],
          }
        }

        const query = params.step.toLowerCase()
        const match = plan.steps.find(s => !s.checked && s.text.toLowerCase().includes(query))

        if (!match) {
          const unchecked = plan.steps.filter(s => !s.checked).map(s => s.text)
          return {
            content: [{
              type: "text" as const,
              text: `No unchecked step matching "${params.step}".\n\nRemaining:\n${unchecked.map(s => `- [ ] ${s}`).join("\n") || "(none)"}`,
            }],
          }
        }

        match.checked = true
        writeFileSync(file, formatPlan(plan), "utf8")

        const done = plan.steps.filter(s => s.checked).length
        return {
          content: [{
            type: "text" as const,
            text: `✓ ${match.text}\n\n${statusSummary(plan)}`,
          }],
          details: { checked: match.text, progress: `${done}/${plan.steps.length}` },
        }
      }

      if (action === "add") {
        if (!params.step) {
          return {
            content: [{ type: "text" as const, text: "Error: 'add' action requires step text." }],
          }
        }

        if (!existsSync(file)) {
          return {
            content: [{ type: "text" as const, text: "No active plan. Create one with action: 'plan'." }],
          }
        }

        const plan = parsePlan(readFileSync(file, "utf8"))
        if (!plan) {
          return {
            content: [{ type: "text" as const, text: "Could not parse plan file." }],
          }
        }

        plan.steps.push({ text: params.step, checked: false })
        writeFileSync(file, formatPlan(plan), "utf8")

        return {
          content: [{
            type: "text" as const,
            text: `Added: ${params.step}\n\n${statusSummary(plan)}`,
          }],
          details: { added: params.step, total: plan.steps.length },
        }
      }

      if (action === "view") {
        if (!existsSync(file)) {
          return {
            content: [{ type: "text" as const, text: "No active plan." }],
          }
        }

        const plan = parsePlan(readFileSync(file, "utf8"))
        if (!plan || plan.steps.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No active plan." }],
          }
        }

        const full = plan.steps.map(s => {
          const mark = s.checked ? "x" : " "
          return `- [${mark}] ${s.text}`
        }).join("\n")

        return {
          content: [{
            type: "text" as const,
            text: `# ${plan.title}\n\n${full}\n\n${statusSummary(plan)}`,
          }],
          details: {
            title: plan.title,
            total: plan.steps.length,
            done: plan.steps.filter(s => s.checked).length,
          },
        }
      }

      if (action === "done") {
        if (!existsSync(file)) {
          return {
            content: [{ type: "text" as const, text: "No active plan to complete." }],
          }
        }

        const plan = parsePlan(readFileSync(file, "utf8"))
        const title = plan?.title ?? "task"

        // Archive: rename to tasks-done.md with timestamp, then remove active
        const timestamp = new Date().toISOString().slice(0, 16).replace("T", " ")
        const archiveFile = join(cwd, ".pi", "tasks-done.md")
        const archiveEntry = `\n## ${timestamp} — ${title}\nCompleted.\n`
        const existing = existsSync(archiveFile) ? readFileSync(archiveFile, "utf8") : ""
        writeFileSync(archiveFile, existing + archiveEntry, "utf8")

        // Remove the active plan
        writeFileSync(file, "", "utf8")

        return {
          content: [{
            type: "text" as const,
            text: `Task "${title}" marked done and archived.`,
          }],
          details: { archived: title },
        }
      }

      return {
        content: [{ type: "text" as const, text: `Unknown action: ${action}` }],
      }
    },
  })

  pi.registerCommand("task", {
    description: "Show current task status",
    handler: async (_args, ctx) => {
      const file = tasksFile(ctx.cwd)
      if (!existsSync(file)) {
        ctx.ui.notify("No active task. Use tasks(action: 'plan') to create one.", "info")
        return
      }

      const plan = parsePlan(readFileSync(file, "utf8"))
      if (!plan || plan.steps.length === 0) {
        ctx.ui.notify("No active task.", "info")
        return
      }

      const lines = [`# ${plan.title}`, ""]
      for (const step of plan.steps) {
        const mark = step.checked ? "✓" : "○"
        lines.push(`  ${mark} ${step.text}`)
      }
      const done = plan.steps.filter(s => s.checked).length
      lines.push("", `  ${done}/${plan.steps.length} complete`)

      ctx.ui.notify(lines.join("\n"), "info")
    },
  })
}
