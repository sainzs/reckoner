import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type WorkspaceSnapshot = {
  cwd: string;
  root?: string;
  branch?: string;
  dirtyCount?: number;
  dirtyFiles: string[];
  packageName?: string;
  scripts: string[];
}

let snapshot: WorkspaceSnapshot | null = null

async function runText(pi: ExtensionAPI, command: string, args: string[]): Promise<string | undefined> {
  try {
    const result = await pi.exec(command, args, { timeout: 5_000 })
    const text = String(result.stdout ?? "").trim()
    return text.length > 0 ? text : undefined
  } catch {
    return undefined
  }
}

function readPackageInfo(cwd: string): Pick<WorkspaceSnapshot, "packageName" | "scripts"> {
  const packageJsonPath = join(cwd, "package.json")
  if (!existsSync(packageJsonPath)) return { scripts: [] }

  try {
    const raw = readFileSync(packageJsonPath, "utf8")
    const pkg = JSON.parse(raw) as { name?: string; scripts?: Record<string, unknown> }
    return {
      packageName: typeof pkg.name === "string" ? pkg.name : undefined,
      scripts: Object.keys(pkg.scripts ?? {}),
    }
  } catch {
    return { scripts: [] }
  }
}

async function buildSnapshot(pi: ExtensionAPI, cwd: string): Promise<WorkspaceSnapshot> {
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

function formatSnapshot(snapshot: WorkspaceSnapshot): string[] {
  const lines = ["Workspace snapshot:", `- cwd: ${snapshot.cwd}`]

  if (snapshot.root) {
    const branch = snapshot.branch ?? "detached"
    const dirty = snapshot.dirtyCount ?? 0
    lines.push(`- git: ${branch}${dirty > 0 ? ` (${dirty} dirty)` : " (clean)"}`)
  }

  if (snapshot.packageName) {
    lines.push(`- package: ${snapshot.packageName}`)
  }

  if (snapshot.scripts.length > 0) {
    lines.push(`- scripts: ${snapshot.scripts.slice(0, 8).join(", ")}`)
  }

  if (snapshot.dirtyFiles.length > 0) {
    lines.push("- dirty files:")
    for (const file of snapshot.dirtyFiles.slice(0, 6)) {
      lines.push(`  - ${file}`)
    }
  }

  return lines
}

function updateUi(ctx: any, snapshot: WorkspaceSnapshot) {
  const lines = formatSnapshot(snapshot)
  if (!ctx.hasUI) return

  ctx.ui.setStatus(
    "workspace-context",
    snapshot.root
      ? `${snapshot.branch ?? "detached"}${snapshot.dirtyCount ? ` • ${snapshot.dirtyCount} dirty` : ""}`
      : "no git repo",
  )
  ctx.ui.setWidget("workspace-context", lines)
}

function buildPromptBlock(snapshot: WorkspaceSnapshot): string {
  const lines = formatSnapshot(snapshot)
  return ["", ...lines].join("\n")
}

export default function workspaceContextExtension(pi: ExtensionAPI) {
  async function refresh(ctx: any) {
    snapshot = await buildSnapshot(pi, ctx.cwd)
    updateUi(ctx, snapshot)
    return snapshot
  }

  pi.on("session_start", async (_event, ctx) => {
    await refresh(ctx)
  })

  pi.on("before_agent_start", async (event, ctx) => {
    const current = snapshot ?? (await refresh(ctx))
    if (!current) return

    const extra = buildPromptBlock(current)
    return {
      systemPrompt: `${event.systemPrompt}${extra}`,
    }
  })

  pi.registerCommand("snapshot", {
    description: "Refresh the workspace snapshot and show it",
    handler: async (_args, ctx) => {
      await refresh(ctx)
      ctx.ui.notify("Workspace snapshot refreshed", "info")
    },
  })
}
