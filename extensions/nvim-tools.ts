import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { Type } from "@sinclair/typebox"
import { resolve } from "node:path"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { writeFileSync, mkdtempSync, unlinkSync } from "node:fs"
import { NVIM_INIT_PATH } from "./lib/package-path.js"

/**
 * Nvim tools: agent-native code intelligence through your real editor stack.
 *
 * Uses the user's actual nvim + treesitter + LSP for:
 *   - Real diagnostics across any configured language
 *   - AST-aware symbol extraction via treesitter
 *   - Definition and reference lookup via LSP
 *   - Formatting via the editor's existing language tooling
 *
 * Requires:
 *   - nvim 0.10+ with treesitter parsers installed
 *   - Language servers on PATH (ts_ls, pyright, gopls, etc.)
 *   - Reckoner nvim config (path resolved from package root)
 */

const RECKONER_NVIM_INIT = NVIM_INIT_PATH
const NVIM_TIMEOUT = 25_000
const LSP_WAIT_SECS = 15
const SERVER_POLL_INTERVAL = 300 // ms
const SERVER_POLL_MAX = 30 // attempts (9 seconds max)

let serverQueue: Promise<void> = Promise.resolve()

function nvimArgs(file: string): string[] {
  return [
    "-u", RECKONER_NVIM_INIT,
    "--headless",
    file,
  ]
}

function writeLuaScript(code: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), "reckoner-nvim-"))
  const path = resolve(dir, "script.lua")
  writeFileSync(path, code, "utf8")
  return path
}

function vimSingleQuoted(value: string): string {
  return value.replace(/'/g, "''")
}

async function withServerLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = serverQueue.catch(() => undefined)
  let release: (() => void) | undefined
  serverQueue = new Promise<void>((resolve) => {
    release = resolve
  })

  await previous
  try {
    return await fn()
  } finally {
    release?.()
  }
}

async function waitForServerBuffer(pi: ExtensionAPI, socket: string, file: string, maxPoll = 10): Promise<boolean> {
  for (let i = 0; i < maxPoll; i++) {
    try {
      const result = await pi.exec("nvim", [
        "--server", socket,
        "--remote-expr", 'expand("%:p")',
      ], { timeout: 3000 })

      if ((result.stdout ?? "").trim() === file) {
        return true
      }
    } catch {
      return false
    }

    await new Promise((resolve) => setTimeout(resolve, SERVER_POLL_INTERVAL))
  }

  return false
}

// ─── Spawn path (slow fallback) ─────────────────────────────

async function runNvimLua(
  pi: ExtensionAPI,
  file: string,
  luaCode: string,
  signal?: AbortSignal,
): Promise<string> {
  const scriptPath = writeLuaScript(luaCode)
  try {
    const args = [...nvimArgs(file), "-c", `luafile ${scriptPath}`]
    const result = await pi.exec("nvim", args, { timeout: NVIM_TIMEOUT, signal })
    return (result.stdout ?? "").trim()
  } finally {
    try { unlinkSync(scriptPath) } catch {}
  }
}

// ─── Server path (fast, persistent nvim) ─────────────────────

/**
 * Execute a Lua script on the persistent nvim server.
 * Pattern: write Lua to temp file → luafile via server → poll vim.g._reckoner_result
 *
 * The Lua script MUST set vim.g._reckoner_result to a JSON string when done.
 */
