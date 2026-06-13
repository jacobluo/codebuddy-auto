## Why

The current operator CLI mixes an `init` command with `--check`, `--daemon`, and `--status` mode flags, which makes first-run usage less consistent. Operators should be able to run all top-level actions as commands from a scheduler runtime directory.

## What Changes

- **BREAKING**: Replace `codebuddy-auto --check`, `codebuddy-auto --daemon`, and `codebuddy-auto --status` with `codebuddy-auto check`, `codebuddy-auto daemon`, and `codebuddy-auto status`.
- Keep `codebuddy-auto init` as the initialization command.
- Keep workflow path support as an optional positional argument after the mode command.
- Keep `--reload` as an option for `check` and `daemon`.
- Update README examples and CLI tests to use the command form only.

## Capabilities

### New Capabilities

### Modified Capabilities
- `codebuddy-cli-integration`: Operator-facing scheduler modes become explicit subcommands instead of top-level flags.

## Impact

- Affected code: `typescript/src/cli.ts`, `typescript/test/cli.test.ts`, README usage examples.
- Affected specs: `openspec/specs/codebuddy-cli-integration/spec.md`.
- Affected PLAN.md chapters: CLI/runtime entrypoint behavior around scheduler startup and preflight; no scheduler state or worker contract changes.
- Dependencies: none.
