declare module "@mariozechner/pi-coding-agent" {
  export type ExtensionAPI = any
}

declare module "@mariozechner/pi-ai" {
  export type AssistantMessage = any
  export const StringEnum: any
}

declare module "@sinclair/typebox" {
  export const Type: any
}

declare module "@mariozechner/pi-tui" {
  export const truncateToWidth: any
  export const matchesKey: any
}

declare module "node:path" {
  export const resolve: any
  export const relative: any
  export const dirname: any
  export const basename: any
  export const join: any
}

declare module "node:fs" {
  export const existsSync: any
  export const writeFileSync: any
  export const mkdtempSync: any
  export const unlinkSync: any
  export const mkdirSync: any
  export const readFileSync: any
}

declare module "node:os" {
  export const tmpdir: any
  export const homedir: any
}

declare module "node:child_process" {
  export const spawn: any
}

declare var process: any