async function runOnServer(
  pi: ExtensionAPI,
  socket: string,
  file: string,
  luaCode: string,
  maxPoll: number = SERVER_POLL_MAX,
): Promise<string | null> {
  return withServerLock(async () => {
    const scriptPath = writeLuaScript(luaCode)
    try {
      // Shared server state (current buffer + g:_reckoner_result) means requests
      // must be serialized. Otherwise parallel calls can read each other's file/result.
      await pi.exec("nvim", [
        "--server", socket,
        "--remote-expr", `execute("let g:_reckoner_result = ''")`,
      ], { timeout: 3000 })

      await pi.exec("nvim", [
        "--server", socket,
        "--remote-expr", `execute("edit " . fnameescape('${vimSingleQuoted(file)}'))`,
      ], { timeout: 5000 })

      const ready = await waitForServerBuffer(pi, socket, file)
      if (!ready) return null

      await pi.exec("nvim", [
        "--server", socket,
        "--remote-expr", `execute("luafile " . fnameescape('${vimSingleQuoted(scriptPath)}'))`,
      ], { timeout: 5000 })

      for (let i = 0; i < maxPoll; i++) {
        await new Promise((resolve) => setTimeout(resolve, SERVER_POLL_INTERVAL))

        const result = await pi.exec("nvim", [
          "--server", socket,
          "--remote-expr", "g:_reckoner_result",
        ], { timeout: 3000 })

        const raw = (result.stdout ?? "").trim()
        if (raw && raw !== "" && raw !== "0") {
          return raw
        }
      }
      return null
    } catch {
      return null
    } finally {
      try { unlinkSync(scriptPath) } catch {}
    }
  })
}

// ─── Lua script templates ───────────────────────────────────

const LUA_DIAGNOSTICS = (waitSecs: number) => `
local attempts = 0
local timer = vim.uv.new_timer()
timer:start(1000, 1000, vim.schedule_wrap(function()
  attempts = attempts + 1
  local diags = vim.diagnostic.get(0)
  if #diags > 0 or attempts > ${waitSecs} then
    timer:stop()
    timer:close()
    local clients = vim.lsp.get_clients({ bufnr = 0 })
    local out = {}
    for _, c in ipairs(clients) do
      table.insert(out, "LSP: " .. c.name)
    end
    if #diags == 0 then
      table.insert(out, "No diagnostics found.")
    end
    for _, d in ipairs(diags) do
      local sev = ({ "ERROR", "WARN", "INFO", "HINT" })[d.severity] or "?"
      table.insert(out, string.format("[%s] L%d: %s", sev, d.lnum + 1, d.message:sub(1, 200)))
    end
    io.write(table.concat(out, "\\n"))
    vim.cmd("qa!")
  end
end))
`

const LUA_SYMBOLS = `
vim.defer_fn(function()
  local ok, parser = pcall(vim.treesitter.get_parser, 0)
  if not ok or not parser then
    print("ERROR: treesitter parser not available for this file type")
    vim.cmd("qa!")
    return
  end
  local tree = parser:parse()[1]
  local root = tree:root()
  local out = {}
  local function walk(node, depth)
    local t = node:type()
    -- Capture declaration-level nodes
    local decl_types = {
      function_declaration=true, method_definition=true, arrow_function=true,
      class_declaration=true, interface_declaration=true, type_alias_declaration=true,
      enum_declaration=true, export_statement=true, lexical_declaration=true,
      variable_declaration=true, function_definition=true, class_definition=true,
      struct_item=true, enum_item=true, impl_item=true, trait_item=true,
      func_literal=true, type_declaration=true, method_declaration=true,
    }
    if decl_types[t] or (depth == 0) then
      if depth > 0 then
        local text = vim.treesitter.get_node_text(node, 0)
        -- Clean: first line only, trim
        local first = text:match("^([^\\n]+)")
        if first then
          local row = node:start()
          local indent = string.rep("  ", math.min(depth - 1, 4))
          table.insert(out, string.format("%sL%d %s | %s", indent, row + 1, t, first:sub(1, 120):gsub("%s+", " ")))
        end
      end
      for child in node:iter_children() do
        walk(child, depth + 1)
      end
    end
  end
  walk(root, 0)
  if #out == 0 then
    print("No declarations found.")
  else
    io.write(table.concat(out, "\\n"))
  end
  vim.cmd("qa!")
end, 500)
`

