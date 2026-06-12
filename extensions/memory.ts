import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { Type } from "@sinclair/typebox"
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { homedir } from "node:os"

/**
 * Memory: persistent journal across sessions.
 *
 * Stores notes as markdown files in .pi/memory/ (project) or
 * ~/.pi/agent/memory/ (global). Injects recent memories before
 * each agent run so the agent carries context forward.
 *
 * Categories:
 *   journal    — chronological session notes
 *   codebase   — architecture, patterns, decisions
 *   mistakes   — bugs, wrong assumptions, lessons learned
 *   preferences — user style, naming, conventions
 *   questions  — open unknowns to revisit
 *
 * Tools:
 *   remember(category, note) — write a note
 *   recall(query)            — search notes by keyword
 */

const CATEGORIES = ["journal", "codebase", "mistakes", "preferences", "questions"] as const
type Category = (typeof CATEGORIES)[number]
const MAX_INJECT_CHARS = 3000

function memDir(cwd: string): string {
  const local = join(cwd, ".pi", "memory")
  return existsSync(local) || existsSync(join(cwd, ".pi")) ? local : join(homedir(), ".pi", "agent", "memory")
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function memFile(dir: string, category: Category): string {
  return join(dir, `${category}.md`)
}

function appendNote(dir: string, category: Category, note: string) {
  ensureDir(dir)
  const path = memFile(dir, category)
  const timestamp = new Date().toISOString().slice(0, 16).replace("T", " ")
  const entry = `\n## ${timestamp}\n${note.trim()}\n`
  writeFileSync(path, (existsSync(path) ? readFileSync(path, "utf8") : "") + entry, "utf8")
}

function readFile(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : ""
}

function searchNotes(dir: string, query: string): string[] {
  if (!existsSync(dir)) return []
  const q = query.toLowerCase()
  const results: string[] = []

  for (const cat of CATEGORIES) {
    const content = readFile(memFile(dir, cat))
    if (!content) continue

    const blocks = content.split(/^## /m).filter(Boolean)
    for (const block of blocks) {
      if (block.toLowerCase().includes(q)) {
        results.push(`[${cat}]\n## ${block.trim()}`)
      }
    }
  }

  return results
}

function buildInjection(dir: string): string {
  if (!existsSync(dir)) return ""

  const parts: string[] = []

  // Always include last few journal entries
  const journal = readFile(memFile(dir, "journal"))
  if (journal) {
    const entries = journal.split(/^## /m).filter(Boolean)
    const recent = entries.slice(-4).map((e) => `## ${e.trim()}`)
    if (recent.length > 0) {
      parts.push(`### Recent journal\n${recent.join("\n\n")}`)
    }
  }

  // Include non-journal categories if they exist and have content
  for (const cat of CATEGORIES.filter((c) => c !== "journal")) {
    const content = readFile(memFile(dir, cat))
    if (content && content.trim().length > 50) {
      parts.push(`### ${cat}\n${content.trim()}`)
    }
  }

  if (parts.length === 0) return ""

  const full = `\n\n---\n## Reckoner memory\n\n${parts.join("\n\n")}\n---`

  // Trim to budget
  if (full.length <= MAX_INJECT_CHARS) return full
  return full.slice(0, MAX_INJECT_CHARS) + "\n\n[memory truncated]\n---"
}

export default function memoryExtension(pi: ExtensionAPI) {
  let dir: string | null = null

  pi.on("session_start", async (_event, ctx) => {
    dir = memDir(ctx.cwd)
    if (ctx.hasUI) {
      ctx.ui.setStatus("memory", existsSync(dir) ? "memory on" : "memory ready")
    }
  })

  pi.on("before_agent_start", async (event, _ctx) => {
    if (!dir) return
    const injection = buildInjection(dir)
    if (!injection) return
    return { systemPrompt: `${event.systemPrompt}${injection}` }
  })

  pi.registerTool({
    name: "remember",
    label: "Remember",
    description:
      "Save a note to persistent memory. Use this to capture important learnings, decisions, patterns, mistakes, or open questions that should survive across sessions.",
    promptSnippet: "Save important information to memory for future sessions",
    promptGuidelines: [
      "Use remember() to save: codebase architecture decisions, recurring patterns, bugs you fixed and why, user preferences, and open questions.",
      "Call remember() at the end of significant work, before the session ends.",
      "Be specific — vague notes are useless in future sessions.",
    ],
    parameters: Type.Object({
      category: Type.Union(
        CATEGORIES.map((c) => Type.Literal(c)),
        {
          description:
            "journal=session notes, codebase=architecture/patterns, mistakes=bugs/lessons, preferences=user style, questions=open unknowns",
        },
      ),
      note: Type.String({ description: "The note to save. Be specific and concrete." }),
    }),
    async execute(_toolCallId, params) {
      if (!dir) throw new Error("Memory not initialized — session_start hasn't fired")
      appendNote(dir, params.category as Category, params.note)
      return {
        content: [{ type: "text" as const, text: `Saved to ${params.category}.` }],
        details: { category: params.category, dir },
      }
    },
  })

  pi.registerTool({
    name: "recall",
    label: "Recall",
    description: "Search memory for notes matching a keyword or topic. Returns matching entries across all categories.",
    promptSnippet: "Search memory for past notes, decisions, or lessons",
    promptGuidelines: [
      "Use recall() when starting work on something you might have encountered before.",
      "Use recall() to find past architectural decisions before making new ones.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Keyword or phrase to search for" }),
    }),
    async execute(_toolCallId, params) {
      if (!dir) throw new Error("Memory not initialized")
      const results = searchNotes(dir, params.query)
      const text =
        results.length > 0
          ? `Found ${results.length} match(es) for "${params.query}":\n\n${results.join("\n\n---\n\n")}`
          : `No memory found for "${params.query}".`
      return {
        content: [{ type: "text" as const, text }],
        details: { query: params.query, matches: results.length },
      }
    },
  })

  pi.registerCommand("memory", {
    description: "Show memory status or list recent notes",
    handler: async (args, ctx) => {
      const currentDir = dir ?? memDir(ctx.cwd)
      const mode = args.trim().toLowerCase()

      if (mode === "clear") {
        ctx.ui.notify("Use /memory clear <category> to clear a specific category.", "warning")
        return
      }

      if (!existsSync(currentDir)) {
        ctx.ui.notify(`No memory yet. Memory will be stored in: ${currentDir}`, "info")
        return
      }

      const lines: string[] = [`Memory directory: ${currentDir}`, ""]
      for (const cat of CATEGORIES) {
        const content = readFile(memFile(currentDir, cat))
        const count = content ? content.split(/^## /m).filter(Boolean).length : 0
        lines.push(`  ${cat}: ${count} note(s)`)
      }

      ctx.ui.notify(lines.join("\n"), "info")
    },
  })
}
