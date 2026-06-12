import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"

/**
 * Kimi Code direct provider extension.
 *
 * Routes directly to Kimi's coding API instead of through OpenCode Go.
 * Auth: pi resolves credentials for provider "kimi-code" from:
 *   - auth.json key "kimi-code"  (stored via /connect in pi)
 *   - env var KIMI_CODE_API_KEY
 *
 * Model IDs in pi:
 *   kimi-code/kimi-for-coding
 */

export default function kimiCodeExtension(pi: ExtensionAPI) {
  pi.registerProvider("kimi-code", {
    baseUrl: "https://api.kimi.com/coding/v1",
    apiKey: "KIMI_CODE_API_KEY",
    api: "openai-completions",
    models: [
      {
        id: "kimi-for-coding",
        name: "Kimi K2.6",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 262144,
        maxTokens: 32768,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: true,
          reasoningEffortMap: {
            minimal: "low",
            low: "low",
            medium: "medium",
            high: "high",
            xhigh: "high",
          },
          supportsUsageInStreaming: true,
          maxTokensField: "max_tokens",
        },
      },
    ],
  })
}
