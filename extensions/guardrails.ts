import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { resolve } from "node:path";

const BLOCKED_PATH_PATTERNS = [
  /(?:^|[\\/])\.env(?:\.(?!example$|sample$)[^\\/]+)?$/i,
  /(?:^|[\\/])\.ssh(?:[\\/]|$)/i,
  /(?:^|[\\/])\.aws(?:[\\/]|$)/i,
  /(?:^|[\\/])\.gnupg(?:[\\/]|$)/i,
  /(?:^|[\\/])\.pi[\\/]+agent[\\/]+auth\.json$/i,
  /(?:^|[\\/])(secrets?|credentials?)\.(json|ya?ml|toml|ini|env)$/i,
  /(?:^|[\\/])(id_rsa|id_ed25519|known_hosts)$/i,
  /\.(pem|key|p12|pfx)$/i,
]

const DANGEROUS_BASH_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bsudo\b/i,
  /\bdd\s+if=/i,
  /\bmkfs\./i,
  /\bchmod\s+777\b/i,
  /\bgit\s+push\b.*--force/i,
  /\bgit\s+reset\b.*--hard/i,
  /\bgit\s+clean\b.*-fdx/i,
  /\bcurl\b.*\|\s*(sh|bash)\b/i,
  /\bwget\b.*\|\s*(sh|bash)\b/i,
]

let enabled = true

function normalizePath(input: unknown): string {
  return String(input ?? "").replace(/^@/, "")
}

function hasMatch(text: string, patterns: RegExp[]): RegExp | undefined {
  return patterns.find((pattern) => pattern.test(text))
}

function statusLabel(): string {
  return enabled ? "guardrails on" : "guardrails off"
}

function policySummary(): string {
  return [
    "Guardrails policy:",
    "- blocks sensitive paths like .env, ~/.ssh, ~/.aws, secrets, credentials, and key files",
    "- warns on risky shell commands like rm -rf, sudo, git push --force, git reset --hard, and curl | sh",
    "- can be toggled with /guardrails on|off",
  ].join("\n")
}

export default function guardrailsExtension(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.hasUI) {
      ctx.ui.setStatus("guardrails", statusLabel())
    }
  })

  pi.on("tool_call", async (event, ctx) => {
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
    }
  })

  pi.registerCommand("guardrails", {
    description: "Show or toggle the guardrail policy",
    handler: async (args, ctx) => {
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
