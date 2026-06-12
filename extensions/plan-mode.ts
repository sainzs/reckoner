import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import type { InjectionBuildContext } from "./lib/lesson-types.js"

type Mode = "build" | "plan"
let currentMode: Mode = "build"

const PLAN_TOOLS_BLOCKED = new Set(["edit", "write"])

function getModeLabel(mode: Mode): string {
  return mode === "plan" ? "PLAN" : "BUILD"
}

function getModePrompt(mode: Mode): string {
  if (mode === "plan") {
    return [
      "",
      "---",
      "## Mode: PLAN",
      "",
      "You are in Plan mode. You can read files, search, analyze, and think —",
      "but you CANNOT edit or write files. Use this to:",
      "- Understand the codebase structure (use repo_map)",
      "- Read relevant files thoroughly",
      "- Identify the right approach",
      "- Outline the implementation plan",
      "- Flag risks and unknowns",
      "",
      "When the plan is ready, the user will switch to Build mode.",
      "---",
    ].join("\n")
  }
  return ""
}

function emitMode(pi: ExtensionAPI) {
  pi.events.emit("reckoner:mode-changed", { mode: currentMode, label: getModeLabel(currentMode) })
}

export default function planModeExtension(pi: ExtensionAPI) {
  pi.on("session_start", async (_event: any, ctx: any) => {
    if (ctx.hasUI) {
      ctx.ui.setStatus("mode", getModeLabel(currentMode))
    }
    emitMode(pi)

    pi.events.emit("reckoner:register-injection", {
      key: "plan-mode",
      priority: 50,
      maxChars: 700,
      build: (_context: InjectionBuildContext) => {
        const text = getModePrompt(currentMode)
        if (!text) return null
        return {
          key: "plan-mode",
          text,
          chars: text.length,
          reason: `mode ${currentMode}`,
          priority: 50,
        }
      },
    })
  })

  pi.on("tool_call", async (event: any) => {
    if (currentMode !== "plan") return
    if (PLAN_TOOLS_BLOCKED.has(event.toolName)) {
      return {
        block: true,
        reason: `Tool "${event.toolName}" is disabled in Plan mode. Switch to Build mode with /build to make changes.`,
      }
    }
  })

  pi.registerShortcut("ctrl+shift+t", {
    description: "Toggle between Plan and Build mode",
    handler: async (ctx: any) => {
      currentMode = currentMode === "build" ? "plan" : "build"
      ctx.ui.notify(`Switched to ${currentMode.toUpperCase()} mode`, "info")
      ctx.ui.setStatus("mode", getModeLabel(currentMode))
      emitMode(pi)
    },
  })

  pi.registerCommand("plan", {
    description: "Switch to Plan mode (read-only, no edits)",
    handler: async (_args: string, ctx: any) => {
      currentMode = "plan"
      ctx.ui.notify("PLAN mode: edit and write tools are disabled. Analyze before building.", "info")
      ctx.ui.setStatus("mode", getModeLabel(currentMode))
      emitMode(pi)
    },
  })

  pi.registerCommand("build", {
    description: "Switch to Build mode (full tool access)",
    handler: async (_args: string, ctx: any) => {
      currentMode = "build"
      ctx.ui.notify("BUILD mode: full tool access enabled.", "info")
      ctx.ui.setStatus("mode", getModeLabel(currentMode))
      emitMode(pi)
    },
  })

  pi.registerCommand("mode", {
    description: "Show current mode or switch (plan/build)",
    handler: async (args: string, ctx: any) => {
      const target = args.trim().toLowerCase()
      if (target === "plan" || target === "build") {
        currentMode = target as Mode
        ctx.ui.notify(`Switched to ${currentMode.toUpperCase()} mode`, "info")
      } else {
        ctx.ui.notify(`Current mode: ${currentMode.toUpperCase()}\n\nUse /plan or /build to switch, or Ctrl+T to toggle.`, "info")
      }
      ctx.ui.setStatus("mode", getModeLabel(currentMode))
      emitMode(pi)
    },
  })
}
