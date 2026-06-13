## Why

Users should be able to install or link `codebuddy-auto` from the repository root without navigating into `typescript/`. Moving all source files to root is unnecessary right now; a root package entrypoint can provide the install experience while preserving the existing TypeScript implementation layout.

## What Changes

- Add a root `package.json` that owns the `codebuddy-auto` package entrypoint.
- Keep runtime source, tests, dashboard, and TypeScript package implementation under `typescript/`.
- Configure root-level build/check/test/pack/link workflows to delegate to `typescript/`.
- Configure the root package `bin` to execute the built CLI under `typescript/dist/src/main.js`.
- Update documentation so root-level local install is the primary path while direct `typescript/` development remains available.

## Capabilities

### New Capabilities

None.

### Modified Capabilities
- `codebuddy-cli-packaging`: Add root-level package entrypoint behavior while preserving the nested TypeScript implementation package.

## Impact

- Affected files: root package metadata, root lock/package workflow if needed, README, and packaging tests.
- Affected PLAN.md chapters: SPEC §8 Workflow-as-Code and Prompt Construction, §13 Harness Engineering, and §17 Deployment Model.
- No source layout migration, no runtime scheduler/tracker/worker behavior change, and no npm registry publishing.
