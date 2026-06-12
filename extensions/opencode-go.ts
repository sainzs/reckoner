import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"

/**
 * OpenCode Go provider extension.
 *
 * Two providers are required because the endpoint paths differ by API type:
 *
 *   openai-completions  → pi appends /chat/completions
 *                          base: https://opencode.ai/zen/go/v1
 *                          full: https://opencode.ai/zen/go/v1/chat/completions  ✓
 *
 *   anthropic-messages  → pi appends /v1/messages
 *                          base: https://opencode.ai/zen/go
 *                          full: https://opencode.ai/zen/go/v1/messages          ✓
 *
 * Using one base URL for both would double the /v1 for Anthropic → 404.
 *
 * Auth: pi resolves credentials for provider "opencode-go" from:
 *   - auth.json key "opencode-go"  (stored via /connect in pi)
 *   - env var OPENCODE_API_KEY
 *
 * Model IDs in pi:
 *   opencode-go/glm-5
 *   opencode-go/kimi-k2.5
 *   opencode-go/kimi-k2.5-1m
 *   opencode-go/kimi-k2.5-3m
 *   opencode-go/kimi-k2.5-v
 *   opencode-go/mimo-v2-pro
 *   opencode-go/mimo-v2-omni
 *   opencode-go-minimax/minimax-m2.5
 *   opencode-go-minimax/minimax-m2.7
 */

const OPENAI_BASE = "https://opencode.ai/zen/go/v1"
const ANTHROPIC_BASE = "https://opencode.ai/zen/go"

export default function opencodeGoExtension(pi: ExtensionAPI) {
  // GLM-5 and Kimi K2.5 — OpenAI Chat Completions compatible
  pi.registerProvider("opencode-go", {
    baseUrl: OPENAI_BASE,
    apiKey: "OPENCODE_API_KEY",
    api: "openai-completions",
    models: [
      {
        id: "glm-5",
        name: "GLM-5 (OpenCode Go)",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8192,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          supportsUsageInStreaming: false,
          maxTokensField: "max_tokens",
        },
      },
      {
        id: "kimi-k2.5",
        name: "Kimi K2.5 (OpenCode Go)",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 131072,
        maxTokens: 16384,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          supportsUsageInStreaming: false,
          maxTokensField: "max_tokens",
        },
      },
      {
        id: "kimi-k2.5-1m",
        name: "Kimi K2.5 1M (OpenCode Go)",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1000000,
        maxTokens: 16384,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          supportsUsageInStreaming: false,
          maxTokensField: "max_tokens",
        },
      },
      {
        id: "kimi-k2.5-3m",
        name: "Kimi K2.5 3M (OpenCode Go)",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 3000000,
        maxTokens: 16384,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          supportsUsageInStreaming: false,
          maxTokensField: "max_tokens",
        },
      },
      {
        id: "kimi-k2.5-v",
        name: "Kimi K2.5 Vision (OpenCode Go)",
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 131072,
        maxTokens: 16384,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          supportsUsageInStreaming: false,
          maxTokensField: "max_tokens",
        },
      },
      {
        id: "mimo-v2-pro",
        name: "MiMo V2 Pro (OpenCode Go)",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          supportsUsageInStreaming: false,
          maxTokensField: "max_tokens",
        },
      },
      {
        id: "mimo-v2-omni",
        name: "MiMo V2 Omni (OpenCode Go)",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          supportsUsageInStreaming: false,
          maxTokensField: "max_tokens",
        },
      },
    ],
  })

  // MiniMax M2.5 and M2.7 — Anthropic Messages API compatible
  // Separate provider because the base URL must omit /v1 (pi appends /v1/messages)
  pi.registerProvider("opencode-go-minimax", {
    baseUrl: ANTHROPIC_BASE,
    apiKey: "OPENCODE_API_KEY",
    api: "anthropic-messages",
    models: [
      {
        id: "minimax-m2.5",
        name: "MiniMax M2.5 (OpenCode Go)",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1000000,
        maxTokens: 8192,
      },
      {
        id: "minimax-m2.7",
        name: "MiniMax M2.7 (OpenCode Go)",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1000000,
        maxTokens: 8192,
      },
    ],
  })
}
