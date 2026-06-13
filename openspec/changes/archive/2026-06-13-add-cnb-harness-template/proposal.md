## Why

CNB business repositories need a repeatable way to expose small, agent-ready tasks to `codebuddy-auto`. Today the issue template can be hand-written per repository, but that will drift across projects and makes multi-project onboarding harder.

## What Changes

- Add a standard CNB issue template source in `codebuddy-auto` for `agent-ready` tasks.
- Add a small installer that copies the standard template into a target business repository under `.cnb/ISSUE_TEMPLATE/`.
- Document how the template fits the scheduler label flow and how business repositories should use it.
- Keep scheduler behavior unchanged: this change does not alter candidate selection, workspace management, tracker state, or runner behavior.

## Capabilities

### New Capabilities
- `cnb-harness-template`: Defines the standard CNB issue template and installation behavior for business repositories managed by `codebuddy-auto`.

### Modified Capabilities

None.

## Impact

- Affected files: new template assets, a repository-level install script, focused tests, and documentation.
- Affected PLAN.md chapters: SPEC §8 Workflow-as-Code and Prompt Construction, §9 Workspace Management and Safety, §13 Harness Engineering, and §15 Security.
- No runtime dependencies are added.
- No scheduler, tracker, worker, dashboard, or CodeBuddy SDK APIs are changed.
