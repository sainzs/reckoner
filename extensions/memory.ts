import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { Type } from "@sinclair/typebox"
import { StringEnum } from "@mariozechner/pi-ai"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { MEMORY_CATEGORIES, type InjectionBuildContext, type LessonMatch, type LessonRecord, type MemoryCategory, type MemorySelectionPayload, type MemorySummary, type PromotionCandidate } from "./lib/lesson-types.js"
import { fingerprintLesson } from "./lib/memory-format.js"
import { parseLessonFile, scoreLessonRecord, serializeLessonRecord, summarizeLesson } from "./lib/memory-format.js"

const CATEGORIES = MEMORY_CATEGORIES
const MAX_INJECT_CHARS = 3200
const PROMOTION_REPEAT_THRESHOLD = 3

function memDir(cwd: string): string {
  const local = join(cwd, ".pi", "memory")
  if (existsSync(local)) return local
  if (existsSync(join(cwd, ".pi"))) return local
  const global = join(homedir(), ".pi", "agent", "memory")
  if (existsSync(global)) return global
  return local // default to project-local if neither exists
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function memFile(dir: string, category: MemoryCategory): string {
  return join(dir, `${category}.md`)
}

function readText(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : ""
}

function readRecords(dir: string, category: MemoryCategory): LessonRecord[] {
  const content = readText(memFile(dir, category))
  if (!content.trim()) return []
  return parseLessonFile(content, category)
}

function writeRecords(dir: string, category: MemoryCategory, records: LessonRecord[]) {
  ensureDir(dir)
  const content = records.map(record => serializeLessonRecord(record)).join("\n")
  writeFileSync(memFile(dir, category), content, "utf8")
}

function categoryKind(category: MemoryCategory): LessonRecord["kind"] {
  if (category === "codebase") return "codebase"
  if (category === "preferences") return "preference"
  if (category === "questions") return "question"
  if (category === "journal") return "journal"
  return "workflow"
}

function newRecord(category: MemoryCategory, note: string, extra?: Partial<LessonRecord>): LessonRecord {
  const timestamp = new Date().toISOString().slice(0, 16).replace("T", " ")
  const record: LessonRecord = {
    id: extra?.id ?? `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp,
    category,
    source: extra?.source ?? "manual",
    kind: extra?.kind ?? categoryKind(category),
    files: extra?.files ?? [],
    tags: extra?.tags ?? [],
    confidence: extra?.confidence ?? "medium",
    resolved: extra?.resolved,
    repeatCount: extra?.repeatCount,
    summary: note.trim(),
    trigger: extra?.trigger,
    symptom: extra?.symptom,
    rootCause: extra?.rootCause,
    prevention: extra?.prevention,
    outcome: extra?.outcome,
    fingerprint: extra?.fingerprint,
  }
  record.fingerprint = record.fingerprint || fingerprintLesson(record)
  return record
}

function buildCounts(dir: string): Record<MemoryCategory, number> {
  const counts = {} as Record<MemoryCategory, number>
  for (const category of CATEGORIES) {
    counts[category] = readRecords(dir, category).length
  }
  return counts
}

function emitMemoryState(pi: ExtensionAPI, dir: string, category?: MemoryCategory, lastRecord?: LessonRecord) {
  const summary: MemorySummary = {
    dir,
    counts: buildCounts(dir),
    lastRecord,
  }
  if (category) {
    pi.events.emit("reckoner:memory-updated", {
      ...summary,
      category,
    })
  } else {
    pi.events.emit("reckoner:memory-ready", summary)
  }
}

function toPromotionCandidate(record: LessonRecord): PromotionCandidate | null {
  if (record.category !== "mistakes") return null
  if ((record.repeatCount ?? 0) < PROMOTION_REPEAT_THRESHOLD) return null
  if (record.resolved === true) return null
  return {
    fingerprint: record.fingerprint ?? fingerprintLesson(record),
    files: record.files,
    summary: record.summary,
    prevention: record.prevention,
    repeatCount: record.repeatCount ?? PROMOTION_REPEAT_THRESHOLD,
    resolved: record.resolved,
  }
}

function emitPromotionCandidate(pi: ExtensionAPI, record: LessonRecord) {
  const candidate = toPromotionCandidate(record)
  if (!candidate) return
  pi.events.emit("reckoner:promotion-candidate", candidate)
}

function emitExistingPromotionCandidates(pi: ExtensionAPI, dir: string) {
  for (const record of readRecords(dir, "mistakes")) {
    emitPromotionCandidate(pi, record)
  }
}

function upsertRecord(dir: string, record: LessonRecord): LessonRecord {
  const records = readRecords(dir, record.category)
  const fingerprint = record.fingerprint || fingerprintLesson(record)
  const index = records.findIndex(existing => (existing.fingerprint || fingerprintLesson(existing)) === fingerprint)

  if (index === -1) {
    const next = { ...record, fingerprint }
    records.push(next)
    writeRecords(dir, record.category, records)
    return next
  }

  const existing = records[index]
  const merged: LessonRecord = {
    ...existing,
    ...record,
    id: existing.id,
    timestamp: record.timestamp,
    fingerprint,
    files: Array.from(new Set([...(existing.files ?? []), ...(record.files ?? [])])),
    tags: Array.from(new Set([...(existing.tags ?? []), ...(record.tags ?? [])])),
    repeatCount: Math.max(existing.repeatCount ?? 1, record.repeatCount ?? 1, (existing.repeatCount ?? 1) + 1),
    summary: record.summary || existing.summary,
    trigger: record.trigger || existing.trigger,
    symptom: record.symptom || existing.symptom,
    rootCause: record.rootCause || existing.rootCause,
    prevention: record.prevention || existing.prevention,
    outcome: record.outcome || existing.outcome,
    resolved: typeof record.resolved === "boolean" ? record.resolved : existing.resolved,
  }

  records[index] = merged
  writeRecords(dir, record.category, records)
  return merged
}

function searchRecords(dir: string, query: string, category?: MemoryCategory): LessonRecord[] {
  const q = query.toLowerCase()
  const categories = category ? [category] : [...CATEGORIES]
  const matches: LessonRecord[] = []

  for (const cat of categories) {
    for (const record of readRecords(dir, cat)) {
      const haystack = [
        record.summary,
        record.trigger ?? "",
        record.symptom ?? "",
        record.rootCause ?? "",
        record.prevention ?? "",
        record.outcome ?? "",
        record.files.join(" "),
        record.tags.join(" "),
        record.fingerprint ?? "",
      ].join("\n").toLowerCase()

      if (haystack.includes(q)) matches.push(record)
    }
  }

  return matches
}

function selectRelevant(records: LessonRecord[], context: InjectionBuildContext, maxItems: number): LessonMatch[] {
  return records
    .map(record => scoreLessonRecord(record, context))
    .filter(match => match.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxItems)
}

function renderSection(title: string, matches: LessonMatch[], budget: { remaining: number }): string {
  if (matches.length === 0 || budget.remaining <= 120) return ""
  const lines = [`### ${title}`]

  for (const match of matches) {
    const record = match.record
    const reasons = match.reasons.length > 0 ? ` (${match.reasons.join(", ")})` : ""
    const location = record.files.length > 0 ? ` applies: ${record.files.slice(0, 3).join(", ")}` : ""
    const prevention = record.prevention ? ` prevention: ${record.prevention}` : ""
    const bullet = `- ${summarizeLesson(record)}${reasons}${location}${prevention}`
    if (bullet.length + 1 > budget.remaining) break
    lines.push(bullet)
    budget.remaining -= bullet.length + 1
  }

  return lines.length > 1 ? lines.join("\n") : ""
}

function buildInjection(
  dir: string,
  context: InjectionBuildContext,
  onSelection?: (payload: MemorySelectionPayload) => void,
): string {
  if (!existsSync(dir)) return ""

  const budget = { remaining: Math.min(MAX_INJECT_CHARS, context.budget.remaining || MAX_INJECT_CHARS) }
  const parts = [
    "---",
    "## Relevant Reckoner memory",
    "Use these only if they match the current task or touched files.",
  ]
  budget.remaining -= parts.join("\n").length

  const mistakes = selectRelevant(readRecords(dir, "mistakes"), context, 6)
  const codebase = selectRelevant(readRecords(dir, "codebase"), context, 4)
  const preferences = selectRelevant(readRecords(dir, "preferences"), context, 2)
  const questions = selectRelevant(readRecords(dir, "questions"), context, 2)
  const journal = readRecords(dir, "journal").slice(-1).map(record => ({ record, score: 1, reasons: ["recent context"] }))

  onSelection?.({
    timestamp: Date.now(),
    recentFiles: context.recentFiles,
    activeTask: context.activeTask,
    matches: [
      ...mistakes.map(match => ({ category: "mistakes" as const, fingerprint: match.record.fingerprint, files: match.record.files, score: match.score, reasons: match.reasons, summary: match.record.summary })),
      ...codebase.map(match => ({ category: "codebase" as const, fingerprint: match.record.fingerprint, files: match.record.files, score: match.score, reasons: match.reasons, summary: match.record.summary })),
      ...preferences.map(match => ({ category: "preferences" as const, fingerprint: match.record.fingerprint, files: match.record.files, score: match.score, reasons: match.reasons, summary: match.record.summary })),
      ...questions.map(match => ({ category: "questions" as const, fingerprint: match.record.fingerprint, files: match.record.files, score: match.score, reasons: match.reasons, summary: match.record.summary })),
      ...journal.map(match => ({ category: "journal" as const, fingerprint: match.record.fingerprint, files: match.record.files, score: match.score, reasons: match.reasons, summary: match.record.summary })),
    ],
  })

  for (const section of [
    renderSection("Mistakes to avoid", mistakes, budget),
    renderSection("Codebase decisions", codebase, budget),
    renderSection("Preferences", preferences, budget),
    renderSection("Open questions", questions, budget),
    budget.remaining > 200 ? renderSection("Recent journal", journal, budget) : "",
  ]) {
    if (section) {
      parts.push("", section)
    }
  }

  if (parts.length <= 3) return ""
  parts.push("---")
  return `\n\n${parts.join("\n")}`
}

function formatRecord(record: LessonRecord): string {
  const meta = [
    `category=${record.category}`,
    `source=${record.source}`,
    record.fingerprint ? `fingerprint=${record.fingerprint}` : "",
    record.repeatCount ? `repeat=${record.repeatCount}` : "",
  ].filter(Boolean).join(" · ")

  const detailLines = [
    record.summary,
    record.prevention ? `prevention: ${record.prevention}` : "",
    record.files.length > 0 ? `files: ${record.files.join(", ")}` : "",
    record.tags.length > 0 ? `tags: ${record.tags.join(", ")}` : "",
  ].filter(Boolean)

  return [`## ${record.timestamp}`, meta, ...detailLines].filter(Boolean).join("\n")
}

export default function memoryExtension(pi: ExtensionAPI) {
  let dir: string | null = null

  pi.on("session_start", async (_event: any, ctx: any) => {
    dir = memDir(ctx.cwd)
    if (ctx.hasUI) {
      ctx.ui.setStatus("memory", existsSync(dir) ? "memory on" : "memory ready")
    }

    emitMemoryState(pi, dir)
    emitExistingPromotionCandidates(pi, dir)

    pi.events.emit("reckoner:register-injection", {
      key: "memory",
      priority: 40,
      maxChars: MAX_INJECT_CHARS,
      build: (context: InjectionBuildContext) => {
        if (!dir) return null
        return {
          key: "memory",
          text: buildInjection(dir, context, (payload) => {
            pi.events.emit("reckoner:memory-selection", payload)
          }),
          chars: 0,
          reason: context.recentFiles.length > 0 ? `recent files: ${context.recentFiles.join(", ")}` : "active task and recent lessons",
          priority: 40,
        }
      },
    })
  })

  pi.events.on("reckoner:lesson", (lesson: LessonRecord) => {
    if (!dir) return
    const saved = upsertRecord(dir, { ...lesson, category: "mistakes" })
    emitMemoryState(pi, dir, "mistakes", saved)
    emitPromotionCandidate(pi, saved)
  })

  pi.events.on("reckoner:memory-note", (payload: {
    category: MemoryCategory
    note: string
    files?: string[]
    tags?: string[]
    confidence?: LessonRecord["confidence"]
  }) => {
    if (!dir) return
    const record = newRecord(payload.category, payload.note, {
      files: payload.files ?? [],
      tags: payload.tags ?? [],
      confidence: payload.confidence ?? "medium",
      source: "reflection",
    })
    const saved = upsertRecord(dir, record)
    emitMemoryState(pi, dir, payload.category, saved)
    emitPromotionCandidate(pi, saved)
  })

  pi.registerTool({
    name: "remember",
    label: "Remember",
    description:
      "Save a note to persistent memory. Captures learnings, decisions, mistakes, or questions that survive across sessions.",
    promptSnippet: "Save to persistent memory",
    promptGuidelines: [],
    parameters: Type.Object({
      category: StringEnum([...CATEGORIES] as const, {
        description:
          "journal=session notes, codebase=architecture/patterns, mistakes=bugs/lessons, preferences=user style, questions=open unknowns",
      }),
      note: Type.String({ description: "The note to save. Be specific and concrete." }),
      files: Type.Optional(Type.Array(Type.String(), { description: "Optional file paths this note applies to." })),
    }),
    async execute(_toolCallId: string, params: any) {
      if (!dir) throw new Error("Memory not initialized — session_start hasn't fired")
      const record = newRecord(params.category as MemoryCategory, params.note, {
        files: params.files ?? [],
      })
      const saved = upsertRecord(dir, record)
      emitMemoryState(pi, dir, params.category as MemoryCategory, saved)
      emitPromotionCandidate(pi, saved)
      return {
        content: [{ type: "text" as const, text: `Saved to ${params.category}.` }],
        details: { category: params.category, dir },
      }
    },
  })

  pi.registerTool({
    name: "recall",
    label: "Recall",
    description: "Search persistent memory for notes matching a keyword or topic.",
    promptSnippet: "Search memory for past notes or decisions",
    promptGuidelines: [],
    parameters: Type.Object({
      query: Type.String({ description: "Keyword or phrase to search for" }),
      category: Type.Optional(StringEnum([...CATEGORIES] as const, { description: "Optional category filter." })),
    }),
    async execute(_toolCallId: string, params: any) {
      if (!dir) throw new Error("Memory not initialized")
      const matches = searchRecords(dir, params.query, params.category as MemoryCategory | undefined)
      const text = matches.length > 0
        ? `Found ${matches.length} match(es) for "${params.query}":\n\n${matches.slice(0, 8).map(formatRecord).join("\n\n---\n\n")}`
        : `No memory found for "${params.query}".`

      return {
        content: [{ type: "text" as const, text }],
        details: { query: params.query, matches: matches.length },
      }
    },
  })

  pi.registerCommand("memory", {
    description: "Show memory status or list recent notes",
    handler: async (args: string, ctx: any) => {
      const currentDir = dir ?? memDir(ctx.cwd)
      const mode = args.trim().toLowerCase()

      if (!existsSync(currentDir)) {
        ctx.ui.notify(`No memory yet. Memory will be stored in: ${currentDir}`, "info")
        return
      }

      if (mode === "recent") {
        const recent = [...CATEGORIES]
          .flatMap(category => readRecords(currentDir, category).slice(-1))
          .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
          .slice(-5)
        ctx.ui.notify(recent.length > 0 ? recent.map(formatRecord).join("\n\n---\n\n") : "No recent memory.", "info")
        return
      }

      const counts = buildCounts(currentDir)
      const lines = [`Memory directory: ${currentDir}`, ""]
      for (const category of CATEGORIES) {
        lines.push(`  ${category}: ${counts[category]} note(s)`)
      }
      ctx.ui.notify(lines.join("\n"), "info")
    },
  })

  pi.registerCommand("lessons", {
    description: "Inspect stored lessons and repeated mistakes",
    handler: async (args: string, ctx: any) => {
      const currentDir = dir ?? memDir(ctx.cwd)
      const mode = args.trim().toLowerCase()
      const lessons = readRecords(currentDir, "mistakes")
      let selected = lessons

      if (mode === "repeated") {
        selected = lessons.filter(lesson => (lesson.repeatCount ?? 0) > 1)
      } else if (mode === "promoted") {
        selected = lessons.filter(lesson => (lesson.repeatCount ?? 0) >= PROMOTION_REPEAT_THRESHOLD && lesson.resolved !== true)
      } else if (mode === "unresolved") {
        selected = lessons.filter(lesson => lesson.resolved === false)
      } else if (mode.startsWith("file ")) {
        const query = mode.slice(5).trim()
        selected = lessons.filter(lesson => lesson.files.some(file => file.includes(query)))
      } else if (mode === "recent") {
        selected = lessons.slice(-8)
      }

      if (selected.length === 0) {
        ctx.ui.notify("No matching lessons.", "info")
        return
      }

      ctx.ui.notify(selected.slice(-8).map(formatRecord).join("\n\n---\n\n"), "info")
    },
  })
}
