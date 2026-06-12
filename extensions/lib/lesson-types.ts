export const MEMORY_CATEGORIES = ["journal", "codebase", "mistakes", "preferences", "questions"] as const
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number]

export type VerifySource = "tsc" | "test" | "nvim"
export type VerifySeverity = "error" | "warning"
export type VerifyStatusLevel = "off" | "ready" | "running" | "issues"
export type LessonSource = "auto-verify" | "manual" | "reflection" | "promotion"
export type LessonKind = "type" | "test" | "lsp" | "workflow" | "codebase" | "preference" | "question" | "journal"
export type UiSeverity = "muted" | "ok" | "info" | "warn" | "error"

export interface VerifyIssue {
  fingerprint: string
  source: VerifySource
  severity: VerifySeverity
  file?: string
  line?: number
  column?: number
  code?: string
  message: string
  raw: string
  touchedRelated: boolean
}

export interface VerifyResult {
  runId: string
  cycle: number
  touchedFiles: string[]
  baselineCount: number
  introduced: VerifyIssue[]
  unchanged: VerifyIssue[]
  resolved: VerifyIssue[]
  testFailures: VerifyIssue[]
  passed: boolean
  startedAt: number
  finishedAt: number
}

export interface VerifyStatusPayload {
  label: string
  level: VerifyStatusLevel
  severity: UiSeverity
  summary: {
    introduced: number
    resolved: number
    touchedFiles: number
  }
}

export interface LessonRecord {
  id: string
  timestamp: string
  category: MemoryCategory
  source: LessonSource
  kind?: LessonKind
  fingerprint?: string
  files: string[]
  tags: string[]
  confidence: "low" | "medium" | "high"
  resolved?: boolean
  repeatCount?: number
  summary: string
  trigger?: string
  symptom?: string
  rootCause?: string
  prevention?: string
  outcome?: string
}

export interface LessonMatch {
  record: LessonRecord
  score: number
  reasons: string[]
}

export interface TaskState {
  title: string
  done: number
  total: number
  nextStep?: string
  remainingSteps: string[]
}

export interface WorkspaceState {
  cwd: string
  root?: string
  branch?: string
  dirtyCount: number
  dirtyFiles: string[]
  packageName?: string
  scripts: string[]
}

export interface NvimStatusPayload {
  label: string
  ready: boolean
  socket?: string
  ownedByUs?: boolean
}

export interface MemorySummary {
  dir: string
  counts: Record<MemoryCategory, number>
  lastRecord?: LessonRecord
}

export interface PromotionCandidate {
  fingerprint: string
  files: string[]
  summary: string
  prevention?: string
  repeatCount: number
  resolved?: boolean
}

export interface MemorySelectionPayload {
  timestamp: number
  recentFiles: string[]
  activeTask?: TaskState
  matches: Array<{
    category: MemoryCategory
    fingerprint?: string
    files: string[]
    score: number
    reasons: string[]
    summary: string
  }>
}

export interface InjectionBuildContext {
  cwd: string
  budget: {
    total: number
    remaining: number
  }
  recentFiles: string[]
  activeTask?: any
}

export interface InjectionFragment {
  key: string
  text: string
  chars: number
  reason?: string
  title?: string
  priority?: number
}

export interface InjectionTrace {
  timestamp: number
  totalChars: number
  remainingChars: number
  fragments: Array<{
    key: string
    chars: number
    priority: number
    reason?: string
  }>
  skipped: Array<{
    key: string
    priority?: number
    reason: string
  }>
}