const LUA_DEFINITION = (line: number, col: number) => `
local attempts = 0
local timer = vim.uv.new_timer()
timer:start(1000, 500, vim.schedule_wrap(function()
  attempts = attempts + 1
  local clients = vim.lsp.get_clients({ bufnr = 0 })
  if #clients > 0 or attempts > ${LSP_WAIT_SECS} then
    timer:stop()
    timer:close()
    if #clients == 0 then
      print("ERROR: no LSP client attached")
      vim.cmd("qa!")
      return
    end
    -- Move cursor to position
    vim.api.nvim_win_set_cursor(0, {${line}, ${col}})
    -- Request definition
    vim.lsp.buf.definition({
      on_list = function(options)
        local items = options.items or {}
        if #items == 0 then
          print("No definition found.")
        else
          for _, item in ipairs(items) do
            local fname = item.filename or "?"
            local lnum = item.lnum or 0
            local col = item.col or 0
            local text = item.text or ""
            print(string.format("%s:%d:%d | %s", fname, lnum, col, text:sub(1, 150)))
          end
        end
        vim.cmd("qa!")
      end
    })
    -- Fallback timeout
    vim.defer_fn(function()
      print("Definition request timed out.")
      vim.cmd("qa!")
    end, 5000)
  end
end))
`

const LUA_REFERENCES = (line: number, col: number) => `
local attempts = 0
local timer = vim.uv.new_timer()
timer:start(1000, 500, vim.schedule_wrap(function()
  attempts = attempts + 1
  local clients = vim.lsp.get_clients({ bufnr = 0 })
  if #clients > 0 or attempts > ${LSP_WAIT_SECS} then
    timer:stop()
    timer:close()
    if #clients == 0 then
      print("ERROR: no LSP client attached")
      vim.cmd("qa!")
      return
    end
    vim.api.nvim_win_set_cursor(0, {${line}, ${col}})
    vim.lsp.buf.references(nil, {
      on_list = function(options)
        local items = options.items or {}
        if #items == 0 then
          print("No references found.")
        else
          for _, item in ipairs(items) do
            local fname = item.filename or "?"
            local lnum = item.lnum or 0
            local text = item.text or ""
            print(string.format("%s:%d | %s", fname, lnum, text:sub(1, 150)))
          end
        end
        vim.cmd("qa!")
      end
    })
    vim.defer_fn(function()
      print("References request timed out.")
      vim.cmd("qa!")
    end, 5000)
  end
end))
`

const LUA_FORMAT = `
local attempts = 0
local timer = vim.uv.new_timer()
timer:start(1000, 500, vim.schedule_wrap(function()
  attempts = attempts + 1
  local clients = vim.lsp.get_clients({ bufnr = 0 })
  if #clients > 0 or attempts > ${LSP_WAIT_SECS} then
    timer:stop()
    timer:close()
    if #clients == 0 then
      print("ERROR: no LSP client attached")
      vim.cmd("qa!")
      return
    end
    vim.lsp.buf.format({ async = false, timeout_ms = 10000 })
    vim.cmd("write")
    print("Formatted and saved.")
    vim.cmd("qa!")
  end
end))
`

// ─── Server Lua scripts ─────────────────────────────────────
// These store results in vim.g._reckoner_result (JSON) instead of stdout.

const SERVER_LUA_DIAGNOSTICS = `
local attempts = 0
local timer = vim.uv.new_timer()
timer:start(1000, 1000, vim.schedule_wrap(function()
  attempts = attempts + 1
  local diags = vim.diagnostic.get(0)
  if #diags > 0 or attempts > 12 then
    timer:stop()
    timer:close()
    local clients = vim.lsp.get_clients({ bufnr = 0 })
    local out = {}
    for _, c in ipairs(clients) do
      table.insert(out, "LSP: " .. c.name)
    end
    if #diags == 0 then
      table.insert(out, "No diagnostics found.")
    end
    for _, d in ipairs(diags) do
      local sev = ({ "ERROR", "WARN", "INFO", "HINT" })[d.severity] or "?"
      table.insert(out, string.format("[%s] L%d: %s", sev, d.lnum + 1, d.message:sub(1, 200)))
    end
    vim.g._reckoner_result = table.concat(out, "\\n")
  end
end))
`

