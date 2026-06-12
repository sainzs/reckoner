import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { Type } from "@sinclair/typebox"
import { StringEnum } from "@mariozechner/pi-ai"

/**
 * ast-grep: structural code search and rewrite via tree-sitter AST patterns.
 *
 * One tool: sg_search (with optional rewrite param for preview).
 * Fewer tools, simpler schemas — Factory's finding that "complex tool schemas
 * exponentially increase error rates" applies here.
 *
 * Requires `ast-grep` (sg) on PATH. Install: brew install ast-grep
 */

const LANGUAGES = [
  "typescript", "tsx", "javascript", "python", "go", "rust",
  "c", "cpp", "java", "lua", "ruby", "swift", "kotlin",
  "json", "yaml", "html", "css", "bash",
] as const

const MAX_OUTPUT = 50_000

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max) + "\n\n[output truncated]"
}

export default function astGrepExtension(pi: ExtensionAPI) {
  let available = false

  pi.on("session_start", async (_event, ctx) => {
    try {
      const result = await pi.exec("ast-grep", ["--version"], { timeout: 3000 })
      available = (result.stdout ?? "").includes("ast-grep")
      if (ctx.hasUI) {
        ctx.ui.setStatus("sg", available ? "SG READY" : "SG MISSING")
      }
    } catch {
      available = false
      if (ctx.hasUI) ctx.ui.setStatus("sg", "SG MISSING")
    }
  })

  pi.registerTool({
    name: "sg_search",
    label: "AST Search",
    description:
      "Search code using AST patterns via ast-grep. Matches on syntax structure, not text.\n" +
      "Pattern syntax:\n" +
      "  $NAME  — matches any single AST node (identifier, expression, type, etc.)\n" +
      "  $$$    — matches zero or more nodes (function bodies, argument lists, etc.)\n" +
      "\n" +
      "Examples:\n" +
      "  'function $NAME($$$)' — find all function declarations\n" +
      "  'if ($COND) { $$$BODY }' — find all if-blocks\n" +
      "  'import $$$FROM from \"$MOD\"' — find all imports\n" +
      "  '$OBJ.on(\"$EVENT\", $$$)' — find event listeners\n" +
      "  'async function $NAME($$$) { $$$BODY }' — find async functions\n" +
      "  'const $NAME: $TYPE = $VAL' — find typed const declarations\n" +
      "\n" +
      "If rewrite is provided, shows a preview diff without applying. Use edit to apply.",
    promptSnippet: "Search code by AST pattern (structural, not text)",
    promptGuidelines: [],
    parameters: Type.Object({
      pattern: Type.String({
        description: "AST pattern to search for. Use $NAME for single nodes, $$$ for variadic.",
      }),
      rewrite: Type.Optional(Type.String({
        description: "Replacement pattern using captured metavariables. Shows preview diff without applying.",
      })),
      lang: Type.Optional(Type.String({
        description: "Language (e.g. typescript, python). Auto-detected if omitted.",
      })),
      path: Type.Optional(Type.String({
        description: "Path to search in. Defaults to current directory.",
      })),
    }),
    async execute(_id, params, signal) {
      if (!available) {
        return {
          content: [{ type: "text" as const, text: "ast-grep not found. Install: brew install ast-grep" }],
        }
      }

      const args = ["run", "-p", params.pattern]
      if (params.rewrite) args.push("-r", params.rewrite)
      if (params.lang) args.push("-l", params.lang)
      if (params.path) args.push(params.path)

      try {
        const result = await pi.exec("ast-grep", args, { timeout: 15_000, signal })
        const output = (result.stdout ?? "").trim()
        if (!output) {
          return {
            content: [{ type: "text" as const, text: params.rewrite ? "No matches found for rewrite." : "No matches found." }],
            details: { pattern: params.pattern, matches: 0 },
          }
        }

        const matchCount = output.split(/\n/).filter(l => l.match(/^[a-zA-Z._\/]/)).length
        const prefix = params.rewrite ? "Preview (not applied):\n\n" : ""

        return {
          content: [{ type: "text" as const, text: `${prefix}${truncate(output, MAX_OUTPUT)}` }],
          details: { pattern: params.pattern, rewrite: params.rewrite, matches: matchCount },
        }
      } catch (e: any) {
        const stderr = e?.stderr ?? ""
        return {
          content: [{ type: "text" as const, text: stderr || "ast-grep failed." }],
        }
      }
    },
  })

  pi.registerCommand("sg", {
    description: "Quick ast-grep search: /sg <pattern> [lang]",
    handler: async (args, ctx) => {
      if (!available) {
        ctx.ui.notify("ast-grep not found. Install: brew install ast-grep", "error")
        return
      }

      const parts = args.trim().split(/\s+/)
      if (parts.length === 0 || !parts[0]) {
        ctx.ui.notify("Usage: /sg <pattern> [lang]\nExample: /sg 'function $NAME($$$)' typescript", "info")
        return
      }

      const lastPart = parts[parts.length - 1]
      const isLang = (LANGUAGES as readonly string[]).includes(lastPart)
      const lang = isLang ? parts.pop() : undefined
      const pattern = parts.join(" ")

      const sgArgs = ["run", "-p", pattern]
      if (lang) sgArgs.push("-l", lang)

      try {
        const result = await pi.exec("ast-grep", sgArgs, { timeout: 10_000 })
        const output = (result.stdout ?? "").trim()
        ctx.ui.notify(output || "No matches.", "info")
      } catch {
        ctx.ui.notify("ast-grep search failed.", "error")
      }
    },
  })
}
