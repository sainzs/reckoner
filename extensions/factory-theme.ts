import type { ExtensionAPI } from "@mariozechner/pi-coding-agent"

const THEMES = ["random-access", "reckoner-dusk", "reckoner-factory"] as const
const DEFAULT_THEME = "random-access"
const THEME_ENTRY = "reckoner-theme"

type ThemeName = (typeof THEMES)[number]

function normalizeTheme(input: string): ThemeName | null {
  if (input === "random-access" || input === "random" || input === "rat") return "random-access"
  if (input === "dusk" || input === "reckoner-dusk") return "reckoner-dusk"
  if (input === "factory" || input === "reckoner-factory") return "reckoner-factory"
  return null
}

export default function factoryThemeExtension(pi: ExtensionAPI) {
  let selectedTheme: ThemeName = DEFAULT_THEME

  function restoreTheme(ctx: any) {
    selectedTheme = DEFAULT_THEME

    try {
      const branch = [...ctx.sessionManager.getBranch()].reverse()
      for (const entry of branch) {
        if (entry.type !== "custom" || entry.customType !== THEME_ENTRY) continue
        const theme = normalizeTheme(String(entry.data?.theme ?? ""))
        if (theme) {
          selectedTheme = theme
          break
        }
      }
    } catch {}
  }

  function applyTheme(ctx: any, themeName: ThemeName = selectedTheme) {
    if (!ctx.hasUI) return

    selectedTheme = themeName
    const result = ctx.ui.setTheme(themeName)
    if (!result.success) {
      ctx.ui.notify(`Failed to apply theme ${themeName}: ${result.error}`, "warning")
    }
  }

  // Restore theme whenever the active branch changes.
  // session_start  — fresh session
  // session_switch — /resume or /new
  // session_tree   — /tree navigation between branches
  // session_fork   — forking from an existing branch
  function onBranchChange(_event: any, ctx: any) {
    restoreTheme(ctx)
    applyTheme(ctx)
  }

  pi.on("session_start",  onBranchChange)
  pi.on("session_switch", onBranchChange)
  pi.on("session_tree",   onBranchChange)
  pi.on("session_fork",   onBranchChange)

  pi.registerCommand("tone", {
    description: "Show or switch Reckoner themes (random-access/dusk/factory)",
    handler: async (args: string, ctx: any) => {
      const input = args.trim().toLowerCase()

      if (!input) {
        ctx.ui.notify(
          `Current theme: ${selectedTheme}\nAvailable: random-access, reckoner-dusk, reckoner-factory\nUse /tone random, /tone dusk, or /tone factory.`,
          "info",
        )
        return
      }

      const theme = normalizeTheme(input)
      if (!theme) {
        ctx.ui.notify("Unknown theme. Use /tone random, /tone dusk, or /tone factory.", "warning")
        return
      }

      applyTheme(ctx, theme)
      pi.appendEntry(THEME_ENTRY, { theme })
      ctx.ui.notify(`Theme switched: ${theme}`, "info")
    },
  })
}