const SERVER_LUA_SYMBOLS = `
vim.schedule(function()
  local ok, parser = pcall(vim.treesitter.get_parser, 0)
  if not ok or not parser then
    vim.g._reckoner_result = "ERROR: treesitter parser not available for " .. vim.api.nvim_buf_get_name(0)
    return
  end
  -- Force fresh parse after buffer switch — cached trees may belong to previous buffer
  parser:invalidate()
  local tree = parser:parse()[1]
  local root = tree:root()
  local out = {}
  local function walk(node, depth)
    local t = node:type()
    local decl_types = {
      function_declaration=true, method_definition=true, arrow_function=true,
      class_declaration=true, interface_declaration=true, type_alias_declaration=true,
      enum_declaration=true, export_statement=true, lexical_declaration=true,
      variable_declaration=true, function_definition=true, class_definition=true,
      struct_item=true, enum_item=true, impl_item=true, trait_item=true,
      func_literal=true, type_declaration=true, method_declaration=true,
    }
    if decl_types[t] or (depth == 0) then
      if depth > 0 then
        local text = vim.treesitter.get_node_text(node, 0)
        local first = text:match("^([^\\n]+)")
        if first then
          local row = node:start()
          local indent = string.rep("  ", math.min(depth - 1, 4))
          table.insert(out, string.format("%sL%d %s | %s", indent, row + 1, t, first:sub(1, 120):gsub("%s+", " ")))
        end
      end
      for child in node:iter_children() do
        walk(child, depth + 1)
      end
    end
  end
  walk(root, 0)
  vim.g._reckoner_result = #out > 0 and table.concat(out, "\\n") or "No declarations found."
end)
`

function serverLuaDefinition(line: number, col: number): string {
  return `
vim.schedule(function()
  local clients = vim.lsp.get_clients({ bufnr = 0 })
  if #clients == 0 then
    vim.g._reckoner_result = "ERROR: no LSP client attached"
    return
  end
  vim.api.nvim_win_set_cursor(0, {${line}, ${col}})
  vim.lsp.buf.definition({
    on_list = function(options)
      local items = options.items or {}
      if #items == 0 then
        vim.g._reckoner_result = "No definition found."
      else
        local out = {}
        for _, item in ipairs(items) do
          table.insert(out, string.format("%s:%d:%d | %s",
            item.filename or "?", item.lnum or 0, item.col or 0, (item.text or ""):sub(1, 150)))
        end
        vim.g._reckoner_result = table.concat(out, "\\n")
      end
    end
  })
  vim.defer_fn(function()
    if not vim.g._reckoner_result or vim.g._reckoner_result == "" then
      vim.g._reckoner_result = "Definition request timed out."
    end
  end, 5000)
end)
`
}

function serverLuaReferences(line: number, col: number): string {
  return `
vim.schedule(function()
  local clients = vim.lsp.get_clients({ bufnr = 0 })
  if #clients == 0 then
    vim.g._reckoner_result = "ERROR: no LSP client attached"
    return
  end
  vim.api.nvim_win_set_cursor(0, {${line}, ${col}})
  vim.lsp.buf.references(nil, {
    on_list = function(options)
      local items = options.items or {}
      if #items == 0 then
        vim.g._reckoner_result = "No references found."
      else
        local out = {}
        for _, item in ipairs(items) do
          table.insert(out, string.format("%s:%d | %s",
            item.filename or "?", item.lnum or 0, (item.text or ""):sub(1, 150)))
        end
        vim.g._reckoner_result = table.concat(out, "\\n")
      end
    end
  })
  vim.defer_fn(function()
    if not vim.g._reckoner_result or vim.g._reckoner_result == "" then
      vim.g._reckoner_result = "References request timed out."
    end
  end, 5000)
end)
`
}

