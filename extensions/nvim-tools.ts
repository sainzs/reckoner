import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { Type } from "@sinclair/typebox"
import { StringEnum } from "@mariozechner/pi-ai"
import { resolve, relative } from "node:path"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { writeFileSync, mkdtempSync, unlinkSync } from "node:fs"

/**
 * Nvim tools: neovim headless as a native code intelligence backend.
 *
 * Uses the user's actual nvim + treesitter + LSP for:
 *   - Real diagnostics for ANY language (not just tsc)
 *   - AST-aware symbol extraction via treesitter
 *   - Go-to-definition via LSP
 *   - Find references via LSP
 *   - Format files via LSP
 *
 * Requires:
 *   - nvim 0.10+ with treesitter parsers installed
 *   - Language servers on PATH (ts_ls, pyright, gopls, etc.)
 *   - Reckoner nvim config at ~/Code/reckoner/nvim/init.lua
 */

const RECKONER_NVIM_INIT = resolve(process.env.HOME ?? "~", "Code/reckoner/nvim/init.lua")
const NVIM_TIMEOUT = 25_000
const LSP_WAIT_SECS = 15

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

// ─── Extension ──────────────────────────────────────────────

export default function nvimToolsExtension(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (!existsSync(RECKONER_NVIM_INIT)) {
      if (ctx.hasUI) {
        ctx.ui.setStatus("nvim", "nvim: no config")
        ctx.ui.notify(
          `Reckoner nvim config not found at ${RECKONER_NVIM_INIT}.\nNvim tools will be unavailable.`,
          "warning",
        )
      }
      return
    }

    // Quick check: is nvim available?
    try {
      await pi.exec("nvim", ["--version"], { timeout: 3000 })
      if (ctx.hasUI) ctx.ui.setStatus("nvim", "nvim ✓")
    } catch {
      if (ctx.hasUI) ctx.ui.setStatus("nvim", "nvim: not found")
    }
  })

  // ── nvim_diagnostics ──────────────────────��───────────────

  pi.registerTool({
    name: "nvim_diagnostics",
    label: "Nvim Diagnostics",
    description:
      "Get LSP diagnostics for a file using neovim's built-in LSP client. Works for ANY language with a configured language server (TypeScript, Python, Go, Rust, etc.). More comprehensive than just running tsc.",
    promptSnippet: "Get real LSP diagnostics for any file via neovim",
    promptGuidelines: [
      "Use nvim_diagnostics after editing files to check for errors beyond just TypeScript.",
      "Prefer nvim_diagnostics over running tsc when working with non-TypeScript files.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "Path to the file to check" }),
    }),
    async execute(_id, params, signal) {
      const file = resolve(params.path.replace(/^@/, ""))
      if (!existsSync(file)) throw new Error(`File not found: ${file}`)

      const output = await runNvimLua(pi, file, LUA_DIAGNOSTICS(LSP_WAIT_SECS), signal)
      return {
        content: [{ type: "text" as const, text: output || "No output from nvim." }],
        details: { file },
      }
    },
  })

  // ── nvim_symbols ──────────────────────────────────────────

  pi.registerTool({
    name: "nvim_symbols",
    label: "Nvim Symbols",
    description:
      "Extract all declarations (functions, classes, types, interfaces, variables) from a file using treesitter AST parsing. Faster and more accurate than regex-based approaches.",
    promptSnippet: "Get AST-accurate symbols from a file via treesitter",
    promptGuidelines: [
      "Use nvim_symbols to understand a file's structure before editing it.",
      "Prefer nvim_symbols over reading the entire file when you just need the API surface.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "Path to the file to analyze" }),
    }),
    async execute(_id, params, signal) {
      const file = resolve(params.path.replace(/^@/, ""))
      if (!existsSync(file)) throw new Error(`File not found: ${file}`)

      const output = await runNvimLua(pi, file, LUA_SYMBOLS, signal)
      return {
        content: [{ type: "text" as const, text: output || "No symbols found." }],
        details: { file },
      }
    },
  })

  // ── nvim_definition ───────────────────────────────────────

  pi.registerTool({
    name: "nvim_definition",
    label: "Nvim Go to Definition",
    description:
      "Go to the definition of a symbol at a specific location using LSP. Returns the file and line where the symbol is defined.",
    promptSnippet: "Find where a symbol is defined via LSP",
    parameters: Type.Object({
      path: Type.String({ description: "File containing the symbol" }),
      line: Type.Number({ description: "Line number (1-indexed)" }),
      column: Type.Number({ description: "Column number (0-indexed)" }),
    }),
    async execute(_id, params, signal) {
      const file = resolve(params.path.replace(/^@/, ""))
      if (!existsSync(file)) throw new Error(`File not found: ${file}`)

      const output = await runNvimLua(pi, file, LUA_DEFINITION(params.line, params.column), signal)
      return {
        content: [{ type: "text" as const, text: output || "No definition found." }],
        details: { file, line: params.line, column: params.column },
      }
    },
  })

  // ── nvim_references ───────────────────────────────────────

  pi.registerTool({
    name: "nvim_references",
    label: "Nvim Find References",
    description:
      "Find all references to a symbol at a specific location using LSP. Returns every file and line that references the symbol.",
    promptSnippet: "Find all references to a symbol via LSP",
    parameters: Type.Object({
      path: Type.String({ description: "File containing the symbol" }),
      line: Type.Number({ description: "Line number (1-indexed)" }),
      column: Type.Number({ description: "Column number (0-indexed)" }),
    }),
    async execute(_id, params, signal) {
      const file = resolve(params.path.replace(/^@/, ""))
      if (!existsSync(file)) throw new Error(`File not found: ${file}`)

      const output = await runNvimLua(pi, file, LUA_REFERENCES(params.line, params.column), signal)
      return {
        content: [{ type: "text" as const, text: output || "No references found." }],
        details: { file, line: params.line, column: params.column },
      }
    },
  })

  // ── nvim_format ───────────────────────────────────────────

  pi.registerTool({
    name: "nvim_format",
    label: "Nvim Format",
    description:
      "Format a file using nvim's LSP formatting. Uses whatever formatter the language server provides.",
    promptSnippet: "Format a file using LSP via neovim",
    parameters: Type.Object({
      path: Type.String({ description: "Path to the file to format" }),
    }),
    async execute(_id, params, signal) {
      const file = resolve(params.path.replace(/^@/, ""))
      if (!existsSync(file)) throw new Error(`File not found: ${file}`)

      const output = await runNvimLua(pi, file, LUA_FORMAT, signal)
      return {
        content: [{ type: "text" as const, text: output || "Format complete." }],
        details: { file },
      }
    },
  })
}
