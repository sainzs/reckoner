# Persistent nvim server for fast diagnostics

- [x] Design the shared nvim server lifecycle (start at session_start, stop at session end)
- [x] Build nvim-server.ts — new extension that manages the persistent nvim process
- [x] Integrate auto-verify.ts to use the server instead of spawning per-file
- [x] Integrate nvim-tools.ts to use the server for diagnostics/definition/references
- [x] Test: verify diagnostics work via persistent server (Python, TypeScript)
- [x] Test: verify auto-verify uses server path when available, falls back to spawn
- [ ] Update docs and commit
