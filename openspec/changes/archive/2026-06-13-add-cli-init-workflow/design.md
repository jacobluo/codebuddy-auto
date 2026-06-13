## Context

`codebuddy-auto` already supports running against a root-local `WORKFLOW.md`, but the published examples ask users to invoke workflow files under `examples/workflows/`. Because path values resolve relative to the selected workflow file, example-path execution exposes implementation details and can fail preflight unless the user manually creates directories at the resolved location.

The desired product shape is a scheduler runtime directory:

```text
runner-dir/
├── WORKFLOW.md
└── .codebuddy-auto/workspaces/
```

The target business repository keeps its own agent instructions and CNB issue template. The scheduler directory owns runtime configuration and per-issue workspaces.

## Goals / Non-Goals

**Goals:**

- Make `codebuddy-auto init` the recommended first command in a new scheduler directory.
- Generate a directly runnable `WORKFLOW.md` with root-local relative paths.
- Create `.codebuddy-auto/workspaces` during initialization.
- Prompt for project slug and clone URL in interactive terminal sessions.
- Keep the command scriptable with explicit flags and non-TTY fallbacks.
- Preserve existing files by default.
- Leave credential files unmanaged.

**Non-Goals:**

- No interactive wizard in this change.
- No automatic CNB API validation during init.
- No automatic write into the business repository's `.cnb/ISSUE_TEMPLATE`.
- No new runtime dependencies.

## Decisions

1. Implement `init` as a Commander subcommand.

   Alternative considered: add `--init` as a top-level flag. A subcommand is clearer because initialization is not a scheduler run mode and should not interact with scheduler mode commands or workflow path arguments.

2. Generate `WORKFLOW.md` in the current working directory.

   Alternative considered: continue asking users to run `examples/workflows/*.WORKFLOW.md`. Root-local generation matches SPEC §5.1's default workflow path and avoids relative path surprises from SPEC §5.3.3.

3. Use interactive prompts only when safe.

   Alternative considered: require `--project` and `--repo-url` every time. Interactive prompts match the common first-run experience, while explicit flags keep CI and scripts deterministic. Non-TTY runs use editable placeholder defaults instead of hanging.

4. Use in-code templates instead of adding a template engine.

   Alternative considered: template files with placeholder replacement. In-code templates keep the small init surface self-contained and avoid adding dependencies. The existing checked-in examples remain useful as references, not as the init source of truth.

5. Preserve files by default and add `--force`.

   Alternative considered: always overwrite generated files. Default preservation protects hand-edited workflow prompts and credentials guidance.

## Risks / Trade-offs

- [Risk] In-code workflow template can drift from example workflows -> Mitigation: keep tests focused on generated behavior and update examples separately as operator documentation.
- [Risk] Users may expect init to install CNB issue templates into the business repo -> Mitigation: README documents `scripts/install-cnb-harness` as the separate business-repo step.
- [Risk] `--force` could overwrite a hand-edited workflow -> Mitigation: force is explicit and default behavior refuses overwrite.
- [Risk] Users may expect `.env` generation -> Mitigation: README documents that credentials must be exported or sourced manually before running.

## Migration Plan

Existing users can continue running explicit workflow paths. New documentation will prefer:

```bash
mkdir codebuddy-auto-runner
cd codebuddy-auto-runner
codebuddy-auto init --project relaxorg/symphony_repo_crm --repo-url https://cnb.cool/relaxorg/symphony_repo_crm.git
```

Rollback is removing the new command and reverting README usage; existing scheduler behavior remains unchanged.

## Open Questions

No open questions for the first non-interactive version.
