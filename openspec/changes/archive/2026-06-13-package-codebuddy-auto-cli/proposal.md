## Why

`codebuddy-auto` currently runs from source with `node dist/src/main.js`, but local installation workflows need a real CLI entry point. Making the TypeScript package linkable and packable lets users run `codebuddy-auto WORKFLOW.md --daemon` without publishing to npm.

## What Changes

- Package the TypeScript implementation as a local-installable CLI package.
- Add a `codebuddy-auto` binary entry that points at the built CLI.
- Ensure the built entry can execute directly through package manager links.
- Add package verification that checks the local pack/link contract without requiring an npm account or registry publish.
- Document local source install, `pnpm link --global`, and tarball install workflows.

## Capabilities

### New Capabilities
- `codebuddy-cli-packaging`: Defines the local npm/pnpm packaging behavior for the `codebuddy-auto` CLI.

### Modified Capabilities

None.

## Impact

- Affected files: `typescript/package.json`, `typescript/src/main.ts`, packaging tests, and installation documentation.
- Affected PLAN.md chapters: SPEC §8 Workflow-as-Code and Prompt Construction, §10 Agent Runner Protocol, §13 Harness Engineering, and §17 Deployment Model.
- No npm registry publishing is introduced.
- No scheduler, tracker, worker, dashboard API, or workflow schema behavior changes.
