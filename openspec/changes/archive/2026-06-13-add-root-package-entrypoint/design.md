## Context

`typescript/` is already a locally linkable package, but root-level usage still requires `cd typescript`. The user preference is now option B: make the repository root the installation entrypoint while leaving source code and implementation tooling under `typescript/`.

This gives operators the natural root commands:

```bash
pnpm install
pnpm build
pnpm link --global
codebuddy-auto examples/workflows/symphony_repo_crm.WORKFLOW.md --daemon
```

without the risk and review noise of moving `src/`, `test/`, and `dashboard/`.

## Goals / Non-Goals

**Goals:**

- Add a root package entrypoint for local `pnpm link --global` and tarball install.
- Delegate root scripts to the nested TypeScript package.
- Keep nested TypeScript package tests and direct development workflows working.
- Ensure packed root package includes the nested build output plus examples/templates.

**Non-Goals:**

- No source directory migration.
- No npm registry publish flow.
- No monorepo/workspace conversion unless needed by pnpm.
- No behavior changes to the scheduler runtime.

## Decisions

1. Use a root wrapper package instead of promoting source directories.

   Alternative considered: move all TypeScript files to root. That is cleaner long-term but too much churn for the immediate install goal.

2. Point root `bin` at `./typescript/dist/src/main.js`.

   Alternative considered: add a separate root wrapper executable. Directly targeting the built CLI avoids a second runtime entrypoint and keeps behavior identical.

3. Keep `typescript/package.json` for implementation development.

   Alternative considered: root package only. That would require larger config and lockfile movement. Keeping the nested package preserves existing tests and avoids disrupting current development.

## Risks / Trade-offs

- [Risk] Root package and nested package metadata can drift -> Mitigation: root packaging tests MUST validate root `bin`, delegated scripts, and packed contents.
- [Risk] Users run root `pnpm link --global` before building -> Mitigation: docs MUST instruct `pnpm build` before linking; tests verify the built binary exists.
- [Risk] Tarball contains extra implementation files -> Mitigation: root package `files` MUST be explicit enough to include runtime assets while excluding source tests.
