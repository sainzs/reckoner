import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"

/**
 * Xiaomi MiMo direct provider extension.
 *
 * Routes directly to Xiaomi MiMo API (Token Plan).
 * Auth: pi resolves credentials for provider "mimo" from:
 *   - auth.json key "mimo"  (stored via /connect in pi)
 *   - env var MIMO_API_KEY
 *
 * Model IDs in pi:
 *   mimo/mimo-v2.5-pro
 */

export default function mimoExtension(pi: ExtensionAPI) {
  pi.registerProvider("mimo", {
    baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
    apiKey: "MIMO_API_KEY",
    api: "openai-completions",
    models: [
      {
        id: "mimo-v2.5-pro",
        name: "MiMo V2.5 Pro",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1048576,
        maxTokens: 131072,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          supportsUsageInStreaming: true,
          maxTokensField: "max_tokens",
        },
      },
    ],
  })
}
