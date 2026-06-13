# Workflow Examples

This directory contains `WORKFLOW.md` examples for target repositories driven by `codebuddy-auto`.

Target repositories should keep repo-local agent instructions such as `AGENTS.md`, scripts, issue templates, and verification commands. Scheduler runtime configuration belongs here with `codebuddy-auto`.
The TypeScript implementation directory should not keep tracked workflow examples; a local `typescript/WORKFLOW.md` may exist only as an ignored developer runtime file.

Install the standard CNB issue harness into a target repository before using these workflows:

```bash
./scripts/install-cnb-harness ../symphony_repo_crm
```

## Examples

- `cnb-generic.WORKFLOW.md`: generic CNB tracker template for a new target repository.
- `local-dashboard-demo.WORKFLOW.md`: local tracker demo for dashboard and scheduler smoke testing.
- `symphony_repo_crm.WORKFLOW.md`: CNB issue tracker workflow for `relaxorg/symphony_repo_crm`.
