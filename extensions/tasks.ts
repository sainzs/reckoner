import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { Type } from "@sinclair/typebox"
import { StringEnum } from "@mariozechner/pi-ai"
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs"
import { join, dirname } from "node:path"
import { parsePlan, type TaskPlan, type TaskStep } from "./lib/parse-plan.js"
import type { InjectionBuildContext, TaskState } from "./lib/lesson-types.js"

const ACTIONS = ["plan", "check", "add", "view", "done"] as const

function tasksFile(cwd: string): string {
  return join(cwd, ".pi", "tasks.md")
}

function ensureDir(path: string) {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function formatPlan(plan: TaskPlan): string {
  const lines = [`# ${plan.title}`, ""]
  for (const step of plan.steps) {
    const mark = step.checked ? "x" : " "
    lines.push(`- [${mark}] ${step.text}`)
  }
  return lines.join("\n") + "\n"
}

function toTaskState(plan: TaskPlan | null): TaskState | null {
  if (!plan || plan.steps.length === 0) return null
  const done = plan.steps.filter((step: TaskStep) => step.checked).length
  const remaining = plan.steps.filter((step: TaskStep) => !step.checked).map((step: TaskStep) => step.text)
  return {
    title: plan.title,
    done,
    total: plan.steps.length,
    nextStep: remaining[0],
    remainingSteps: remaining,
  }
}

function statusSummary(plan: TaskPlan): string {
  const state = toTaskState(plan)
  if (!state) return "No active plan."
  return [
    `**${state.title}** — ${state.done}/${state.total} steps`,
    state.nextStep ? `Next: ${state.nextStep}` : "All steps complete.",
  ].join("\n")
}

function injectionSummary(state: TaskState): string {
  const lines = [
    "## Active task",
    "",
    `**${state.title}** (${state.done}/${state.total} complete)`,
  ]

  if (state.remainingSteps.length > 0) {
    lines.push("", "Remaining:")
    for (const step of state.remainingSteps.slice(0, 5)) {
      lines.push(`- [ ] ${step}`)
    }
    if (state.remainingSteps.length > 5) {
      lines.push(`  ...and ${state.remainingSteps.length - 5} more`)
    }
  } else {
    lines.push("", "All steps complete — mark done with tasks(action: 'done') or continue.")
  }

  return lines.join("\n")
}

export default function tasksExtension(pi: ExtensionAPI) {
  let cwd = ""
  let activeTask: TaskState | null = null

  function emitTaskState() {
    pi.events.emit("reckoner:task-updated", activeTask)
  }

  function refreshFromDisk() {
    const file = tasksFile(cwd)
    if (!existsSync(file)) {
      activeTask = null
      emitTaskState()
      return null
    }

    const content = readFileSync(file, "utf8")
    const plan = parsePlan(content)
    activeTask = toTaskState(plan)
    emitTaskState()
    return plan
  }

  function updateUi(ctx: any) {
    if (!ctx.hasUI) return
    if (!activeTask) {
      ctx.ui.setStatus("tasks", "TASK NONE")
      return
    }
    ctx.ui.setStatus("tasks", `TASK ${activeTask.done}/${activeTask.total}`)
  }

  pi.on("session_start", async (_event: any, ctx: any) => {
    cwd = ctx.cwd
    refreshFromDisk()
    updateUi(ctx)

    pi.events.emit("reckoner:register-injection", {
      key: "tasks",
      priority: 30,
      maxChars: 900,
      build: (_context: InjectionBuildContext) => {
        if (!activeTask) return null
        const text = `\n\n---\n${injectionSummary(activeTask)}\n---`
        return {
          key: "tasks",
          text,
          chars: text.length,
          reason: activeTask.nextStep ? `next step: ${activeTask.nextStep}` : "active task",
          priority: 30,
        }
      },
    })
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
      title: Type.Optional(Type.String({ description: "Plan title (required for 'plan' action)" })),
      steps: Type.Optional(Type.Array(Type.String(), { description: "List of steps (required for 'plan' action)" })),
      step: Type.Optional(Type.String({ description: "Step text — for 'check' (matches partially) or 'add' (new step text)" })),
    }),
    async execute(_toolCallId: string, params: any) {
      const file = tasksFile(cwd)
      const action = params.action as typeof ACTIONS[number]

      if (action === "plan") {
        if (!params.title || !params.steps || params.steps.length === 0) {
          return { content: [{ type: "text" as const, text: "Error: 'plan' action requires title and steps." }] }
        }

        const plan: TaskPlan = {
          title: params.title,
          steps: params.steps.map((step: string) => ({ text: step, checked: false })),
        }
        ensureDir(file)
        writeFileSync(file, formatPlan(plan), "utf8")
        activeTask = toTaskState(plan)
        emitTaskState()
        return {
          content: [{ type: "text" as const, text: `Plan created: ${plan.title}\n\n${plan.steps.map((step: TaskStep) => `- [ ] ${step.text}`).join("\n")}` }],
          details: { file, steps: plan.steps.length },
        }
      }

      if (action === "check") {
        if (!params.step) {
          return { content: [{ type: "text" as const, text: "Error: 'check' action requires step text." }] }
        }
        if (!existsSync(file)) {
          return { content: [{ type: "text" as const, text: "No active plan. Create one with action: 'plan'." }] }
        }

        const plan = parsePlan(readFileSync(file, "utf8"))
        if (!plan) {
          return { content: [{ type: "text" as const, text: "Could not parse plan file." }] }
        }

        const query = String(params.step).toLowerCase()
        const match = plan.steps.find((step: TaskStep) => !step.checked && step.text.toLowerCase().includes(query))
        if (!match) {
          const unchecked = plan.steps.filter((step: TaskStep) => !step.checked).map((step: TaskStep) => step.text)
          return {
            content: [{ type: "text" as const, text: `No unchecked step matching "${params.step}".\n\nRemaining:\n${unchecked.map((step: string) => `- [ ] ${step}`).join("\n") || "(none)"}` }],
          }
        }

        match.checked = true
        writeFileSync(file, formatPlan(plan), "utf8")
        activeTask = toTaskState(plan)
        emitTaskState()
        return {
          content: [{ type: "text" as const, text: `COMPLETE: ${match.text}\n\n${statusSummary(plan)}` }],
          details: { checked: match.text, progress: `${activeTask?.done ?? 0}/${activeTask?.total ?? plan.steps.length}` },
        }
      }

      if (action === "add") {
        if (!params.step) {
          return { content: [{ type: "text" as const, text: "Error: 'add' action requires step text." }] }
        }
        if (!existsSync(file)) {
          return { content: [{ type: "text" as const, text: "No active plan. Create one with action: 'plan'." }] }
        }

        const plan = parsePlan(readFileSync(file, "utf8"))
        if (!plan) {
          return { content: [{ type: "text" as const, text: "Could not parse plan file." }] }
        }

        plan.steps.push({ text: params.step, checked: false })
        writeFileSync(file, formatPlan(plan), "utf8")
        activeTask = toTaskState(plan)
        emitTaskState()
        return {
          content: [{ type: "text" as const, text: `Added: ${params.step}\n\n${statusSummary(plan)}` }],
          details: { added: params.step, total: plan.steps.length },
        }
      }

      if (action === "view") {
        if (!existsSync(file)) {
          return { content: [{ type: "text" as const, text: "No active plan." }] }
        }

        const plan = parsePlan(readFileSync(file, "utf8"))
        if (!plan || plan.steps.length === 0) {
          return { content: [{ type: "text" as const, text: "No active plan." }] }
        }

        return {
          content: [{ type: "text" as const, text: `# ${plan.title}\n\n${plan.steps.map((step: TaskStep) => `- [${step.checked ? "x" : " "}] ${step.text}`).join("\n")}\n\n${statusSummary(plan)}` }],
          details: {
            title: plan.title,
            total: plan.steps.length,
            done: plan.steps.filter((step: TaskStep) => step.checked).length,
          },
        }
      }

      if (action === "done") {
        if (!existsSync(file)) {
          return { content: [{ type: "text" as const, text: "No active plan to complete." }] }
        }

        const plan = parsePlan(readFileSync(file, "utf8"))
        const title = plan?.title ?? "task"
        const timestamp = new Date().toISOString().slice(0, 16).replace("T", " ")
        const archiveFile = join(cwd, ".pi", "tasks-done.md")
        const archiveEntry = `\n## ${timestamp} — ${title}\nCompleted.\n`
        const existing = existsSync(archiveFile) ? readFileSync(archiveFile, "utf8") : ""
        writeFileSync(archiveFile, existing + archiveEntry, "utf8")
        try { unlinkSync(file) } catch {}
        activeTask = null
        emitTaskState()
        return {
          content: [{ type: "text" as const, text: `Task "${title}" marked done and archived.` }],
          details: { archived: title },
        }
      }

      return { content: [{ type: "text" as const, text: `Unknown action: ${action}` }] }
    },
  })

  pi.registerCommand("task", {
    description: "Show current task status",
    handler: async (_args: string, ctx: any) => {
      refreshFromDisk()
      updateUi(ctx)
      if (!activeTask) {
        ctx.ui.notify("No active task. Use tasks(action: 'plan') to create one.", "info")
        return
      }

      const lines = [
        `# ${activeTask.title}`,
        "",
        ...activeTask.remainingSteps.map((step: string) => `  [ ] ${step}`),
        "",
        `  ${activeTask.done}/${activeTask.total} complete`,
      ]
      ctx.ui.notify(lines.join("\n"), "info")
    },
  })
}
