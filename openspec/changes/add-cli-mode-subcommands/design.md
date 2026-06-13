## Context

`codebuddy-auto init` is already a command, while scheduler actions are currently selected through top-level flags. The intended user flow is to enter a scheduler runtime directory, initialize or edit `WORKFLOW.md`, then run one of the scheduler actions directly.

## Goals / Non-Goals

**Goals:**
- Make `init`, `check`, `daemon`, and `status` all top-level commands.
- Preserve optional workflow path selection for non-default workflows.
- Preserve `--reload` for commands that load workflow runtime config.
- Remove old mode flags rather than keeping compatibility.

**Non-Goals:**
- No changes to scheduler behavior, dashboard behavior, tracker behavior, or generated workflow content.
- No new package dependencies.

## Decisions

- Use a small command parser before runtime loading.
  - Chosen because existing tests call `runCli` directly and this keeps command behavior explicit.
  - Alternative: model all commands through nested Commander subcommands. That is more idiomatic but larger and riskier because the current positional workflow path behavior already exists.
- Treat `check`, `daemon`, and default no-command execution as separate run modes over the same runtime-loading path.
  - Chosen to minimize logic drift between modes.
  - Alternative: duplicate runtime setup inside each command handler, which would make reload and error handling easier to accidentally diverge.
- Remove old flags immediately.
  - Chosen because the user explicitly requested no backward compatibility.
  - Alternative: keep aliases for one release, which would reduce breakage but keep the inconsistent interface alive.

## Risks / Trade-offs

- [Risk] Existing local scripts using `--check`, `--daemon`, or `--status` will fail -> Mitigation: update docs and tests in the same change; this is an intentional breaking change.
- [Risk] Manual parser errors may be less polished than Commander subcommands -> Mitigation: keep accepted forms narrow and covered by CLI tests.
