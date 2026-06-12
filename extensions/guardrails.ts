import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"
import { resolve, relative } from "node:path"
import type { PromotionCandidate } from "./lib/lesson-types.js"

const BLOCKED_PATH_PATTERNS = [
  /(?:^|[\\/])\.env(?:\.(?!example$|sample$)[^\\/]+)?$/i,
  /(?:^|[\\/])\.ssh(?:[\\/]|$)/i,
  /(?:^|[\\/])\.aws(?:[\\/]|$)/i,
  /(?:^|[\\/])\.gnupg(?:[\\/]|$)/i,
  /(?:^|[\\/])\.pi[\\/]+agent[\\/]+auth\.json$/i,
  /(?:^|[\\/])\.pi[\\/]+agent[\\/]+models\.json$/i,
  /(?:^|[\\/])(secrets?|credentials?)\.(json|ya?ml|toml|ini|env)$/i,
  /(?:^|[\\/])(id_rsa|id_ed25519|known_hosts)$/i,
  /\.(pem|key|p12|pfx)$/i,
]

const DANGEROUS_BASH_PATTERNS = [
  /\brm\s+-[a-z]*r[a-z]*f\b/i,
  /\brm\s+-[a-z]*f[a-z]*r\b/i,
  /\bfind\b.*\s-delete\b/i,
  /\bsudo\b/i,
  /\bdd\s+if=/i,
  /\bmkfs\./i,
  /\bchmod\s+777\b/i,
  /\bgit\s+push\b.*--force/i,
  /\bgit\s+reset\b.*--hard/i,
  /\bgit\s+checkout\b.*\s-f\b/i,
  /\bgit\s+clean\b.*-f/i,
  /\bcurl\b.*\|\s*(sh|bash)\b/i,
  /\bwget\b.*\|\s*(sh|bash)\b/i,
]

const riskyFiles = new Map<string, PromotionCandidate[]>()
let enabled = true

function normalizePath(input: unknown): string {
  return String(input ?? "").replace(/^@/, "")
}

function hasMatch(text: string, patterns: RegExp[]): RegExp | undefined {
  return patterns.find((pattern) => pattern.test(text))
}

function rememberCandidate(file: string, candidate: PromotionCandidate) {
  const key = file.replace(/^\.\//, "")
  const existing = riskyFiles.get(key) ?? []
  if (!existing.some(entry => entry.fingerprint === candidate.fingerprint)) {
    riskyFiles.set(key, [...existing, candidate])
  }
}

function findRiskyCandidates(cwd: string, rawPath: string): PromotionCandidate[] {
  const relativePath = relative(cwd, resolve(cwd, rawPath)).replace(/^\.\//, "")
  return [rawPath.replace(/^\.\//, ""), relativePath]
    .flatMap(key => riskyFiles.get(key) ?? [])
}

function statusLabel(): string {
  return enabled ? "guardrails on" : "guardrails off"
}

function policySummary(): string {
  return [
    "Guardrails policy:",
    "- blocks sensitive paths like .env, ~/.ssh, ~/.aws, secrets, credentials, and key files",
    "- warns on risky shell commands like rm -rf, sudo, git push --force, git reset --hard, and curl | sh",
    "- escalates repeated unresolved lesson files into promotion-aware edit warnings",
    "- can be toggled with /guardrails on|off",
  ].join("\n")
}

export default function guardrailsExtension(pi: ExtensionAPI) {
  pi.events.on("reckoner:promotion-candidate", (candidate: PromotionCandidate) => {
    for (const file of candidate.files) {
      rememberCandidate(file, candidate)
    }
  })

  pi.on("session_start", async (_event: any, ctx: any) => {
    if (ctx.hasUI) {
      ctx.ui.setStatus("guardrails", statusLabel())
    }
  })

  pi.on("tool_call", async (event: any, ctx: any) => {
    if (!enabled) return

    if (event.toolName === "bash") {
      const command = String((event.input as { command?: string } | undefined)?.command ?? "").trim()
      const riskyPattern = hasMatch(command, DANGEROUS_BASH_PATTERNS)
      if (riskyPattern) {
        if (ctx.hasUI) {
          const ok = await ctx.ui.confirm(
            "Dangerous shell command",
            `This command matches a risky pattern (${riskyPattern.source}):\n\n${command}\n\nAllow it anyway?`,
          )
          if (ok) return
        }

        return {
          block: true,
          reason: `Blocked risky bash command: ${command}`,
        }
      }
    }

    if (event.toolName === "write" || event.toolName === "edit") {
      const rawPath = normalizePath((event.input as { path?: string } | undefined)?.path)
      const absolutePath = resolve(ctx.cwd, rawPath)
      const blockedPattern = hasMatch(absolutePath, BLOCKED_PATH_PATTERNS)

      if (blockedPattern) {
        return {
          block: true,
          reason: `Blocked sensitive path (${blockedPattern.source}): ${rawPath}`,
        }
      }

      const candidates = findRiskyCandidates(ctx.cwd, rawPath)
      if (candidates.length > 0) {
        const top = candidates.sort((a, b) => b.repeatCount - a.repeatCount)[0]
        const message = [
          `This file has repeated unresolved lessons (${top.repeatCount}x):`,
          top.summary,
          top.prevention ? `Prevention: ${top.prevention}` : "",
        ].filter(Boolean).join("\n\n")

        if (ctx.hasUI) {
          const ok = await ctx.ui.confirm("Promotion-aware guardrail", `${message}\n\nAllow the edit anyway?`)
          if (ok) return
        }

        return {
          block: true,
          reason: `Blocked edit in risky file ${rawPath}: ${top.summary}`,
        }
      }
    }
  })

  pi.registerCommand("guardrails", {
    description: "Show or toggle the guardrail policy",
    handler: async (args: string, ctx: any) => {
      const mode = args.trim().toLowerCase()

      if (mode === "off" || mode === "disable") {
        enabled = false
        ctx.ui.notify("Guardrails disabled", "warning")
      } else if (mode === "on" || mode === "enable") {
        enabled = true
        ctx.ui.notify("Guardrails enabled", "info")
      } else {
        ctx.ui.notify(policySummary(), "info")
      }

      if (ctx.hasUI) {
        ctx.ui.setStatus("guardrails", statusLabel())
      }
    },
  })
}
