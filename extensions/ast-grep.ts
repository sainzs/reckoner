import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { Type } from "@sinclair/typebox"
import { StringEnum } from "@mariozechner/pi-ai"

/**
 * ast-grep: structural code search and rewrite via tree-sitter AST patterns.
 *
 * Unlike text-based grep, ast-grep matches on syntax structure:
 *   - `function $NAME($$$)` matches any function declaration
 *   - `if ($COND) { $$$BODY }` matches any if-block
 *   - `$OBJ.on("$EVENT", $$$)` matches any event listener
 *
 * Metavariables:
 *   $NAME  — matches a single AST node (identifier, expression, etc.)
 *   $$$    — matches zero or more nodes (variadic, like function body)
 *
 * Three tools:
 *   sg_search  — find code matching an AST pattern
 *   sg_rewrite — find and replace using AST patterns (preview mode)
 *
 * Requires `ast-grep` (sg) on PATH. Install: brew install ast-grep
 */

const LANGUAGES = [
  "typescript", "tsx", "javascript", "python", "go", "rust",
  "c", "cpp", "java", "lua", "ruby", "swift", "kotlin",
  "json", "yaml", "html", "css", "bash",
] as const

const MAX_OUTPUT = 50_000 // bytes

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
        ctx.ui.setStatus("sg", available ? "sg ✓" : "sg: not found")
      }
    } catch {
      available = false
      if (ctx.hasUI) ctx.ui.setStatus("sg", "sg: not found")
    }
  })

  // ── sg_search ─────────────────────────────────────────────

  pi.registerTool({
    name: "sg_search",
    label: "AST Search",
    description: [
      "Search code using AST patterns via ast-grep. Matches on syntax structure, not text.",
      "",
      "Pattern syntax:",
      "  $NAME  — matches any single AST node (identifier, expression, type, etc.)",
      "  $$$    — matches zero or more nodes (function bodies, argument lists, etc.)",
      "",
      "Examples:",
      "  'function $NAME($$$)' — find all function declarations",
      "  'if ($COND) { $$$BODY }' — find all if-blocks",
      "  'import $$$FROM from \"$MOD\"' — find all imports",
      "  '$OBJ.on(\"$EVENT\", $$$)' — find event listeners",
      "  'async function $NAME($$$) { $$$BODY }' — find async functions",
      "  'const $NAME: $TYPE = $VAL' — find typed const declarations",
    ].join("\n"),
    promptSnippet: "Search code by AST pattern (structural, not text)",
    promptGuidelines: [
      "Use sg_search for structural code queries — finding patterns, not specific strings.",
      "Prefer sg_search over grep/rg when you need to match code structure (e.g. all functions with a specific shape).",
      "Use $NAME for single nodes, $$$ for variadic matches (bodies, args).",
    ],
    parameters: Type.Object({
      pattern: Type.String({
        description: "AST pattern to search for. Use $NAME for single nodes, $$$ for variadic.",
      }),
      lang: Type.Optional(StringEnum([...LANGUAGES], {
        description: "Language of the pattern. Auto-detected from file extensions if omitted.",
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
      if (params.lang) args.push("-l", params.lang)
      if (params.path) args.push(params.path)

      try {
        const result = await pi.exec("ast-grep", args, { timeout: 15_000, signal })
        const output = (result.stdout ?? "").trim()
        if (!output) {
          return {
            content: [{ type: "text" as const, text: "No matches found." }],
            details: { pattern: params.pattern, matches: 0 },
          }
        }

        // Count matches (each result starts with a file path)
        const matchCount = output.split(/\n/).filter(l => l.match(/^[a-zA-Z._\/]/)).length

        return {
          content: [{ type: "text" as const, text: truncate(output, MAX_OUTPUT) }],
          details: { pattern: params.pattern, matches: matchCount },
        }
      } catch (e: any) {
        const stderr = e?.stderr ?? ""
        return {
          content: [{ type: "text" as const, text: stderr || "ast-grep search failed." }],
        }
      }
    },
  })

  // ── sg_rewrite ────────────────────────────────────────────

  pi.registerTool({
    name: "sg_rewrite",
    label: "AST Rewrite",
    description: [
      "Preview a structural code rewrite using ast-grep. Shows the diff without applying.",
      "",
      "Pattern syntax (same as sg_search):",
      "  $NAME  — matches any single AST node",
      "  $$$    — matches zero or more nodes",
      "",
      "The rewrite string uses the same metavariables captured by the pattern.",
      "",
      "Examples:",
      "  pattern: 'console.log($MSG)'",
      "  rewrite: 'logger.info($MSG)'",
      "",
      "  pattern: 'var $NAME = $VAL'",
      "  rewrite: 'const $NAME = $VAL'",
      "",
      "This shows a preview diff. Use the edit tool to apply changes.",
    ].join("\n"),
    promptSnippet: "Preview structural code rewrite via AST patterns",
    promptGuidelines: [
      "Use sg_rewrite to preview refactoring across files — it shows diffs without applying.",
      "After reviewing the diff, use the edit tool to apply the specific changes you want.",
      "Metavariables ($NAME, $VAL, etc.) captured in the pattern are available in the rewrite string.",
    ],
    parameters: Type.Object({
      pattern: Type.String({
        description: "AST pattern to match.",
      }),
      rewrite: Type.String({
        description: "Replacement pattern using captured metavariables from the match pattern.",
      }),
      lang: Type.Optional(StringEnum([...LANGUAGES], {
        description: "Language of the pattern.",
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

      const args = ["run", "-p", params.pattern, "-r", params.rewrite]
      if (params.lang) args.push("-l", params.lang)
      if (params.path) args.push(params.path)

      try {
        const result = await pi.exec("ast-grep", args, { timeout: 15_000, signal })
        const output = (result.stdout ?? "").trim()
        if (!output) {
          return {
            content: [{ type: "text" as const, text: "No matches found for rewrite." }],
            details: { pattern: params.pattern, matches: 0 },
          }
        }

        return {
          content: [{
            type: "text" as const,
            text: `Preview (not applied):\n\n${truncate(output, MAX_OUTPUT)}`,
          }],
          details: { pattern: params.pattern, rewrite: params.rewrite },
        }
      } catch (e: any) {
        const stderr = e?.stderr ?? ""
        return {
          content: [{ type: "text" as const, text: stderr || "ast-grep rewrite failed." }],
        }
      }
    },
  })

  // ── /sg command ───────────────────────────────────────────

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

      // Last part might be a language
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
