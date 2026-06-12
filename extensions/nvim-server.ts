import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { resolve } from "node:path"
import { existsSync, unlinkSync } from "node:fs"

/**
 * Nvim server: persistent headless neovim process for fast LSP operations.
 *
 * Instead of spawning a new nvim process per diagnostic/definition/reference
 * request (12+ seconds each for LSP to attach), this extension starts one
 * nvim server at session_start with --listen. The LSP servers stay warm.
 * Subsequent requests complete in milliseconds.
 *
 * Communication:
 *   Other extensions discover the server via pi.events:
 *     pi.events.on("reckoner:nvim-ready", ({ socket }) => { ... })
 *
 *   They send commands via:
 *     nvim --server <socket> --remote-expr 'luaeval("...")'
 *
 * Lifecycle:
 *   session_start → spawn nvim --headless --listen <socket>
 *   session end   → SIGTERM the process, clean up socket
 *
 * Fallback:
 *   If nvim or the config isn't available, the event never fires.
 *   Consumers must handle the case where no server exists.
 */

const RECKONER_NVIM_INIT = resolve(process.env.HOME ?? "~", "Code/reckoner/nvim/init.lua")
const SOCKET_PATH = "/tmp/reckoner-nvim.sock"
const STARTUP_TIMEOUT = 8_000 // max ms to wait for server to be ready
const EXEC_TIMEOUT = 15_000

export default function nvimServerExtension(pi: ExtensionAPI) {
  let serverPid: number | null = null

  /** Check if the server socket exists and nvim responds */
  async function isServerReady(): Promise<boolean> {
    if (!existsSync(SOCKET_PATH)) return false
    try {
      const result = await pi.exec("nvim", [
        "--server", SOCKET_PATH,
        "--remote-expr", 'luaeval("1+1")',
      ], { timeout: 3000 })
      return (result.stdout ?? "").trim() === "2"
    } catch {
      return false
    }
  }

  /** Execute a luaeval expression on the server. Returns the result string. */
  async function serverExec(luaExpr: string): Promise<string> {
    const result = await pi.exec("nvim", [
      "--server", SOCKET_PATH,
      "--remote-expr", `luaeval("${luaExpr.replace(/"/g, '\\"')}")`,
    ], { timeout: EXEC_TIMEOUT })
    return (result.stdout ?? "").trim()
  }

  pi.on("session_start", async (_event, ctx) => {
    // Don't start if nvim or config is missing
    if (!existsSync(RECKONER_NVIM_INIT)) {
      if (ctx.hasUI) ctx.ui.setStatus("nvim-server", "no config")
      return
    }

    try {
      await pi.exec("nvim", ["--version"], { timeout: 3000 })
    } catch {
      if (ctx.hasUI) ctx.ui.setStatus("nvim-server", "nvim not found")
      return
    }

    // Clean up stale socket from a previous crash
    if (existsSync(SOCKET_PATH)) {
      const alreadyRunning = await isServerReady()
      if (alreadyRunning) {
        // Reuse existing server
        if (ctx.hasUI) ctx.ui.setStatus("nvim-server", "nvim ✓ (reused)")
        pi.events.emit("reckoner:nvim-ready", { socket: SOCKET_PATH })
        return
      }
      try { unlinkSync(SOCKET_PATH) } catch {}
    }

    // Start the server
    if (ctx.hasUI) ctx.ui.setStatus("nvim-server", "nvim starting…")

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
      child.unref()
    } catch {
      if (ctx.hasUI) ctx.ui.setStatus("nvim-server", "nvim: spawn failed")
      return
    }

    // Wait for server to become ready
    const startTime = Date.now()
    let ready = false
    while (Date.now() - startTime < STARTUP_TIMEOUT) {
      if (await isServerReady()) {
        ready = true
        break
      }
      await new Promise(r => setTimeout(r, 500))
    }

    if (ready) {
      if (ctx.hasUI) ctx.ui.setStatus("nvim-server", "nvim ✓")
      pi.events.emit("reckoner:nvim-ready", { socket: SOCKET_PATH })
    } else {
      if (ctx.hasUI) ctx.ui.setStatus("nvim-server", "nvim: timeout")
      // Kill the process if it didn't start properly
      if (serverPid) {
        try { process.kill(serverPid) } catch {}
        serverPid = null
      }
    }
  })

  // Clean up on session end (best effort)
  pi.on("agent_end", async () => {
    // Don't kill the server on agent_end — it persists across agent runs within a session
  })

  // Register a command to check server status
  pi.registerCommand("nvim-server", {
    description: "Show nvim server status",
    handler: async (_args, ctx) => {
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
