function normalizePart(value: string | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\\/g, "/")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_./:-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

export function normalizeFilePath(file?: string): string {
  const normalized = normalizePart(file)
  return normalized.replace(/^\.\//, "") || "unknown"
}

export function normalizeDiagnosticMessage(message: string): string {
  return message
    .toLowerCase()
    .replace(/\b\d+\b/g, "#")
    .replace(/['"`][^'"`]+['"`]/g, '"value"')
    .replace(/\s+/g, " ")
    .trim()
}

export function shortMessageStem(message: string, max = 80): string {
  const normalized = normalizeDiagnosticMessage(message)
  return normalized.length <= max ? normalized : normalized.slice(0, max)
}

function buildFingerprint(parts: Array<string | undefined>): string {
  return parts
    .map(normalizePart)
    .filter(Boolean)
    .join("|")
}

export function fingerprintTscIssue(params: { code?: string, file?: string, message: string }): string {
  return buildFingerprint([
    "tsc",
    params.code ?? "unknown",
    normalizeFilePath(params.file),
    shortMessageStem(params.message),
  ])
}

export function fingerprintLspIssue(params: { file?: string, line?: number, message: string, client?: string }): string {
  return buildFingerprint([
    "nvim",
    params.client ?? "lsp",
    normalizeFilePath(params.file),
    shortMessageStem(params.message), // Line number removed to avoid collisions when lines shift
  ])
}

export function fingerprintTestIssue(params: { file?: string, runner?: string, message: string }): string {
  return buildFingerprint([
    "test",
    params.runner ?? "runner",
    normalizeFilePath(params.file),
    shortMessageStem(params.message),
  ])
}

export function fingerprintLesson(record: {
  fingerprint?: string
  files?: string[]
  summary: string
  kind?: string
  source?: string
}): string {
  if (record.fingerprint) return normalizePart(record.fingerprint)
  return buildFingerprint([
    record.source ?? "lesson",
    record.kind ?? "unknown",
    record.files?.[0],
    shortMessageStem(record.summary),
  ])
}
