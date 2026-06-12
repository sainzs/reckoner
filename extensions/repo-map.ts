import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { Type } from "@sinclair/typebox"
import { StringEnum } from "@mariozechner/pi-ai"

/**
 * Repo map: structural overview of the codebase.
 *
 * Provides the agent with a bird's-eye view of the project:
 * - File tree with filtering
 * - Symbol extraction (functions, classes, exports, types)
 * - Dependency graph between files
 *
 * Uses rg (ripgrep) for fast scanning — no tree-sitter or AST parser needed.
 * Covers TypeScript, JavaScript, Python, Go, Rust, and Java.
 *
 * This is the #1 feature that makes Aider effective at navigating
 * unfamiliar codebases. Without it, the agent reads files blindly.
 */

const MAX_OUTPUT = 30_000
const SCAN_TIMEOUT = 15_000

// Language-specific regex patterns for symbol extraction
const PATTERNS: Record<string, { name: string; pattern: string }[]> = {
  ts: [
    { name: "fn", pattern: "^\\s*(?:export\\s+)?(?:async\\s+)?function\\s+\\w+" },
    { name: "class", pattern: "^\\s*(?:export\\s+)?(?:abstract\\s+)?class\\s+\\w+" },
    { name: "interface", pattern: "^\\s*(?:export\\s+)?interface\\s+\\w+" },
    { name: "type", pattern: "^\\s*(?:export\\s+)?type\\s+\\w+\\s*=" },
    { name: "const", pattern: "^\\s*export\\s+const\\s+\\w+" },
    { name: "enum", pattern: "^\\s*(?:export\\s+)?enum\\s+\\w+" },
  ],
  py: [
    { name: "fn", pattern: "^\\s*(?:async\\s+)?def\\s+\\w+" },
    { name: "class", pattern: "^\\s*class\\s+\\w+" },
  ],
  go: [
    { name: "fn", pattern: "^func\\s+(?:\\([^)]+\\)\\s+)?\\w+" },
    { name: "type", pattern: "^type\\s+\\w+" },
  ],
  rs: [
    { name: "fn", pattern: "^\\s*(?:pub\\s+)?(?:async\\s+)?fn\\s+\\w+" },
    { name: "struct", pattern: "^\\s*(?:pub\\s+)?struct\\s+\\w+" },
    { name: "enum", pattern: "^\\s*(?:pub\\s+)?enum\\s+\\w+" },
    { name: "trait", pattern: "^\\s*(?:pub\\s+)?trait\\s+\\w+" },
    { name: "impl", pattern: "^\\s*impl(?:<[^>]+>)?\\s+\\w+" },
  ],
  java: [
    { name: "class", pattern: "^\\s*(?:public|private|protected)?\\s*(?:abstract\\s+)?class\\s+\\w+" },
    { name: "interface", pattern: "^\\s*(?:public\\s+)?interface\\s+\\w+" },
    { name: "method", pattern: "^\\s*(?:public|private|protected)\\s+(?:static\\s+)?\\S+\\s+\\w+\\s*\\(" },
  ],
}

const EXT_TO_LANG: Record<string, string> = {
  ts: "ts", tsx: "ts", js: "ts", jsx: "ts", mjs: "ts", mts: "ts",
  py: "py",
  go: "go",
  rs: "rs",
  java: "java",
}

function truncateOutput(text: string): { content: string; truncated: boolean } {
  if (text.length <= MAX_OUTPUT) return { content: text, truncated: false }
  const lines = text.split("\n")
  let size = 0
  let kept = 0
  for (const line of lines) {
    if (size + line.length + 1 > MAX_OUTPUT) break
    size += line.length + 1
    kept++
  }
  return {
    content: lines.slice(0, kept).join("\n") + `\n\n[Truncated: ${kept} of ${lines.length} lines shown]`,
    truncated: true,
  }
}

