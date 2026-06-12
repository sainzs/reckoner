# Contributing

Thanks for helping improve reckoner.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Local workflow

```bash
npm install

# typecheck + unit tests
npm run verify:self
```

## Layout

- `extensions/`: pi runtime extensions (guardrails, harness, checkpointing).
- `skills/`: skill instructions loaded on demand.
- `tests/`: unit tests for lesson scoring and memory format.
- `docs/`: orientation and policy notes.

## Guidelines

- Keep each change scoped to one behavior.
- Run `npm run verify:self` before opening a pull request.
- Update `HARNESS.md` or `AGENTS.md` when changing runtime behavior they
  describe.
- Do not commit runtime state, credentials, or session files.
