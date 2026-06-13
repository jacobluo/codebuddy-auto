# Workflow Examples

This directory contains `WORKFLOW.md` examples for target repositories driven by `codebuddy-auto`.

For normal first-time setup, prefer `codebuddy-auto init` in a dedicated scheduler runtime directory. These files are references for teams that want to inspect, copy, or hand-edit workflow configurations.

Target repositories should keep repo-local agent instructions such as `AGENTS.md`, scripts, issue templates, and verification commands. Scheduler runtime configuration belongs in the scheduler runtime directory.

Install the standard CNB issue harness into a target repository before using these workflows:

```bash
./scripts/install-cnb-harness ../symphony_repo_crm
```

## Examples

- `cnb-generic.WORKFLOW.md`: generic CNB tracker template for a new target repository.
- `symphony_repo_crm.WORKFLOW.md`: CNB issue tracker workflow for `relaxorg/symphony_repo_crm`.
