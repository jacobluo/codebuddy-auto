## Why

Users currently need to know internal example paths, manually create workspace directories, and reason about `WORKFLOW.md` relative path resolution before they can run `codebuddy-auto`. This makes the first real usage brittle, especially after examples moved under `examples/workflows/`.

## What Changes

- Add a `codebuddy-auto init` command that initializes the current directory as a scheduler runtime directory.
- Generate a root-local `WORKFLOW.md` configured for a CNB target repository.
- Prompt for project slug and repository clone URL when running in an interactive terminal without explicit options.
- Create the configured workspace root directory so `codebuddy-auto --check` can pass after env variables are loaded.
- Refuse to overwrite existing files unless `--force` is provided.
- Do not generate or load `.env`; credentials remain externally managed by the shell or CI environment.
- Update README guidance to use the init-first flow.

## Capabilities

### New Capabilities

- `cli-init-workflow`: CLI initialization of a local scheduler runtime directory.

### Modified Capabilities

- `codebuddy-cli-packaging`: Documented usage changes from example-path invocation to init-first invocation.

## Impact

- Affected code:
  - `typescript/src/cli.ts`
  - `typescript/test/cli.test.ts`
  - README and OpenSpec docs
- Affected PLAN.md chapters:
  - PLAN §8 `WORKFLOW.md` loading and template rendering
  - PLAN §10 preflight validation
  - PLAN §15 CLI/runtime operations
- Affected Symphony SPEC areas:
  - SPEC §5.1 workflow loading: default `WORKFLOW.md` in current process working directory
  - SPEC §5.3.3 workspace path resolution: relative paths resolve relative to selected `WORKFLOW.md`
  - SPEC §6.3 dispatch preflight validation
