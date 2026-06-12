import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"

/**
 * Plan mode: switch between Plan (read-only) and Build (full tools).
 *
 * Inspired by OpenCode's Tab-to-switch pattern:
 * - Plan mode: disables edit/write tools, agent can only read and analyze
 * - Build mode: full tool access, agent can make changes
 *
 * This prevents premature edits and forces the agent to understand
 * before acting. Toggle with /plan or /build or Ctrl+T shortcut.
 */

type Mode = "build" | "plan"
let currentMode: Mode = "build"

const BUILD_TOOLS_BLOCKED = new Set<string>() // nothing blocked
const PLAN_TOOLS_BLOCKED = new Set(["edit", "write"]) // block mutation tools

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

export default function planModeExtension(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.hasUI) {
      ctx.ui.setStatus("mode", getModeLabel(currentMode))
    }

    pi.events.emit("reckoner:register-injection", {
      key: "plan-mode",
      priority: 50,
      build: () => getModePrompt(currentMode),
    })
  })

  pi.on("tool_call", async (event, ctx) => {
    if (currentMode !== "plan") return
    if (PLAN_TOOLS_BLOCKED.has(event.toolName)) {
      return {
        block: true,
        reason: `Tool "${event.toolName}" is disabled in Plan mode. Switch to Build mode with /build to make changes.`,
      }
    }
  })

  // Toggle shortcut
  pi.registerShortcut("ctrl+t", {
    description: "Toggle between Plan and Build mode",
    handler: async (ctx) => {
      currentMode = currentMode === "build" ? "plan" : "build"
      ctx.ui.notify(`Switched to ${currentMode.toUpperCase()} mode`, "info")
      ctx.ui.setStatus("mode", getModeLabel(currentMode))
    },
  })

  pi.registerCommand("plan", {
    description: "Switch to Plan mode (read-only, no edits)",
    handler: async (_args, ctx) => {
      currentMode = "plan"
      ctx.ui.notify("PLAN mode: edit and write tools are disabled. Analyze before building.", "info")
      ctx.ui.setStatus("mode", getModeLabel(currentMode))
    },
  })

  pi.registerCommand("build", {
    description: "Switch to Build mode (full tool access)",
    handler: async (_args, ctx) => {
      currentMode = "build"
      ctx.ui.notify("BUILD mode: full tool access enabled.", "info")
      ctx.ui.setStatus("mode", getModeLabel(currentMode))
    },
  })

  pi.registerCommand("mode", {
    description: "Show current mode or switch (plan/build)",
    handler: async (args, ctx) => {
      const target = args.trim().toLowerCase()
      if (target === "plan" || target === "build") {
        currentMode = target as Mode
        ctx.ui.notify(`Switched to ${currentMode.toUpperCase()} mode`, "info")
      } else {
        ctx.ui.notify(`Current mode: ${currentMode.toUpperCase()}\n\nUse /plan or /build to switch, or Ctrl+T to toggle.`, "info")
      }
      ctx.ui.setStatus("mode", getModeLabel(currentMode))
    },
  })
}
