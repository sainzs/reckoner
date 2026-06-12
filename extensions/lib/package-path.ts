import { resolve } from "node:path"

/**
 * Resolves paths relative to the Reckoner package root.
 *
 * This file lives at extensions/lib/package-path.ts.
 * In CJS (no "type":"module" in package.json), __dirname gives the
 * directory of the current file. Walking up two levels reaches the
 * package root:  extensions/lib/ → extensions/ → package root
 *
 * This means the path is always correct regardless of where
 * `pi install` placed the package — no hardcoded ~/Code/reckoner.
 *
 * Override: set RECKONER_NVIM_INIT env var to point elsewhere.
 */

const PACKAGE_ROOT = resolve(__dirname, "../..")

export function packagePath(...segments: string[]): string {
  return resolve(PACKAGE_ROOT, ...segments)
}

export const NVIM_INIT_PATH: string =
  process.env["RECKONER_NVIM_INIT"] ?? packagePath("nvim", "init.lua")
