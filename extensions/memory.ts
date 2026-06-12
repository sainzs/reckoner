import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { Type } from "@sinclair/typebox"
import { StringEnum } from "@mariozechner/pi-ai"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

/**
 * Memory: persistent journal across sessions.
 *
 * Two-layer architecture (see genesis.md):
 *   Storage  — append-only markdown files on disk. Write liberally.
 *   Injection — curated subset in system prompt. Inject surgically.
 *
 * Listens for `reckoner:lesson` events from auto-verify and writes
 * terse entries to mistakes.md automatically. The loop closes here.
 *
 * Categories:
 *   journal    — chronological session notes
 *   codebase   — architecture, patterns, decisions
 *   mistakes   — bugs, wrong assumptions, lessons learned (auto + manual)
 *   preferences — user style, naming, conventions
 *   questions  — open unknowns to revisit
 *
 * Injection priority (highest first):
 *   mistakes > codebase > preferences > questions > journal
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

    const blocks = content.split(/^## /m).filter(b => b.trim())
    for (const block of blocks) {
      if (block.toLowerCase().includes(q)) {
        results.push(`[${cat}]\n## ${block.trim()}`)
      }
    }
  }

  return results
}

/** Extract the last N entries from a category file */
function lastEntries(dir: string, category: Category, n: number): string[] {
  const content = readFile(memFile(dir, category))
  if (!content) return []
  return content.split(/^## /m).filter(b => b.trim()).slice(-n).map(e => `## ${e.trim()}`)
}

function buildInjection(dir: string): string {
  if (!existsSync(dir)) return ""

  const parts: string[] = []
  let budget = MAX_INJECT_CHARS

  // Priority 1: Mistakes — most valuable for the loop (last 10)
  const mistakes = lastEntries(dir, "mistakes", 10)
  if (mistakes.length > 0) {
    const section = `### Lessons from past sessions\n${mistakes.join("\n\n")}`
    parts.push(section)
    budget -= section.length
  }

  // Priority 2: Codebase — architectural decisions (last 5 entries)
  if (budget > 500) {
    const codebaseEntries = lastEntries(dir, "codebase", 5)
    if (codebaseEntries.length > 0) {
      const section = `### codebase\n${codebaseEntries.join("\n\n")}`
      if (section.length <= budget) {
        parts.push(section)
        budget -= section.length
      }
    }
  }

  // Priority 3: Preferences — user style (last 5 entries)
  if (budget > 300) {
    const prefEntries = lastEntries(dir, "preferences", 5)
    if (prefEntries.length > 0) {
      const section = `### Preferences\n${prefEntries.join("\n\n")}`
      if (section.length <= budget) {
        parts.push(section)
        budget -= section.length
      }
    }
  }

  // Priority 4: Questions — open unknowns (last 5 entries)
  if (budget > 300) {
    const questionEntries = lastEntries(dir, "questions", 5)
    if (questionEntries.length > 0) {
      const section = `### Open questions\n${questionEntries.join("\n\n")}`
      if (section.length <= budget) {
        parts.push(section)
        budget -= section.length
      }
    }
  }

  // Priority 5: Journal — last 2 entries (context, not the point)
  if (budget > 400) {
    const journal = lastEntries(dir, "journal", 2)
    if (journal.length > 0) {
      const section = `### Recent journal\n${journal.join("\n\n")}`
      if (section.length <= budget) {
        parts.push(section)
        budget -= section.length
      }
    }
  }

  if (parts.length === 0) return ""

  const full = `\n\n---\n## Reckoner memory\n\n${parts.join("\n\n")}\n---`

  // Hard trim — should rarely hit this given budget tracking above
  if (full.length <= MAX_INJECT_CHARS) return full
  const TRUNCATION_SUFFIX = "\n\n[memory truncated]\n---"
  return full.slice(0, MAX_INJECT_CHARS - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX
}

export default function memoryExtension(pi: ExtensionAPI) {
  let dir: string | null = null

  pi.on("session_start", async (_event, ctx) => {
    dir = memDir(ctx.cwd)
    if (ctx.hasUI) {
      ctx.ui.setStatus("memory", existsSync(dir) ? "memory on" : "memory ready")
    }
  })

  // Listen for lessons from auto-verify — the loop closes here
  pi.events.on("reckoner:lesson", (data: any) => {
    if (!dir) return
    const { errorKind, files, summary, fixed } = data
    const outcome = fixed ? "fixed" : "unresolved"
    const note = `[auto-verify] ${errorKind} error in ${files} — ${summary} (${outcome})`

    const recentMistakes = lastEntries(dir, "mistakes", 5)
    if (recentMistakes.some((entry) => entry.includes(note))) return

    appendNote(dir, "mistakes", note)
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
      category: StringEnum([...CATEGORIES] as const, {
        description:
          "journal=session notes, codebase=architecture/patterns, mistakes=bugs/lessons, preferences=user style, questions=open unknowns",
      }),
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
