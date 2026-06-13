## 1. CLI Contract

- [x] 1.1 Add failing CLI tests for `check`, `daemon`, and `status` subcommands.
- [x] 1.2 Add failing CLI tests that reject legacy `--check`, `--daemon`, and `--status` flags before loading workflow config.
- [x] 1.3 Implement command-mode parsing in `runCli`.
- [x] 1.4 Update README usage examples to use subcommands.

## 2. Verification

- [x] 2.1 Run focused CLI tests.
- [x] 2.2 Run `pnpm run check`, `pnpm run test`, and `openspec validate add-cli-mode-subcommands --strict`.
