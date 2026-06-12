export interface TaskStep {
  text: string
  checked: boolean
}

export interface TaskPlan {
  title: string
  steps: TaskStep[]
}

export function parsePlan(content: string): TaskPlan | null {
  const lines = content.split(/\r?\n/)
  let title = ""
  const steps: TaskStep[] = []
  for (const line of lines) {
    const tm = line.match(/^#\s+(.+)/)
    if (tm && !title) { title = tm[1].trim(); continue }
    const sm = line.match(/^- \[([ xX])\]\s+(.+)/)
    if (sm) steps.push({ checked: sm[1] !== " ", text: sm[2].trim() })
  }
  if (!title && steps.length === 0) return null
  return { title: title || "Untitled", steps }
}
