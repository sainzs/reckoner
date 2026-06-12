import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"

/**
 * Git checkpoint: automatic safety net for agent edits.
 *
 * - On agent_start: snapshots the working tree via `git stash create`
 * - Stores checkpoint hashes for the session
 * - /undo: restores the last checkpoint
 * - /checkpoints: lists available restore points
 * - Toggle with /checkpoint on|off
 */

type Checkpoint = {
  hash: string
  timestamp: number
  description: string
}

let checkpoints: Checkpoint[] = []
let enabled = true

async function run(pi: ExtensionAPI, cmd: string, args: string[], timeout = 10_000): Promise<string> {
  const result = await pi.exec(cmd, args, { timeout })
  return (result.stdout ?? "").trim()
}

async function isGitRepo(pi: ExtensionAPI): Promise<boolean> {
  try {
    await run(pi, "git", ["rev-parse", "--is-inside-work-tree"])
    return true
  } catch {
    return false
  }
}

async function hasDirtyFiles(pi: ExtensionAPI): Promise<boolean> {
  try {
    const status = await run(pi, "git", ["status", "--porcelain"])
    return status.length > 0
  } catch {
    return false
  }
}

async function createCheckpoint(pi: ExtensionAPI, description: string): Promise<string | undefined> {
  const dirty = await hasDirtyFiles(pi)
  if (!dirty) return undefined

  try {
    // Stage everything including untracked files, create stash commit, then unstage
    // git stash create only captures staged + tracked modified, so we stage first
    await run(pi, "git", ["add", "-A"])
    const hash = await run(pi, "git", ["stash", "create", description])
    await run(pi, "git", ["reset"]) // unstage without changing working tree

    if (!hash || hash.length < 7) return undefined

    checkpoints.push({ hash, timestamp: Date.now(), description })
    return hash
  } catch {
    // Make sure we unstage even on failure
    try { await run(pi, "git", ["reset"]) } catch {}
    return undefined
  }
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour12: false })
}

export default function gitCheckpointExtension(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    checkpoints = []
    if (ctx.hasUI) {
      ctx.ui.setStatus("checkpoint", enabled ? "checkpoints on" : "checkpoints off")
    }
  })

  pi.on("agent_start", async (_event, ctx) => {
    if (!enabled) return
    if (!(await isGitRepo(pi))) return

    const hash = await createCheckpoint(pi, "pi-auto: before agent turn")
    if (hash && ctx.hasUI) {
      ctx.ui.setStatus("checkpoint", `${checkpoints.length} checkpoint(s)`)
    }
  })

  pi.on("agent_end", async (_event, ctx) => {
    if (!enabled) return
    if (!(await isGitRepo(pi))) return

    const hash = await createCheckpoint(pi, "pi-auto: after agent turn")
    if (hash && ctx.hasUI) {
      ctx.ui.setStatus("checkpoint", `${checkpoints.length} checkpoint(s)`)
    }
  })

  pi.registerCommand("undo", {
    description: "Restore the last git checkpoint created by the agent",
    handler: async (_args, ctx) => {
      if (checkpoints.length === 0) {
        ctx.ui.notify("No checkpoints available to restore.", "warning")
        return
      }

      if (!(await isGitRepo(pi))) {
        ctx.ui.notify("Not in a git repository.", "error")
        return
      }

      const last = checkpoints[checkpoints.length - 1]
      const ok = await ctx.ui.confirm(
        "Restore checkpoint?",
        `This will discard tracked-file changes and restore to:\n\n${last.description} (${formatTime(last.timestamp)})\n\nHash: ${last.hash.slice(0, 8)}\n\nUntracked files are preserved; if they conflict, restore may fail rather than deleting them.`,
      )

      if (!ok) return

      try {
        // Reset tracked files only, preserving untracked files. If an
        // untracked file conflicts with the checkpoint, fail instead of
        // deleting user data with git clean.
        await run(pi, "git", ["checkout", "--", "."])
        await run(pi, "git", ["stash", "apply", last.hash])
        checkpoints.pop()
        ctx.ui.notify(
          `Restored checkpoint: ${last.description}\n${checkpoints.length} checkpoint(s) remaining.`,
          "info",
        )
      } catch (err) {
        ctx.ui.notify(`Failed to restore checkpoint: ${err}`, "error")
      }

      if (ctx.hasUI) {
        const label = checkpoints.length > 0 ? `${checkpoints.length} checkpoint(s)` : "no checkpoints"
        ctx.ui.setStatus("checkpoint", label)
      }
    },
  })

  pi.registerCommand("checkpoints", {
    description: "List available git checkpoints",
    handler: async (_args, ctx) => {
      if (checkpoints.length === 0) {
        ctx.ui.notify("No checkpoints stored this session.", "info")
        return
      }

      const lines = checkpoints.map(
        (cp, i) => `${i + 1}. ${formatTime(cp.timestamp)} — ${cp.description} (${cp.hash.slice(0, 8)})`,
      )
      ctx.ui.notify(`Git checkpoints:\n${lines.join("\n")}`, "info")
    },
  })

  pi.registerCommand("checkpoint", {
    description: "Toggle checkpointing (on/off) or create one manually",
    handler: async (args, ctx) => {
      const mode = args.trim().toLowerCase()

      if (mode === "off" || mode === "disable") {
        enabled = false
        ctx.ui.notify("Git checkpoints disabled", "warning")
      } else if (mode === "on" || mode === "enable") {
        enabled = true
        ctx.ui.notify("Git checkpoints enabled", "info")
      } else if (mode === "now" || mode === "create") {
        const hash = await createCheckpoint(pi, "pi-manual: user requested")
        if (hash) {
          ctx.ui.notify(`Checkpoint created: ${hash.slice(0, 8)}`, "info")
        } else {
          ctx.ui.notify("No dirty files to checkpoint.", "info")
        }
      } else {
        const state = enabled ? "enabled" : "disabled"
        ctx.ui.notify(`Checkpoints: ${state}, ${checkpoints.length} stored`, "info")
      }

      if (ctx.hasUI) {
        ctx.ui.setStatus("checkpoint", enabled ? "checkpoints on" : "checkpoints off")
      }
    },
  })
}
