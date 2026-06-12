import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { truncateToWidth } from "@mariozechner/pi-tui"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { InjectionBuildContext, WorkspaceState } from "./lib/lesson-types.js"

let snapshot: WorkspaceState | null = null

async function runText(pi: ExtensionAPI, command: string, args: string[]): Promise<string | undefined> {
  try {
    const result = await pi.exec(command, args, { timeout: 5_000 })
    const text = String(result.stdout ?? "").trim()
    return text.length > 0 ? text : undefined
  } catch {
    return undefined
  }
}

function readPackageInfo(cwd: string): Pick<WorkspaceState, "packageName" | "scripts"> {
  const packageJsonPath = join(cwd, "package.json")
  if (!existsSync(packageJsonPath)) return { scripts: [] }

  try {
    const raw = readFileSync(packageJsonPath, "utf8")
    const pkg = JSON.parse(raw) as { name?: string, scripts?: Record<string, unknown> }
    return {
      packageName: typeof pkg.name === "string" ? pkg.name : undefined,
      scripts: Object.keys(pkg.scripts ?? {}),
    }
  } catch {
    return { scripts: [] }
  }
}

async function buildSnapshot(pi: ExtensionAPI, cwd: string): Promise<WorkspaceState> {
  const root = await runText(pi, "git", ["-C", cwd, "rev-parse", "--show-toplevel"])
  const branch = root ? await runText(pi, "git", ["-C", cwd, "branch", "--show-current"]) : undefined
  const status = root ? await runText(pi, "git", ["-C", cwd, "status", "--short"]) : undefined
  const dirtyFiles = status ? status.split(/\r?\n/).filter(Boolean).slice(0, 12) : []
  const packageInfo = readPackageInfo(cwd)

  return {
    cwd,
    root,
    branch,
    dirtyCount: status ? status.split(/\r?\n/).filter(Boolean).length : 0,
    dirtyFiles,
    packageName: packageInfo.packageName,
    scripts: packageInfo.scripts,
  }
}

function formatSnapshot(nextSnapshot: WorkspaceState): string[] {
  const lines = ["Workspace snapshot:", `- cwd: ${nextSnapshot.cwd}`]

  if (nextSnapshot.root) {
    const branch = nextSnapshot.branch ?? "detached"
    lines.push(`- git: ${branch}${nextSnapshot.dirtyCount > 0 ? ` (${nextSnapshot.dirtyCount} dirty)` : " (clean)"}`)
  }

  if (nextSnapshot.packageName) {
    lines.push(`- package: ${nextSnapshot.packageName}`)
  }

  if (nextSnapshot.scripts.length > 0) {
    lines.push(`- scripts: ${nextSnapshot.scripts.slice(0, 8).join(", ")}`)
  }

  if (nextSnapshot.dirtyFiles.length > 0) {
    lines.push("- dirty files:")
    for (const file of nextSnapshot.dirtyFiles.slice(0, 6)) {
      lines.push(`  - ${file}`)
    }
  }

  return lines
}

function buildPromptBlock(nextSnapshot: WorkspaceState): string {
  return ["", ...formatSnapshot(nextSnapshot)].join("\n")
}

function widgetLine(nextSnapshot: WorkspaceState): string {
  const parts: string[] = []
  if (nextSnapshot.packageName) parts.push(nextSnapshot.packageName)
  if (nextSnapshot.root) {
    const branch = nextSnapshot.branch ?? "detached"
    const dirty = nextSnapshot.dirtyCount > 0 ? ` · ${nextSnapshot.dirtyCount} changes` : ""
    parts.push(`${branch}${dirty}`)
  }
  return parts.join("  ·  ")
}

function updateUi(ctx: any, nextSnapshot: WorkspaceState) {
  if (!ctx.hasUI) return
  const line = widgetLine(nextSnapshot)
  if (line) {
    ctx.ui.setWidget("workspace-context", (_tui: any, theme: any) => ({
      render: (width: number) => [truncateToWidth(theme.fg("dim", line), width)],
      invalidate: () => {},
    }))
  }
}

export default function workspaceContextExtension(pi: ExtensionAPI) {
  async function refresh(ctx: any) {
    snapshot = await buildSnapshot(pi, ctx.cwd)
    updateUi(ctx, snapshot)
    pi.events.emit("reckoner:workspace-updated", snapshot)
    return snapshot
  }

  pi.on("session_start", async (_event: any, ctx: any) => {
    await refresh(ctx)
    pi.events.emit("reckoner:register-injection", {
      key: "workspace-context",
      priority: 20,
      maxChars: 700,
      build: (_context: InjectionBuildContext) => snapshot ? {
        key: "workspace-context",
        text: buildPromptBlock(snapshot),
        chars: buildPromptBlock(snapshot).length,
        reason: snapshot.branch ? `workspace ${snapshot.branch}` : "workspace snapshot",
        priority: 20,
      } : null,
    })
  })

  pi.registerCommand("snapshot", {
    description: "Refresh the workspace snapshot and show it",
    handler: async (_args: string, ctx: any) => {
      const next = await refresh(ctx)
      ctx.ui.notify(formatSnapshot(next).join("\n"), "info")
    },
  })
}