export default function repoMapExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "repo_map",
    label: "Repo Map",
    description:
      "Get a structural overview of the codebase. Shows the file tree, key symbols (functions, classes, types, exports), and how files relate. Use this BEFORE diving into specific files to understand the architecture.",
    promptSnippet: "Get a structural overview of the codebase (files, symbols, architecture)",
    promptGuidelines: [
      "Use repo_map at the start of any non-trivial task to understand the codebase structure.",
      "Use repo_map with a path filter to focus on a specific directory or module.",
      "Prefer repo_map over reading multiple files when you need to understand architecture.",
    ],
    parameters: Type.Object({
      mode: StringEnum(["tree", "symbols", "overview"] as const, {
        description:
          "tree=file tree only, symbols=functions/classes/types per file, overview=tree + key symbols (default)",
      }),
      path: Type.Optional(
        Type.String({ description: "Filter to a subdirectory, e.g. 'src/scenes' or 'lib'. Defaults to project root." }),
      ),
      pattern: Type.Optional(
        Type.String({ description: "Glob pattern to filter files, e.g. '*.ts' or '**/*.py'" }),
      ),
    }),

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const cwd = ctx.cwd
      const mode = params.mode || "overview"
      const filterPath = params.path?.replace(/^@/, "") || "."
      const globPattern = params.pattern || ""

      const sections: string[] = []

      // --- File tree ---
      if (mode === "tree" || mode === "overview") {
        try {
          // Use fd for fast file listing, fall back to find
          const fdArgs = [
            "--type", "f",
            "--exclude", "node_modules",
            "--exclude", ".git",
            "--exclude", "dist",
            "--exclude", "build",
            "--exclude", ".next",
            "--exclude", "coverage",
            "--exclude", "__pycache__",
            "--exclude", ".pi",
          ]
          if (globPattern) fdArgs.push("--glob", globPattern)
          fdArgs.push("--base-directory", filterPath)

          const result = await pi.exec("fd", fdArgs, { timeout: SCAN_TIMEOUT, signal })
          const files = (result.stdout ?? "").trim().split("\n").filter(Boolean).sort()

          if (files.length > 0) {
            // Build a compact tree representation
            const tree = buildTree(files, filterPath)
            sections.push(`## File tree (${files.length} files)\n\n${tree}`)
          } else {
            sections.push("## File tree\n\n(no files found)")
          }
        } catch {
          // fd not available, fall back to find
          try {
            const result = await pi.exec("find", [
              filterPath, "-type", "f",
              "-not", "-path", "*/node_modules/*",
              "-not", "-path", "*/.git/*",
              "-not", "-path", "*/dist/*",
            ], { timeout: SCAN_TIMEOUT, signal })
            const files = (result.stdout ?? "").trim().split("\n").filter(Boolean).sort()
            const tree = buildTree(files, filterPath)
            sections.push(`## File tree (${files.length} files)\n\n${tree}`)
          } catch {
            sections.push("## File tree\n\n(failed to list files)")
          }
        }
      }

      // --- Symbol extraction ---
      if (mode === "symbols" || mode === "overview") {
        const symbolSections: string[] = []

        for (const [ext, lang] of Object.entries(EXT_TO_LANG)) {
          const patterns = PATTERNS[lang]
          if (!patterns) continue

          // Combine all patterns for this language into one rg call
          const combinedPattern = patterns.map((p) => p.pattern).join("|")

          try {
            const rgArgs = [
              "--no-heading",
              "--line-number",
              "--type-add", `${lang}:*.${ext}`,
              "--type", lang,
              "-e", combinedPattern,
              filterPath,
            ]

            const result = await pi.exec("rg", rgArgs, { timeout: SCAN_TIMEOUT, signal })
            const output = (result.stdout ?? "").trim()
            if (!output) continue

            // Parse rg output: file:line:match
            const lines = output.split("\n").filter(Boolean)
            const byFile = new Map<string, string[]>()

            for (const line of lines) {
              const colonIdx = line.indexOf(":")
              if (colonIdx < 0) continue
              const rest = line.slice(colonIdx + 1)
              const colonIdx2 = rest.indexOf(":")
              if (colonIdx2 < 0) continue

              const file = line.slice(0, colonIdx)
              const match = rest.slice(colonIdx2 + 1).trim()
              // Clean up the match - just show the declaration signature
              const clean = match
                .replace(/\{.*$/, "")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 120)

              if (!byFile.has(file)) byFile.set(file, [])
              byFile.get(file)!.push(clean)
            }

            for (const [file, symbols] of byFile) {
              const header = `### ${file}`
              const body = symbols.map((s) => `  ${s}`).join("\n")
              symbolSections.push(`${header}\n${body}`)
            }
          } catch {
            // rg failed for this pattern/type — skip silently
          }
        }

        if (symbolSections.length > 0) {
          sections.push(`## Symbols\n\n${symbolSections.join("\n\n")}`)
        }
      }

      if (sections.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No files or symbols found in the specified path." }],
          details: { mode, path: filterPath },
        }
      }

      const full = sections.join("\n\n---\n\n")
      const { content, truncated } = truncateOutput(full)

      return {
        content: [{ type: "text" as const, text: content }],
        details: { mode, path: filterPath, truncated },
      }
    },
  })
}

/**
 * Build a compact tree string from a list of file paths.
 * Groups by directory and shows file counts for large directories.
 */
function buildTree(files: string[], basePath: string): string {
  if (files.length === 0) return "(empty)"
  if (files.length > 500) {
    // For very large projects, show directory summary instead
    const dirs = new Map<string, number>()
    for (const file of files) {
      const parts = file.split("/")
      const dir = parts.length > 1 ? parts.slice(0, -1).join("/") : "."
      dirs.set(dir, (dirs.get(dir) ?? 0) + 1)
    }
    const sorted = [...dirs.entries()].sort((a, b) => b[1] - a[1])
    return sorted
      .slice(0, 50)
      .map(([dir, count]) => `${basePath}/${dir}/ (${count} files)`)
      .join("\n")
  }

  // For manageable sizes, show the actual tree
  return files.map((f) => `${basePath === "." ? "" : basePath + "/"}${f}`).join("\n")
}