const SERVER_LUA_FORMAT = `
vim.schedule(function()
  local clients = vim.lsp.get_clients({ bufnr = 0 })
  if #clients == 0 then
    vim.g._reckoner_result = "ERROR: no LSP client attached"
    return
  end
  vim.lsp.buf.format({ async = false, timeout_ms = 10000 })
  vim.cmd("write")
  vim.g._reckoner_result = "Formatted and saved."
end)
`

// ─── Extension ──────────────────────────────────────────────

export default function nvimToolsExtension(pi: ExtensionAPI) {
  let nvimServerSocket: string | null = null

  // Listen for the persistent nvim server
  pi.events.on("reckoner:nvim-ready", (data: any) => {
    if (data?.socket) nvimServerSocket = data.socket
  })

  pi.on("session_start", async (_event, ctx) => {
    if (!existsSync(RECKONER_NVIM_INIT)) {
      if (ctx.hasUI) {
        ctx.ui.setStatus("nvim", "⚠️ nvim unavailable")
        ctx.ui.notify(
          `Reckoner nvim config not found at ${RECKONER_NVIM_INIT}.\nNvim-backed tools won't be available in this session.`,
          "warning",
        )
      }
      return
    }

    // Quick check: is nvim available?
    try {
      await pi.exec("nvim", ["--version"], { timeout: 3000 })
      if (ctx.hasUI) ctx.ui.setStatus("nvim", "✅ nvim ready")
    } catch {
      if (ctx.hasUI) ctx.ui.setStatus("nvim", "⚠️ nvim missing")
    }
  })

  // ── nvim_diagnostics ──────────────────────��───────────────

  pi.registerTool({
    name: "nvim_diagnostics",
    label: "Nvim Diagnostics",
    description:
      "Get the editor's real diagnostics for a file through neovim's LSP client. Uses the same language tooling you already rely on, not a stripped-down fallback.",
    promptSnippet: "Pull real editor diagnostics from neovim",
    promptGuidelines: [
      "Use nvim_diagnostics after edits when you need the editor's actual diagnostic picture.",
      "Prefer nvim_diagnostics over language-specific CLI checks when working across multiple stacks.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "Path to the file to check" }),
    }),
    async execute(_id, params, signal) {
      const file = resolve(params.path.replace(/^@/, ""))
      if (!existsSync(file)) throw new Error(`File not found: ${file}`)

      // Prefer persistent server (fast), fall back to spawn (slow)
      if (nvimServerSocket) {
        const result = await runOnServer(pi, nvimServerSocket, file, SERVER_LUA_DIAGNOSTICS)
        if (result !== null) {
          return {
            content: [{ type: "text" as const, text: result }],
            details: { file, via: "server" },
          }
        }
      }

      const output = await runNvimLua(pi, file, LUA_DIAGNOSTICS(LSP_WAIT_SECS), signal)
      return {
        content: [{ type: "text" as const, text: output || "No output from nvim." }],
        details: { file, via: "spawn" },
      }
    },
  })

  // ── nvim_symbols ──────────────────────────────────────────

  pi.registerTool({
    name: "nvim_symbols",
    label: "Nvim Symbols",
    description:
      "Extract the declaration surface of a file with treesitter. Fast, structural, and aligned with the editor instead of regex heuristics.",
    promptSnippet: "Map a file's symbol surface through treesitter",
    promptGuidelines: [
      "Use nvim_symbols when you need the shape of a file before making changes.",
      "Prefer nvim_symbols over reading the whole file when structure is what matters.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "Path to the file to analyze" }),
    }),
    async execute(_id, params, signal) {
      const file = resolve(params.path.replace(/^@/, ""))
      if (!existsSync(file)) throw new Error(`File not found: ${file}`)

      if (nvimServerSocket) {
        const result = await runOnServer(pi, nvimServerSocket, file, SERVER_LUA_SYMBOLS, 5)
        if (result !== null) {
          return {
            content: [{ type: "text" as const, text: result }],
            details: { file, via: "server" },
          }
        }
      }

      const output = await runNvimLua(pi, file, LUA_SYMBOLS, signal)
      return {
        content: [{ type: "text" as const, text: output || "No symbols found." }],
        details: { file, via: "spawn" },
      }
    },
  })

  // ── nvim_definition ───────────────────────────────────────

  pi.registerTool({
    name: "nvim_definition",
    label: "Nvim Go to Definition",
    description:
      "Resolve where a symbol is defined using neovim's attached LSP clients. Returns the destination file and position.",
    promptSnippet: "Resolve a symbol definition through the editor",
    parameters: Type.Object({
      path: Type.String({ description: "File containing the symbol" }),
      line: Type.Number({ description: "Line number (1-indexed)" }),
      column: Type.Number({ description: "Column number (0-indexed)" }),
    }),
    async execute(_id, params, signal) {
      const file = resolve(params.path.replace(/^@/, ""))
      if (!existsSync(file)) throw new Error(`File not found: ${file}`)

      if (nvimServerSocket) {
        const result = await runOnServer(pi, nvimServerSocket, file, serverLuaDefinition(params.line, params.column))
        if (result !== null) {
          return {
            content: [{ type: "text" as const, text: result }],
            details: { file, line: params.line, column: params.column, via: "server" },
          }
        }
      }

      const output = await runNvimLua(pi, file, LUA_DEFINITION(params.line, params.column), signal)
      return {
        content: [{ type: "text" as const, text: output || "No definition found." }],
        details: { file, line: params.line, column: params.column, via: "spawn" },
      }
    },
  })

  // ── nvim_references ───────────────────────────────────────

  pi.registerTool({
    name: "nvim_references",
    label: "Nvim Find References",
    description:
      "Find every reference to a symbol through the editor's LSP graph. Returns each file and line that participates.",
    promptSnippet: "Pull the full reference set for a symbol",
    parameters: Type.Object({
      path: Type.String({ description: "File containing the symbol" }),
      line: Type.Number({ description: "Line number (1-indexed)" }),
      column: Type.Number({ description: "Column number (0-indexed)" }),
    }),
    async execute(_id, params, signal) {
      const file = resolve(params.path.replace(/^@/, ""))
      if (!existsSync(file)) throw new Error(`File not found: ${file}`)

      if (nvimServerSocket) {
        const result = await runOnServer(pi, nvimServerSocket, file, serverLuaReferences(params.line, params.column))
        if (result !== null) {
          return {
            content: [{ type: "text" as const, text: result }],
            details: { file, line: params.line, column: params.column, via: "server" },
          }
        }
      }

      const output = await runNvimLua(pi, file, LUA_REFERENCES(params.line, params.column), signal)
      return {
        content: [{ type: "text" as const, text: output || "No references found." }],
        details: { file, line: params.line, column: params.column, via: "spawn" },
      }
    },
  })

  // ── nvim_format ───────────────────────────────────────────

  pi.registerTool({
    name: "nvim_format",
    label: "Nvim Format",
    description:
      "Format a file through neovim using the language tooling already configured in the editor.",
    promptSnippet: "Format a file through the editor stack",
    parameters: Type.Object({
      path: Type.String({ description: "Path to the file to format" }),
    }),
    async execute(_id, params, signal) {
      const file = resolve(params.path.replace(/^@/, ""))
      if (!existsSync(file)) throw new Error(`File not found: ${file}`)

      if (nvimServerSocket) {
        const result = await runOnServer(pi, nvimServerSocket, file, SERVER_LUA_FORMAT, 20)
        if (result !== null) {
          return {
            content: [{ type: "text" as const, text: result }],
            details: { file, via: "server" },
          }
        }
      }

      const output = await runNvimLua(pi, file, LUA_FORMAT, signal)
      return {
        content: [{ type: "text" as const, text: output || "Format complete." }],
        details: { file, via: "spawn" },
      }
    },
  })
}
