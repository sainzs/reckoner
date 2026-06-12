import type { InjectionBuildContext, LessonMatch, LessonRecord, MemoryCategory } from "./lesson-types.js"
import { fingerprintLesson, normalizeFilePath } from "./fingerprint.js"

const DETAIL_FIELDS = new Set(["summary", "trigger", "symptom", "rootCause", "prevention", "outcome"])
const CONFIDENCE_SCORES = { low: 1, medium: 3, high: 5 } as const

function splitBlocks(content: string): string[] {
  return content.split(/^## /m).filter(block => block.trim())
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map(part => part.trim())
    .filter(Boolean)
}

function parseBoolean(value: string): boolean | undefined {
  if (value === "true") return true
  if (value === "false") return false
  return undefined
}

function parseNumber(value: string): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function defaultRecord(category: MemoryCategory, timestamp: string): LessonRecord {
  return {
    id: `legacy-${timestamp.replace(/[^0-9]/g, "") || Date.now()}`,
    timestamp,
    category,
    source: "manual",
    files: [],
    tags: [],
    confidence: "medium",
    summary: "",
  }
}

export function serializeLessonRecord(record: LessonRecord): string {
  const lines = [
    `## ${record.timestamp}`,
    `id: ${record.id}`,
    `source: ${record.source}`,
    `category: ${record.category}`,
  ]

  if (record.kind) lines.push(`kind: ${record.kind}`)
  if (record.fingerprint) lines.push(`fingerprint: ${record.fingerprint}`)
  if (record.files.length > 0) lines.push(`files: ${record.files.join(", ")}`)
  if (record.tags.length > 0) lines.push(`tags: ${record.tags.join(", ")}`)
  lines.push(`confidence: ${record.confidence}`)
  if (typeof record.resolved === "boolean") lines.push(`resolved: ${record.resolved}`)
  if (typeof record.repeatCount === "number") lines.push(`repeatCount: ${record.repeatCount}`)

  const details: Array<keyof LessonRecord> = ["summary", "trigger", "symptom", "rootCause", "prevention", "outcome"]
  for (const key of details) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) {
      lines.push("")
      lines.push(`${key}:`)
      lines.push(value.trim())
    }
  }

  return lines.join("\n") + "\n"
}

export function parseLessonBlock(block: string, fallbackCategory: MemoryCategory): LessonRecord {
  const lines = block.trim().split(/\r?\n/)
  const timestamp = lines.shift()?.trim() || new Date().toISOString().slice(0, 16).replace("T", " ")
  const record = defaultRecord(fallbackCategory, timestamp)

  let idx = 0
  let parsedMeta = false
  while (idx < lines.length) {
    const line = lines[idx].trim()
    if (!line) {
      idx++
      break
    }
    const match = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/)
    if (!match) break
    const [, rawKey, rawValue] = match
    const key = rawKey.trim()
    const value = rawValue.trim()
    parsedMeta = true

    if (DETAIL_FIELDS.has(key)) break

    switch (key) {
      case "id":
        record.id = value || record.id
        break
      case "source":
        record.source = (value as LessonRecord["source"]) || record.source
        break
      case "category":
        record.category = (value as MemoryCategory) || fallbackCategory
        break
      case "kind":
        record.kind = value as LessonRecord["kind"]
        break
      case "fingerprint":
        record.fingerprint = value || undefined
        break
      case "files":
        record.files = parseCsv(value)
        break
      case "tags":
        record.tags = parseCsv(value)
        break
      case "confidence":
        record.confidence = (value as LessonRecord["confidence"]) || record.confidence
        break
      case "resolved":
        record.resolved = parseBoolean(value)
        break
      case "repeatCount":
        record.repeatCount = parseNumber(value)
        break
    }
    idx++
  }

  let activeField: keyof LessonRecord | null = null
  const buffer: Record<string, string[]> = {}

  for (; idx < lines.length; idx++) {
    const raw = lines[idx]
    const trimmed = raw.trim()
    const section = trimmed.match(/^([A-Za-z][A-Za-z0-9]*):\s*$/)
    if (section && DETAIL_FIELDS.has(section[1])) {
      activeField = section[1] as keyof LessonRecord
      buffer[activeField] = []
      continue
    }

    if (!activeField) {
      if (!trimmed) continue
      buffer.summary = buffer.summary ?? []
      buffer.summary.push(trimmed)
      continue
    }

    buffer[activeField].push(raw)
  }

  for (const [key, value] of Object.entries(buffer)) {
    const text = value.join("\n").trim()
    if (!text) continue

    if (key === "summary") record.summary = text
    else if (key === "trigger") record.trigger = text
    else if (key === "symptom") record.symptom = text
    else if (key === "rootCause") record.rootCause = text
    else if (key === "prevention") record.prevention = text
    else if (key === "outcome") record.outcome = text
  }

  if (!record.summary) {
    const remainder = lines.join("\n").trim()
    record.summary = remainder || timestamp
  }

  if (!parsedMeta) {
    record.id = `legacy-${fingerprintLesson(record)}`
    record.source = "manual"
  }

  record.fingerprint = record.fingerprint || fingerprintLesson(record)
  return record
}

export function parseLessonFile(content: string, category: MemoryCategory): LessonRecord[] {
  return splitBlocks(content).map(block => parseLessonBlock(block, category))
}

function textIncludes(text: string, needles: string[]): boolean {
  const hay = text.toLowerCase()
  return needles.some(needle => needle && hay.includes(needle.toLowerCase()))
}

function recencyScore(timestamp: string): number {
  const parsed = Date.parse(timestamp.replace(" ", "T"))
  if (!Number.isFinite(parsed)) return 0
  const ageDays = Math.max(0, (Date.now() - parsed) / 86_400_000)
  if (ageDays < 1) return 10
  if (ageDays < 7) return 6
  if (ageDays < 30) return 3
  return 1
}

export function scoreLessonRecord(record: LessonRecord, context: InjectionBuildContext): LessonMatch {
  let score = 0
  const reasons: string[] = []

  const normalizedFiles = record.files.map(normalizeFilePath)
  const normalizedRecent = context.recentFiles.map(normalizeFilePath)
  const overlappingFiles = normalizedRecent.filter(file => normalizedFiles.includes(file))
  if (overlappingFiles.length > 0) {
    score += 60
    reasons.push(`file overlap: ${overlappingFiles[0]}`)
  }

  const taskTerms = [
    context.activeTask?.title ?? "",
    context.activeTask?.nextStep ?? "",
    ...(context.activeTask?.remainingSteps ?? []),
  ].join(" ")

  if (taskTerms && textIncludes(taskTerms, record.tags)) {
    score += 20
    reasons.push("task/tag match")
  }

  if (taskTerms && textIncludes(taskTerms, [record.summary, record.prevention ?? "", record.rootCause ?? ""])) {
    score += 12
    reasons.push("task/summary match")
  }

  if (record.resolved === false) {
    score += 15
    reasons.push("unresolved")
  }

  if ((record.repeatCount ?? 0) > 1) {
    score += Math.min(12, (record.repeatCount ?? 0) * 3)
    reasons.push(`repeated x${record.repeatCount}`)
  }

  score += CONFIDENCE_SCORES[record.confidence] ?? 0
  score += recencyScore(record.timestamp)

  return { record, score, reasons }
}

export function summarizeLesson(record: LessonRecord): string {
  const prefix = record.confidence === "high" ? "[high] " : record.confidence === "low" ? "[low] " : ""
  return `${prefix}${record.summary}`.trim()
}
