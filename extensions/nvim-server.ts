import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { existsSync, unlinkSync } from "node:fs"
import type { NvimStatusPayload } from "./lib/lesson-types.js"
import { NVIM_INIT_PATH } from "./lib/package-path.js"

const RECKONER_NVIM_INIT = NVIM_INIT_PATH
const SOCKET_PATH = "/tmp/reckoner-nvim.sock"
const STARTUP_TIMEOUT = 8_000
const EXEC_TIMEOUT = 15_000

export default function nvimServerExtension(pi: ExtensionAPI) {
  let serverPid: number | null = null
  let ownedByUs = false

  function emitStatus(ctx: any, label: string, ready: boolean) {
    if (ctx?.hasUI) ctx.ui.setStatus("nvim-server", label)
    pi.events.emit("reckoner:nvim-status", {
      label,
      ready,
      socket: ready ? SOCKET_PATH : undefined,
      ownedByUs,
    } satisfies NvimStatusPayload)
  }

  function cleanup() {
    if (ownedByUs && serverPid) {
      try { process.kill(serverPid) } catch {}
      try { unlinkSync(SOCKET_PATH) } catch {}
      serverPid = null
      ownedByUs = false
    }
  }

  process.on("exit", cleanup)
  process.on("SIGTERM", cleanup)
  process.on("SIGINT", cleanup)

  async function isServerReady(): Promise<boolean> {
    if (!existsSync(SOCKET_PATH)) return false
    try {
      const result = await pi.exec("nvim", [
        "--server", SOCKET_PATH,
        "--remote-expr", 'luaeval("1+1")',
      ], { timeout: 3000 })
      return String(result.stdout ?? "").trim() === "2"
    } catch {
      return false
    }
  }

  async function serverExec(luaExpr: string): Promise<string> {
    const result = await pi.exec("nvim", [
      "--server", SOCKET_PATH,
      "--remote-expr", `luaeval("${luaExpr.replace(/"/g, '\\"')}")`,
    ], { timeout: EXEC_TIMEOUT })
    return String(result.stdout ?? "").trim()
  }

  pi.on("session_start", async (_event: any, ctx: any) => {
    if (!existsSync(RECKONER_NVIM_INIT)) {
      emitStatus(ctx, "NVIM UNAVAILABLE", false)
      return
    }

    try {
      await pi.exec("nvim", ["--version"], { timeout: 3000 })
    } catch {
      emitStatus(ctx, "NVIM MISSING", false)
      return
    }

    if (existsSync(SOCKET_PATH)) {
      const alreadyRunning = await isServerReady()
      if (alreadyRunning) {
        emitStatus(ctx, "NVIM REUSED", true)
        pi.events.emit("reckoner:nvim-ready", { socket: SOCKET_PATH })
        return
      }
      try { unlinkSync(SOCKET_PATH) } catch {}
    }

    emitStatus(ctx, "NVIM STARTING", false)

    try {
      const { spawn } = await import("node:child_process")
      const child = spawn("nvim", [
        "-u", RECKONER_NVIM_INIT,
        "--headless",
        "--listen", SOCKET_PATH,
      ], {
        detached: true,
        stdio: "ignore",
      })
      serverPid = child.pid ?? null
      ownedByUs = true
      child.unref()
    } catch {
      emitStatus(ctx, "NVIM FAILED", false)
      return
    }

    const startTime = Date.now()
    let ready = false
    while (Date.now() - startTime < STARTUP_TIMEOUT) {
      if (await isServerReady()) {
        ready = true
        break
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    if (ready) {
      emitStatus(ctx, "NVIM READY", true)
      pi.events.emit("reckoner:nvim-ready", { socket: SOCKET_PATH })
    } else {
      emitStatus(ctx, "NVIM TIMEOUT", false)
      if (serverPid) {
        try { process.kill(serverPid) } catch {}
        serverPid = null
      }
    }
  })

  pi.registerCommand("nvim-server", {
    description: "Show nvim server status",
    handler: async (_args: string, ctx: any) => {
      const ready = await isServerReady()
      if (ready) {
        try {
          const info = await serverExec("vim.json.encode({clients=#vim.lsp.get_clients(), buffers=vim.fn.len(vim.fn.getbufinfo({buflisted=1}))})")
          ctx.ui.notify(`Nvim server: running\nSocket: ${SOCKET_PATH}\n${info}`, "info")
        } catch {
          ctx.ui.notify(`Nvim server: running\nSocket: ${SOCKET_PATH}`, "info")
        }
      } else {
        ctx.ui.notify(`Nvim server: not running\nPID: ${serverPid ?? "none"}`, "warning")
      }
    },
  })
}
