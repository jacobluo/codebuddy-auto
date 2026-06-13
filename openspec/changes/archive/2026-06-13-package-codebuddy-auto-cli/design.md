## Context

The current TypeScript implementation already builds a runnable CLI at `typescript/dist/src/main.js`, but it is not an npm-style command. `typescript/package.json` is private, lacks a `bin` mapping, and the source entry has no shebang. That blocks local `pnpm link --global` and tarball installation workflows.

This change only targets local installation from source or tarball. Publishing to npmjs.com, choosing a permanent public package scope, and supporting direct git install from the repository root remain separate decisions.

## Goals / Non-Goals

**Goals:**

- Allow `pnpm link --global` from `typescript/` to expose a `codebuddy-auto` command.
- Allow `pnpm pack` output to contain the built server CLI, dashboard assets, examples, and template assets needed for local operation.
- Verify the package contract in an automated test.
- Document local install and tarball install commands.

**Non-Goals:**

- No npm registry publish flow.
- No root workspace/package reorganization.
- No direct `pnpm add git+...` support from the repository root.
- No runtime behavior changes to the scheduler.

## Decisions

1. Keep the package under `typescript/`.

   Alternative considered: move package metadata to the repository root. That would make git installs easier later, but it is a larger repository-layout change. The immediate goal is local source install from the existing package.

2. Use `bin.codebuddy-auto = ./dist/src/main.js`.

   Alternative considered: add a wrapper script under `bin/`. The direct built entry is simpler, and TypeScript preserves the source shebang in emitted JavaScript.

3. Keep publish disabled for now while still supporting local packaging.

   Alternative considered: remove `private` and prepare npm registry metadata immediately. That raises naming/scope decisions before they are needed. Local pack/link does not require registry publishing.

4. Include non-TS runtime assets in the package.

   Alternative considered: ship only `dist/`. The CLI examples and harness templates are part of the local operator experience, so the package should include them when packed.

## Risks / Trade-offs

- [Risk] Package consumers run the CLI before building -> Mitigation: document `pnpm build` before `pnpm link --global`; package tests verify the built artifact exists.
- [Risk] Keeping the package in `typescript/` makes direct git install awkward -> Mitigation: explicitly document source clone/link and tarball install as the supported local workflows for now.
- [Risk] Missing static dashboard assets in the tarball breaks the status server shell -> Mitigation: package files include `dist/`, which contains both server and dashboard build outputs.
